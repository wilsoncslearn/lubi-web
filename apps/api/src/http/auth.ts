import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SessionStore } from "../sessions.js";

// Root hooks intentionally cover ALL API modules, including the legacy routes.
// The logout callback removes compatibility-only preview state without coupling auth to its format.
export function registerAuthentication(
  app: FastifyInstance,
  db: DatabaseSync,
  password: string,
  onLogout: (token: string) => void,
) {
  const sessions = new SessionStore(db, password);
  const { salt, passwordHash } = sessions;
  const loginAttempts = new Map<string, { count: number; reset: number }>();
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
      onLogout(token);
    }
    reply.header("set-cookie", cookie("", 0));
    return { ok: true };
  });
  app.get("/api/auth/me", async () => ({ ok: true }));
  return session;
}
