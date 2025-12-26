import "dotenv/config";
import { getSdk } from "./graphql/generated/railway";
import env from "@gitterm/env/server";

const RAILWAY_API_URL = env.RAILWAY_API_URL;


// ============================================================================
// GraphQL Request Function
// ============================================================================

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
}

class RailwayAPIError extends Error {
  constructor(
    message: string,
    public errors?: GraphQLResponse<unknown>["errors"]
  ) {
    super(message);
    this.name = "RailwayAPIError";
  }
}

function createRequester(token?: string) {
  const apiToken = token ?? env.RAILWAY_API_TOKEN;

  return async <R, V>(doc: string, variables?: V): Promise<R> => {
    if (!apiToken) {
      throw new RailwayAPIError("RAILWAY_API_TOKEN is not set");
    }

    if (!RAILWAY_API_URL) {
      throw new RailwayAPIError("RAILWAY_API_URL is not set");
    }

    const response = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        query: doc,
        variables,
      }),
    });

    if (!response.ok) {
      throw new RailwayAPIError(
        `Railway API request failed: ${response.status} ${response.statusText}`
      );
    }

    const result = (await response.json()) as GraphQLResponse<R>;

    if (result.errors && result.errors.length > 0) {
      throw new RailwayAPIError(
        `GraphQL errors: ${result.errors.map((e) => e.message).join(", ")}`,
        result.errors
      );
    }

    if (!result.data) {
      throw new RailwayAPIError("No data returned from Railway API");
    }

    return result.data;
  };
}

// ============================================================================
// Railway Client Factory
// ============================================================================

export function createRailwayClient(token?: string) {
  const requester = createRequester(token);
  return getSdk(requester);
}

// Default client instance using env token
export const railway = createRailwayClient();

// Re-export types for convenience
export * from "./graphql/generated/railway";
