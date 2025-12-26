import type { CodegenConfig } from "@graphql-codegen/cli";
import "dotenv/config";
import env from "@gitterm/env/server";

const config: CodegenConfig = {
  schema: {
    "https://backboard.railway.app/graphql/v2": {
      headers: {
        Authorization: `Bearer ${env.RAILWAY_API_TOKEN}`,
      },
    },
  },
  documents: [
    "src/**/*.graphql",
  ],
  generates: {
    "src/service/railway/graphql/generated/railway.ts": {
      plugins: [
        "typescript",
        "typescript-operations",
        "typescript-generic-sdk",
      ],
      config: {
        rawRequest: false,
        documentMode: "string",
      },
    },
  },
  ignoreNoDocuments: false,
};

export default config;

