import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * What GitTerm may do in each project, kept on this machine only (never in the repository), in
 * `~/.config/gitterm/projects.json`, keyed by the checkout's root:
 *
 * ```json
 * { "/Users/me/code/shop": { "sandbox": false, "cloud": false } }
 * ```
 *
 * Every GitTerm integration honours it: the CLI, the OpenCode plugin, Pi's extension and the
 * skills. `gitterm project disable|enable` changes it.
 */
export type ProjectFeature = "sandbox" | "cloud";

export type ProjectSettings = {
  /** Remote sandboxes for the local agent. On unless turned off. */
  sandbox: boolean;
  /** Moving sessions to cloud workspaces. On unless turned off. */
  cloud: boolean;
  /** The project root the switches are saved for, or null when none are. */
  root: string | null;
};

type Saved = Record<string, Partial<Record<ProjectFeature, boolean>>>;

export function projectsFilePath(): string {
  return path.join(process.env.HOME || homedir(), ".config", "gitterm", "projects.json");
}

function load(): Saved {
  let text: string;
  try {
    text = readFileSync(projectsFilePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    return JSON.parse(text) as Saved;
  } catch (error) {
    throw new Error(`${projectsFilePath()} is not valid JSON.`, { cause: error });
  }
}

const real = (directory: string) => {
  try {
    return realpathSync(directory);
  } catch {
    return path.resolve(directory);
  }
};

/**
 * The switches for the project `directory` is in: those saved for it or the nearest folder
 * above it. A broken file is an error, never a silent "on".
 */
export function projectSettings(directory: string): ProjectSettings {
  const saved = load();
  for (let dir = real(directory); ; dir = path.dirname(dir)) {
    const entry = saved[dir];
    if (entry) return { sandbox: entry.sandbox !== false, cloud: entry.cloud !== false, root: dir };
    if (path.dirname(dir) === dir) return { sandbox: true, cloud: true, root: null };
  }
}

/** Turns features on or off for the project at `root`. */
export function setProjectFeatures(root: string, features: ProjectFeature[], on: boolean) {
  const saved = load();
  const key = real(root);
  const entry = { ...saved[key] };
  for (const feature of features) {
    if (on) delete entry[feature];
    else entry[feature] = false;
  }
  if (Object.keys(entry).length) saved[key] = entry;
  else delete saved[key];
  mkdirSync(path.dirname(projectsFilePath()), { recursive: true });
  writeFileSync(projectsFilePath(), `${JSON.stringify(saved, null, 2)}\n`);
  return projectSettings(key);
}

const FEATURE_NAMES: Record<ProjectFeature, string> = {
  sandbox: "Sandboxes are",
  cloud: "Moving sessions to the cloud is",
};

/** Throws when `feature` is turned off for the project at `directory`, saying how to turn it on. */
export function assertProjectAllows(directory: string, feature: ProjectFeature) {
  const settings = projectSettings(directory);
  if (!settings[feature])
    throw new Error(
      `${FEATURE_NAMES[feature]} turned off for this project (${settings.root}) on this machine. Run \`gitterm project enable ${feature}\` there to turn it back on.`,
    );
}
