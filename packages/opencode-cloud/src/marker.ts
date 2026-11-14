/**
 * Metadata key on a local session that lives in a cloud workspace. /cloud sets it and
 * /cloud-return removes it; the terminal UI reads it to label the session.
 */
export const CLOUD_KEY = "gittermCloud";

/**
 * What the cloud side of a session is doing:
 *   working  the agent is running
 *   waiting  the agent asked a question or needs a permission, and is waiting for the user
 *   idle     nothing is running
 *   paused   the workspace is not running (paused for idleness, or by the user)
 *   gone     the workspace was deleted
 */
export type CloudStatus = "working" | "waiting" | "idle" | "paused" | "gone";

export type CloudMarker = { workspaceID: string; status?: CloudStatus };

export const PROGRESS_KEY = "gittermCloudProgress";
export const CANCEL_KEY = "gittermCloudCancel";

export type CloudProgress = { attemptID: string; step: string };

export const CONNECT_KEY = "gittermConnect";
