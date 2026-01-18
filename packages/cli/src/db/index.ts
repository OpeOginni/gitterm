import { Database } from "bun:sqlite";
import path from "node:path";
import { xdgData } from "xdg-basedir";
import { drizzle } from 'drizzle-orm/bun-sqlite';

const app = "opencode"

const data = path.join(xdgData!, app)

const dbPath = path.join(data, "opencode.db")

const sqlite = new Database(dbPath, { readonly: true })

export const localOpencodeDb = drizzle(sqlite)

