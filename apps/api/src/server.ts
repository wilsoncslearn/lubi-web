import "../../../scripts/environment.mjs";
import Fastify from "fastify";
import { db } from "./db.js";
import { registerAuthentication } from "./http/auth.js";
import { registerResponseHeaders, registerStaticWeb } from "./http/web.js";
import {
  registerLegacyRoutes,
  registerLegacyWriteGuard,
  type LegacyImportPreview,
} from "./legacy/routes.js";
import { registerVault } from "./vault.js";
import { registerVaultRestore } from "./vaultRestore.js";
import { registerSecrets } from "./secrets.js";
import { registerNetwork } from "./network.js";

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
// Composition order is deliberate: authentication -> legacy write guard -> routes.
// These are root registrations, not encapsulated Fastify plugins.
const importPreviews = new Map<string, LegacyImportPreview>();
const session = registerAuthentication(app, db, password, (token) => {
  importPreviews.delete(token);
});
registerLegacyWriteGuard(app, db);
registerLegacyRoutes(app, db, session, importPreviews);
registerVault(app, db);
registerVaultRestore(app, db);
registerSecrets(app, db);
registerNetwork(app, db);
registerResponseHeaders(app);
registerStaticWeb(app);

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
