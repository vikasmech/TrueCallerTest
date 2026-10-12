import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../env.js";
import { createDb, createPool } from "./client.js";

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);
const migrationsFolder = resolve(fileURLToPath(import.meta.url), "../../../drizzle");

await migrate(db, { migrationsFolder });
await pool.end();
console.log("migrations applied");
