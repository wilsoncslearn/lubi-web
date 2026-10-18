import type { FastifyInstance } from "fastify";
import { existsSync, statSync, createReadStream } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Security headers apply to API errors as well as successful/static responses.
export function registerResponseHeaders(app: FastifyInstance) {
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
}

export function registerStaticWeb(app: FastifyInstance) {
  const fail = (message: string) => ({ error: message });
  // Serve the production build on the same origin as the API, without adding a second server.
  const webDist = fileURLToPath(new URL("../../../web/dist/", import.meta.url));
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
}
