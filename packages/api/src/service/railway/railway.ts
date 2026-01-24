import "dotenv/config";
import { getSdk } from "./graphql/generated/railway";
import { getProviderConfigService } from "../provider-config";
import type { RailwayConfig } from "../../providers/railway";

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
    public errors?: GraphQLResponse<unknown>["errors"],
  ) {
    super(message);
    this.name = "RailwayAPIError";
  }
}

function createRequester(url: string, token?: string) {
  const apiToken = token

  return async <R, V>(doc: string, variables?: V): Promise<R> => {
    if (!apiToken) {
      throw new RailwayAPIError("Railway API Token is not set");
    }

    if (!url) {
      throw new RailwayAPIError("Railway API URL is not set");
    }

    const response = await fetch(url, {
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
        `Railway API request failed: ${response.status} ${response.statusText}`,
      );
    }

    const result = (await response.json()) as GraphQLResponse<R>;

    if (result.errors && result.errors.length > 0) {
      throw new RailwayAPIError(
        `GraphQL errors: ${result.errors.map((e) => e.message).join(", ")}`,
        result.errors,
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

export type RailwayClient = ReturnType<typeof getSdk>;

let railwayClient: RailwayClient | null = null;

export async function createRailwayClient(): Promise<RailwayClient | null> {
  const dbConfig = await getProviderConfigService().getProviderConfigForUse("railway") as RailwayConfig | null;
  if (!dbConfig) {
    return null;
  }
  const requester = createRequester(dbConfig.apiUrl, dbConfig.apiToken);
  return getSdk(requester);
}

export async function getRailwayClient(): Promise<RailwayClient | null> {
  if (railwayClient) {
    return railwayClient;
  }
  railwayClient = await createRailwayClient();
  return railwayClient;
}

// Re-export types for convenience
export * from "./graphql/generated/railway";
