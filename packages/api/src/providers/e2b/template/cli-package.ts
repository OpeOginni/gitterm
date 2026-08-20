import cliPackage from "../../../../../cli/package.json" with { type: "json" };

export const GITTERM_CLI_CACHE_BUST = `echo gitterm-cli-cache-bust=${cliPackage.version}`;
