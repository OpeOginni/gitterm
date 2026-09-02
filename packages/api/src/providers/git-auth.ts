import type { WorkspaceRepoProvisioning } from "./compute";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function inlineGitAuthCommands(repo: WorkspaceRepoProvisioning): {
  configure: string;
} | null {
  if (!repo.inlineAuth || !repo.authToken) return null;
  const username = repo.authUsername ?? "x-access-token";
  const directory = "/tmp/gitterm-repository-auth";
  const helperPath = `${directory}/git-credential-helper.sh`;
  const helper = `#!/bin/sh\nif [ "$1" = get ]; then\n  echo "username=$(cat ${directory}/username)"\n  echo "password=$(cat ${directory}/token)"\nfi\n`;
  return {
    configure: `mkdir -p ${directory} && printf %s ${shellQuote(username)} > ${directory}/username && printf %s ${shellQuote(repo.authToken)} > ${directory}/token && printf %s ${shellQuote(helper)} > ${helperPath} && chmod 700 ${helperPath} && chmod 600 ${directory}/username ${directory}/token && git config --global credential.helper ${shellQuote(helperPath)}`,
  };
}
