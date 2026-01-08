export function generateUserData(repoUrl: string, branch: string = "main") {
  const script = `#!/bin/bash
  REPO_URL="${repoUrl}"
  BRANCH="${branch}"
  
  docker run -d \
    -p 22:22 \
    -p 3000:3000 \
    -e GIT_REPO_URL="$REPO_URL" \
    -e GIT_BRANCH="$BRANCH" \
    -v /workspace:/workspace \
    --name gitterm-agent \
    gitterm-agent:latest
    `;

  const base64 = Buffer.from(script).toString("base64");
  return base64;
}
