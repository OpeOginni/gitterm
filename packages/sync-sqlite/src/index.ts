import dotenv from "dotenv";
import { drizzle } from 'drizzle-orm/libsql';

dotenv.config({
    // path: "../../apps/server/.env",
    path: "../../apps/server/.env.development.local",
  });

import * as projectSchema from "./schema/project";
import * as sessionSchema from "./schema/session";

export const sqliteDb = drizzle({
    connection: {
        url: process.env.SQLITE_DATABASE_URL || "",
        authToken: process.env.SQLITE_AUTH_TOKEN || "",
    },
    schema: {
        ...projectSchema,
        ...sessionSchema,
    }
});