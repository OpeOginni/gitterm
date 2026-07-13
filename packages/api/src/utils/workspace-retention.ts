export function isPausedWorkspacePastRetention(input: {
  status: string;
  lastActiveAt: Date | null;
  pausedAt: Date | null;
  threshold: Date;
}): boolean {
  return (
    input.status === "paused" &&
    input.lastActiveAt !== null &&
    input.lastActiveAt < input.threshold &&
    input.pausedAt !== null &&
    input.pausedAt < input.threshold
  );
}
