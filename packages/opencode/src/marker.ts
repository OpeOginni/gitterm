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

export type CloudProgress = {
  sessionID: string;
  attemptID: string;
  /** What the dialog is called: "Moving to the cloud", "Bringing it back from the cloud". */
  title: string;
  /** The step under way. Undefined when the run has ended and the dialog should close. */
  step?: string;
  /** Esc cancels the run. Otherwise Esc only hides the dialog. */
  cancellable: boolean;
};

const object = (properties: Record<string, { type: string }>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
});

/**
 * How the server plugin and the terminal plugin talk: the server reports each step of a run
 * as a `progress` event, and the terminal asks it to `cancel` a run.
 */
export const CLOUD_RPC = {
  id: "gitterm.cloud",
  methods: {
    cancel: {
      input: object({ sessionID: { type: "string" }, attemptID: { type: "string" } }, [
        "sessionID",
        "attemptID",
      ]),
      output: object({ cancelled: { type: "boolean" } }, ["cancelled"]),
    },
  },
  events: {
    progress: {
      schema: object(
        {
          sessionID: { type: "string" },
          attemptID: { type: "string" },
          title: { type: "string" },
          step: { type: "string" },
          cancellable: { type: "boolean" },
        },
        ["sessionID", "attemptID", "title", "cancellable"],
      ),
    },
  },
} as const;

export const CONNECT_KEY = "gittermConnect";

/** The form field that links to GitTerm's sign-in page. The terminal shows it as a dialog. */
export const SIGN_IN_KEY = "gittermSignIn";
