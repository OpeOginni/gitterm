import { expect, test } from "bun:test";
import cliPackage from "../../../../../cli/package.json" with { type: "json" };
import { GITTERM_CLI_CACHE_BUST } from "./cli-package";

test("busts E2B CLI install cache with the package version", () => {
  expect(GITTERM_CLI_CACHE_BUST).toBe(`echo gitterm-cli-cache-bust=${cliPackage.version}`);
});
