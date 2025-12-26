import { EventEmitter } from "node:events";
import { workspace } from "@gitterm/db/schema/workspace";

type WorkspaceStatus = typeof workspace.$inferSelect.status;

export type WorkspaceStatusEvent = {
	workspaceId: string;
	status: WorkspaceStatus;
	updatedAt: Date;
	userId: string;
	workspaceDomain: string;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const EVENT_NAME = "workspace-status";

export const workspaceEventEmitter = emitter;
export const WORKSPACE_STATUS_EVENT = EVENT_NAME;

export const WORKSPACE_EVENTS = {
	emitStatus(payload: WorkspaceStatusEvent) {
		emitter.emit(EVENT_NAME, payload);
	},
	onStatus(workspaceId: string, listener: (payload: WorkspaceStatusEvent) => void) {
		const scopedListener = (payload: WorkspaceStatusEvent) => {
			if (payload.workspaceId === workspaceId) {
				listener(payload);
			}
		};

		emitter.on(EVENT_NAME, scopedListener);
		return () => {
			emitter.off(EVENT_NAME, scopedListener);
		};
	},
	subscribe(listener: (payload: WorkspaceStatusEvent) => void) {
		emitter.on(EVENT_NAME, listener);
		return () => {
			emitter.off(EVENT_NAME, listener);
		};
	},
};

