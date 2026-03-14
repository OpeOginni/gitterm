export type WorkspaceToolingManifest = {
  version: 1;
  detectedFrom: {
    owner?: string;
    repo?: string;
    ref: string;
  };
  tools: {
    node: boolean;
    bun: boolean;
    python: boolean;
    rust: boolean;
    go: boolean;
    java: boolean;
    dotnet: boolean;
    buildTools: boolean;
  };
  packageManagers: {
    pnpm: boolean;
    yarn: boolean;
  };
  runtime: {
    maxScanDepth: number;
  };
};

export function createDefaultWorkspaceToolingManifest(
  owner?: string,
  repo?: string,
): WorkspaceToolingManifest {
  return {
    version: 1,
    detectedFrom: {
      owner,
      repo,
      ref: "default-branch",
    },
    tools: {
      node: false,
      bun: false,
      python: false,
      rust: false,
      go: false,
      java: false,
      dotnet: false,
      buildTools: false,
    },
    packageManagers: {
      pnpm: false,
      yarn: false,
    },
    runtime: {
      maxScanDepth: 4,
    },
  };
}

export function detectWorkspaceToolingManifestFromPaths(
  paths: string[],
  owner?: string,
  repo?: string,
): WorkspaceToolingManifest {
  const hasExact = (name: string) =>
    paths.some((path) => path === name || path.endsWith(`/${name}`));
  const hasRegex = (pattern: RegExp) => paths.some((path) => pattern.test(path));

  const hasNodeSignals =
    hasExact("package.json") ||
    hasExact("package-lock.json") ||
    hasExact("npm-shrinkwrap.json") ||
    hasExact("bun.lockb") ||
    hasExact("bun.lock") ||
    hasExact("pnpm-lock.yaml") ||
    hasExact("yarn.lock");

  const hasBun = hasExact("bun.lockb") || hasExact("bun.lock");
  const hasPnpm = hasExact("pnpm-lock.yaml");
  const hasYarn = hasExact("yarn.lock");
  const hasGo = hasExact("go.mod") || hasExact("go.work");
  const hasPython =
    hasExact("pyproject.toml") ||
    hasExact("requirements.txt") ||
    hasExact("Pipfile") ||
    hasExact("setup.py") ||
    hasExact("setup.cfg");
  const hasDotnet = hasRegex(/\.(csproj|sln|cs)$/i);
  const hasBuildTools =
    hasRegex(/\.(c|h|cpp|hpp|cc|cxx)$/i) || hasExact("CMakeLists.txt") || hasExact("Makefile");
  const hasRust =
    hasExact("Cargo.toml") ||
    hasExact("Cargo.lock") ||
    hasExact("rust-toolchain") ||
    hasExact("rust-toolchain.toml");
  const hasJava =
    hasExact("pom.xml") ||
    hasExact("build.gradle") ||
    hasExact("build.gradle.kts") ||
    hasExact("settings.gradle") ||
    hasExact("settings.gradle.kts") ||
    hasExact("gradlew") ||
    hasExact("mvnw") ||
    hasRegex(/\.java$/i);

  return {
    ...createDefaultWorkspaceToolingManifest(owner, repo),
    tools: {
      node: hasNodeSignals,
      bun: hasBun,
      python: hasPython,
      rust: hasRust,
      go: hasGo,
      java: hasJava,
      dotnet: hasDotnet,
      buildTools: hasBuildTools,
    },
    packageManagers: {
      pnpm: hasPnpm,
      yarn: hasYarn,
    },
  };
}

export function encodeWorkspaceToolingManifestBase64(manifest: WorkspaceToolingManifest): string {
  return Buffer.from(JSON.stringify(manifest)).toString("base64");
}
