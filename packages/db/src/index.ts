import dotenv from "dotenv";

dotenv.config({
	path: "../../apps/server/.env",
});

import { drizzle } from "drizzle-orm/node-postgres";

import * as authSchema from "./schema/auth";
import * as cloudSchema from "./schema/cloud";
import * as workspaceSchema from "./schema/workspace";

export const db = drizzle(process.env.DATABASE_URL || "", { schema: { ...authSchema, ...cloudSchema, ...workspaceSchema } } );

export {
	eq,
	and,
	or,
	asc,
	desc,
	sql,
	like,
	not,
	lt,
	lte,
	gt,
	gte,
	isNull,
	isNotNull,
  } from "drizzle-orm";