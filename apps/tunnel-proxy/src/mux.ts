export interface PendingStreamResponse {
	resolve: (response: Response) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
	controller?: ReadableStreamDefaultController<Uint8Array>;
	stream: ReadableStream<Uint8Array>;
	resolved: boolean;
	bufferedChunks: Array<{ chunk: Uint8Array; final: boolean }>;
	onCancel?: () => void;
	sseKey?: string; // For SSE deduplication tracking
}

// SSE endpoints that should be deduplicated (only one connection allowed at a time)
const SSE_DEDUPE_PATHS = ["/global/event"];

function isSSEDedupePath(path: string): boolean {
	// Check if path matches any SSE dedupe pattern (ignoring query string)
	const pathWithoutQuery = path.split("?")[0];
	return SSE_DEDUPE_PATHS.some(p => pathWithoutQuery === p);
}

// Request/response correlator with streaming body support.
export class Multiplexer {
	private pending = new Map<string, PendingStreamResponse>();
	// Track active SSE connections by key (for deduplication)
	private activeSSE = new Map<string, string>(); // sseKey -> requestId

	createRequestId(): string {
		return crypto.randomUUID();
	}

	/**
	 * Cancel any existing SSE connection for the given key.
	 * Returns the cancelled request ID if one was found.
	 */
	cancelExistingSSE(sseKey: string): string | undefined {
		const existingId = this.activeSSE.get(sseKey);
		if (existingId) {
			console.log("[MUX-SSE] Cancelling existing SSE for deduplication:", { sseKey, existingId });
			const entry = this.pending.get(existingId);
			if (entry) {
				if (entry.timer) clearTimeout(entry.timer);
				// Close the stream gracefully
				try {
					entry.controller?.close();
				} catch {
					// ignore if already closed
				}
				this.pending.delete(existingId);
				// Trigger onCancel to notify agent
				if (entry.onCancel) entry.onCancel();
			}
			this.activeSSE.delete(sseKey);
			return existingId;
		}
		return undefined;
	}

	/**
	 * Check if a path should be deduplicated as SSE
	 */
	shouldDedupeSSE(path: string): boolean {
		return isSSEDedupePath(path);
	}

	/**
	 * Register an SSE connection for deduplication tracking
	 */
	registerSSE(sseKey: string, requestId: string): void {
		this.activeSSE.set(sseKey, requestId);
	}

	register(id: string, timeoutMs: number | null, onCancel?: () => void, sseKey?: string): Promise<Response> {
		return new Promise((resolve, reject) => {
			const timer =
				timeoutMs == null
					? undefined
					: setTimeout(() => {
						const entry = this.pending.get(id);
						if (entry?.controller) entry.controller.error(new Error("tunnel response timeout"));
						this.pending.delete(id);
						reject(new Error("tunnel response timeout"));
					}, timeoutMs);

			const flushBufferedChunks = (entry: PendingStreamResponse) => {
				if (!entry.controller) return;
				if (entry.bufferedChunks.length === 0) return;

				for (const buffered of entry.bufferedChunks) {
					if (buffered.chunk.byteLength > 0) entry.controller.enqueue(buffered.chunk);
					if (buffered.final) {
						entry.controller.close();
						if (entry.sseKey) this.activeSSE.delete(entry.sseKey);
						this.pending.delete(id);
						break;
					}
				}

				entry.bufferedChunks = [];
			};

			let controllerFromStart: ReadableStreamDefaultController<Uint8Array> | undefined;
			const stream = new ReadableStream<Uint8Array>({
				start: (controller) => {
					// NOTE: In Bun, `start()` can run before we call `this.pending.set(...)`.
					// Capture the controller so we can attach it after we create the entry.
					controllerFromStart = controller;

					const entry = this.pending.get(id);
					if (!entry) return;
					entry.controller = controller;
					flushBufferedChunks(entry);
				},
				cancel: () => {
					const entry = this.pending.get(id);
					// Log SSE cancellations to debug client disconnects
					if (entry?.sseKey) {
						console.log("[MUX-SSE] SSE stream cancelled by client:", { id, sseKey: entry.sseKey });
					}
					if (entry?.onCancel) entry.onCancel();
					if (entry?.sseKey) this.activeSSE.delete(entry.sseKey);
					if (entry?.timer) clearTimeout(entry.timer);
					this.pending.delete(id);
				},
			});

			const entry: PendingStreamResponse = {
				resolve,
				reject,
				timer,
				controller: undefined,
				stream,
				resolved: false,
				bufferedChunks: [],
				onCancel,
				sseKey,
			};

			this.pending.set(id, entry);

			if (controllerFromStart) {
				entry.controller = controllerFromStart;
				flushBufferedChunks(entry);
			}
		});
	}

	resolveResponse(id: string, responseInit: ResponseInit) {
		const entry = this.pending.get(id);
		if (!entry || entry.resolved) return;
		if (entry.timer) clearTimeout(entry.timer);
		entry.resolved = true;
		entry.resolve(new Response(entry.stream, responseInit));
	}

	pushData(id: string, chunk: Uint8Array, final: boolean) {
		const entry = this.pending.get(id);
		if (!entry || !entry.resolved) return;

		// If controller not ready yet, buffer the chunk.
		// This can happen if the agent starts streaming body bytes immediately after the
		// `response` frame, before the Response stream gets consumed.
		if (!entry.controller) {
			entry.bufferedChunks.push({ chunk, final });
			return;
		}

		if (chunk.byteLength > 0) entry.controller.enqueue(chunk);
		if (final) {
			entry.controller.close();
			if (entry.sseKey) this.activeSSE.delete(entry.sseKey);
			this.pending.delete(id);
		}
	}

	reject(id: string, error: Error) {
		const entry = this.pending.get(id);
		if (!entry) return;
		if (entry.timer) clearTimeout(entry.timer);
		entry.controller?.error(error);
		if (entry.sseKey) this.activeSSE.delete(entry.sseKey);
		this.pending.delete(id);
		entry.reject(error);
	}

	rejectAll(error: Error) {
		for (const [id, entry] of this.pending.entries()) {
			if (entry.timer) clearTimeout(entry.timer);
			entry.controller?.error(error);
			if (entry.sseKey) this.activeSSE.delete(entry.sseKey);
			this.pending.delete(id);
			entry.reject(error);
		}
	}
}
