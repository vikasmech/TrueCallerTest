import { loadEnv } from "./env.js";
import { createDb, createPool } from "./db/client.js";
import { createPhoneCrypto } from "./crypto.js";
import { createBoss } from "./queue.js";
import { createMailer } from "./auth/mailer.js";
import { createStorageFromEnv } from "./storage/s3.js";
import { buildApp } from "./app.js";
import type { AppContext } from "./context.js";

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);
const boss = createBoss(env.DATABASE_URL);
boss.on("error", (err) => console.error("[pg-boss]", err));
await boss.start();

const ctx: AppContext = {
  env,
  pool,
  db,
  boss,
  crypto: createPhoneCrypto({
    hmacKeyHex: env.PHONE_HMAC_KEY,
    encKeyHex: env.PHONE_ENC_KEY,
    keyVersion: env.PHONE_KEY_VERSION,
  }),
  mailer: createMailer(env, (m) => console.log(m)),
  storage: createStorageFromEnv(env),
};

const app = await buildApp(ctx);

const shutdown = async () => {
  await app.close();
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
