import type PgBoss from "pg-boss";
import type pg from "pg";
import type { Db } from "./db/client.js";
import type { PhoneCrypto } from "./crypto.js";
import type { Env } from "./env.js";
import type { Mailer } from "./auth/mailer.js";
import type { StorageProvider } from "./storage/provider.js";

export type AppContext = {
  env: Env;
  pool: pg.Pool;
  db: Db;
  boss: PgBoss;
  crypto: PhoneCrypto;
  mailer: Mailer;
  storage: StorageProvider;
};
