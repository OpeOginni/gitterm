import { createGittermWorkspaceClient } from "@gitterm/sdk";
import { handleError, printJson, startSpinner, success } from "../ui.js";

type JsonArgs = { json?: boolean };

export async function runCurrentWorkspaceInfo(args: JsonArgs) {
  const spin = startSpinner("Fetching workspace...", args.json);
  try {
    const result = await createGittermWorkspaceClient().self.get();
    spin?.stop();
    if (args.json) return printJson(result);
    console.log(`${result.name ?? "GitTerm workspace"} (${result.id})`);
    console.log(`Status: ${result.status}`);
    if (result.repositoryUrl) console.log(`Repository: ${result.repositoryUrl}`);
    if (result.url) console.log(`URL: ${result.url}`);
  } catch (error) {
    spin?.stop();
    handleError(error, args.json);
  }
}

export async function runPortList(args: JsonArgs) {
  try {
    const ports = await createGittermWorkspaceClient().ports.list();
    if (args.json) return printJson(ports);
    if (ports.length === 0) {
      console.log("No ports are open.");
      return;
    }
    for (const port of ports) console.log(`${port.port}\t${port.name ?? ""}\t${port.url ?? ""}`);
  } catch (error) {
    handleError(error, args.json);
  }
}

export async function runPortOpen(args: JsonArgs & { port: number; name?: string }) {
  const spin = startSpinner(`Opening port ${args.port}...`, args.json);
  try {
    const port = await createGittermWorkspaceClient().ports.open(args.port, { name: args.name });
    spin?.stop();
    if (args.json) return printJson(port);
    success(`Port ${port.port} opened${port.url ? `: ${port.url}` : "."}`);
  } catch (error) {
    spin?.stop();
    handleError(error, args.json);
  }
}

export async function runPortClose(args: JsonArgs & { port: number }) {
  const spin = startSpinner(`Closing port ${args.port}...`, args.json);
  try {
    const result = await createGittermWorkspaceClient().ports.close(args.port);
    spin?.stop();
    if (args.json) return printJson(result);
    success(`Port ${result.port} closed.`);
  } catch (error) {
    spin?.stop();
    handleError(error, args.json);
  }
}
