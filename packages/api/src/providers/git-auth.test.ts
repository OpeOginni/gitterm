import { describe, expect, test } from "bun:test";
import { inlineGitAuthCommands } from "./git-auth";

describe("inlineGitAuthCommands", () => {
  test("defaults GitHub username and installs a protected runtime helper", () => {
    const commands = inlineGitAuthCommands({
      url: "https://github.com/acme/private-repo",
      authToken: "secret-token",
      inlineAuth: true,
    });

    expect(commands?.configure).toContain("x-access-token");
    expect(commands?.configure).not.toContain("https://github.com/acme/private-repo@secret-token");
    expect(commands?.configure).toContain("chmod 600");
  });

  test("shell-quotes credential values", () => {
    const commands = inlineGitAuthCommands({
      url: "https://github.com/acme/private-repo",
      authUsername: "$(touch /tmp/username-injection)",
      authToken: "token'with-quote",
      inlineAuth: true,
    });

    expect(commands?.configure).toContain(`'"'"'`);
    expect(commands?.configure).not.toContain('"username=$(touch');
  });
});
