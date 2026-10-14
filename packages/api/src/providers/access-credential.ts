/** Provider-neutral credential capture. Never include command output in errors. */
export async function captureAgentAccessCredential(
  command: string | undefined,
  execute: (command: string) => Promise<{ exitCode: number; stdout: string }>,
): Promise<string | undefined> {
  if (!command) return undefined;
  try {
    const result = await execute(command);
    const credential = result.stdout.trim();
    if (result.exitCode === 0 && credential) return credential;
  } catch {
    // Native exec errors can contain secrets. Do not forward them to logs or callers.
  }
  throw new Error("Failed to capture agent access credential");
}
