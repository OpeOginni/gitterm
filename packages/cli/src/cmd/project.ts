import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  projectSettings,
  projectsFilePath,
  resetProject,
  setProjectFeatures,
  type ProjectFeature,
} from "@gitterm/sdk";
import chalk from "chalk";
import { handleError, printJson, success } from "../ui.js";

type Feature = ProjectFeature | "all";
const FEATURES: ProjectFeature[] = ["sandbox", "cloud"];
const LABELS: Record<ProjectFeature, string> = {
  sandbox: "Sandboxes",
  cloud: "Moving sessions to the cloud",
};

/** The project a command is run in: the Git checkout's root, or the directory itself. */
export const projectRoot = (dir = process.cwd()) =>
  promisify(execFile)("git", ["-C", dir, "rev-parse", "--show-toplevel"]).then(
    (result) => result.stdout.trim(),
    () => dir,
  );

/** Shows what this project allows on this machine. */
export async function runProjectStatus(args: { json?: boolean }) {
  try {
    const settings = projectSettings(process.cwd());
    if (args.json) return printJson(settings);
    for (const feature of FEATURES)
      console.log(
        `${LABELS[feature]}: ${settings[feature] ? chalk.green("on") : chalk.yellow("off")}`,
      );
    if (settings.sandbox)
      console.log(
        `Sandbox steps: ${settings.approved ? "approved, they don't ask (Always in this project)" : "ask before creating, syncing and applying"}`,
      );
    if (settings.root) console.log(chalk.dim(`Set for ${settings.root} in ${projectsFilePath()}`));
  } catch (error) {
    handleError(error, args.json);
  }
}

/**
 * Turns a feature on or off for this project, on this machine only. Every GitTerm integration
 * (the CLI, the OpenCode plugin, Pi's extension, the skills) honours it.
 */
export async function runProjectSet(args: { feature: Feature; on: boolean; json?: boolean }) {
  try {
    const root = await projectRoot();
    const features = args.feature === "all" ? FEATURES : [args.feature];
    const settings = setProjectFeatures(root, features, args.on);
    if (args.json) return printJson(settings);
    const what = features.map((feature) => LABELS[feature].toLowerCase()).join(" and ");
    success(
      `${what[0]!.toUpperCase()}${what.slice(1)}: ${args.on ? "on" : "off"} for ${root} on this machine.`,
    );
    console.log("Restart your agents to pick it up.");
  } catch (error) {
    handleError(error, args.json);
  }
}

/** Forgets what this machine saved for the project: everything on, and asking again. */
export async function runProjectReset(args: { json?: boolean }) {
  try {
    const root = await projectRoot();
    const settings = resetProject(root);
    if (args.json) return printJson(settings);
    success(`Forgot the settings for ${root}: everything is on, and sandbox steps ask again.`);
  } catch (error) {
    handleError(error, args.json);
  }
}
