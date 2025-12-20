import dotenv from "dotenv";

dotenv.config({
	// path: "../../apps/server/.env",
	path: "../../apps/server/.env.development.local",
});

import { drizzle } from "drizzle-orm/node-postgres";

import * as authSchema from "./schema/auth";
import * as cloudSchema from "./schema/cloud";
import * as workspaceSchema from "./schema/workspace";
import * as integrationsSchema from "./schema/integrations";

export const db = drizzle(process.env.DATABASE_URL || "", { schema: { ...authSchema, ...cloudSchema, ...workspaceSchema, ...integrationsSchema } } );

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