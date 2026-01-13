import dotenv from "dotenv";

dotenv.config({
  path: "../../apps/server/.env",
  // path: "../../apps/server/.env.development.local",
});

import { drizzle } from "drizzle-orm/node-postgres";

import * as authSchema from "./schema/auth";
import * as cloudSchema from "./schema/cloud";
import * as workspaceSchema from "./schema/workspace";
import * as integrationsSchema from "./schema/integrations";
import * as agentLoopSchema from "./schema/agent-loop";
import * as modelCredentialsSchema from "./schema/model-credentials";

export const db = drizzle(process.env.DATABASE_URL || "", {
  schema: {
    ...authSchema,
    ...cloudSchema,
    ...workspaceSchema,
    ...integrationsSchema,
    ...agentLoopSchema,
    ...modelCredentialsSchema,
  },
});

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
  ne,
  SQL,
} from "drizzle-orm";
