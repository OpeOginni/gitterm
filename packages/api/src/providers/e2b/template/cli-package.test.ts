import { expect, test } from "bun:test";
import cliPackage from "../../../../../cli/package.json" with { type: "json" };
import { GITTERM_CLI_PACKAGE } from "./cli-package";

test("pins the published CLI version from the checkout", () => {
  expect(GITTERM_CLI_PACKAGE).toBe(`@gitterm/cli@${cliPackage.version}`);
});
