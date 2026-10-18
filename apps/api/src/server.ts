import "../../../scripts/environment.mjs";
import Fastify from "fastify";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
import { registerVault } from "./vault.js";
import { registerVaultRestore } from "./vaultRestore.js";
import { registerNetwork } from "./network.js";
import { registerSecrets } from "./secrets.js";
import { SessionStore } from "./sessions.js";
import { existsSync, statSync, createReadStream } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerLegacyRoutes,
  legacyWriteBlocked,
  legacyReadOnlyMessage,
  type LegacyImportPreview,
} from "./legacy/routes.js";

const password = process.env.LUBI_PASSWORD;
if (
  !password ||
  password.length < 16 ||
  password.length > 1024 ||
  password === "replace-with-a-long-unique-password"
)
  throw new Error(
    "Set LUBI_PASSWORD to a unique password of at least 16 characters",
  );
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const app = Fastify({
  logger: process.env.LUBI_QUIET !== "1",
  bodyLimit: 8_388_608,
});
const sessions = new SessionStore(db, password);
const { salt, passwordHash } = sessions;
const loginAttempts = new Map<string, { count: number; reset: number }>();
const importPreviews = new Map<string, LegacyImportPreview>();
const cookieName = "lubi_session";
const secure = process.env.LUBI_HTTPS === "1";
const cookie = (token: string, age: number) =>
  `${cookieName}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
const fail = (message: string) => ({ error: message });
function session(req: { headers: { cookie?: string } }): string | undefined {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!token) return;
  const expires = sessions.get(token);
  if (!expires) return;
  if (expires <= Date.now()) {
    sessions.delete(token);
    return;
  }
  return token;
}
app.addHook("onRequest", async (req, reply) => {
  const route = req.routeOptions.url || req.url.split("?")[0];
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin) {
      const forwarded = req.headers["x-forwarded-host"];
      const expected =
        typeof forwarded === "string" && process.env.LUBI_TRUST_PROXY === "1"
          ? forwarded
          : req.headers.host;
      const allowedDevOrigins = (process.env.LUBI_DEV_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        return reply.code(403).send(fail("请求来源不允许"));
      }
      if (originHost !== expected && !allowedDevOrigins.includes(origin))
        return reply.code(403).send(fail("请求来源不允许"));
    }
  }
  if (
    route.startsWith("/api/") &&
    !["/api/health", "/api/auth/login"].includes(route) &&
    !session(req)
  )
    return reply
      .code(401)
      .send(fail("请先登录，或重新登录后重试未保存的操作。"));
  if (legacyWriteBlocked(req.method, route, db))
    return reply.code(409).send(fail(legacyReadOnlyMessage));
});
app.get("/api/health", async () => ({ ok: true }));
app.post(
  "/api/auth/login",
  {
    schema: {
      body: {
        type: "object",
        required: ["password"],
        additionalProperties: false,
        properties: { password: { type: "string" } },
      },
    },
  },
  async (req, reply) => {
    const now = Date.now();
    for (const [ip, value] of loginAttempts)
      if (value.reset < now) loginAttempts.delete(ip);
    const attempt = loginAttempts.get(req.ip) || {
      count: 0,
      reset: now + 60_000,
    };
    if (attempt.count >= 10)
      return reply
        .code(429)
        .header("retry-after", "60")
        .send(fail("登录尝试过多，请稍后重试"));
    attempt.count++;
    loginAttempts.set(req.ip, attempt);
    const input = (req.body as { password: string }).password;
    const candidate = scryptSync(input.slice(0, 1024), salt, 64);
    if (!timingSafeEqual(candidate, passwordHash))
      return reply.code(401).send(fail("密码不正确"));
    loginAttempts.delete(req.ip);
    sessions.cleanup();
    const token = randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + 86_400_000);
    reply.header("set-cookie", cookie(token, 86400));
    return { ok: true };
  },
);
app.post("/api/auth/logout", async (req, reply) => {
  const token = session(req);
  if (token) {
    sessions.delete(token);
    importPreviews.delete(token);
  }
  reply.header("set-cookie", cookie("", 0));
  return { ok: true };
});
app.get("/api/auth/me", async () => ({ ok: true }));
registerLegacyRoutes(app, db, session, importPreviews);
registerVault(app, db);
registerVaultRestore(app, db);
registerSecrets(app, db);
registerNetwork(app, db);
app.addHook("onSend", async (req, reply) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("referrer-policy", "no-referrer");
  reply.header(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors " +
      (process.env.LUBI_ALLOW_EMBED === "1"
        ? "https: http://localhost:*"
        : "'none'"),
  );
  if ((req.routeOptions.url || req.url).startsWith("/api/"))
    reply.header("cache-control", "no-store");
});
// Serve the production build on the same origin as the API, without adding a second server.
const webDist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
app.get("/*", async (req, reply) => {
  if (req.url.startsWith("/api/"))
    return reply.code(404).send(fail("API not found"));
  let route: string;
  try {
    route = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    return reply.code(400).send(fail("Invalid URL"));
  }
  const candidate = resolve(webDist, "." + route);
  if (
    !candidate.startsWith(resolve(webDist) + sep) &&
    candidate !== resolve(webDist)
  )
    return reply.code(403).send(fail("Invalid path"));
  const file =
    existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : resolve(webDist, "index.html");
  if (!existsSync(file))
    return reply
      .code(503)
      .type("text/plain; charset=utf-8")
      .send("请先执行 npm run build，再启动 Lubi。");
  reply.type(mime[extname(file)] || "application/octet-stream");
  reply.header(
    "cache-control",
    extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
  );
  return reply.send(createReadStream(file));
});
app
  .listen({ host, port })
  .then((address) => console.log("LUBI_READY " + address))
  .catch((err) => {
    app.log.error(err);
    console.error("Lubi failed to listen: " + err.message);
    process.exit(1);
  });

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    void app
      .close()
      .then(() => {
        db.close();
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch(() => process.exit(1));
  });
