export interface PendingStreamResponse {
	resolve: (response: Response) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
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
			console.log("[MUX] Cancelling existing SSE connection:", { sseKey, existingId });
			const entry = this.pending.get(existingId);
			if (entry) {
				clearTimeout(entry.timer);
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

	register(id: string, timeoutMs: number, onCancel?: () => void, sseKey?: string): Promise<Response> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const entry = this.pending.get(id);
				if (entry?.controller) entry.controller.error(new Error("tunnel response timeout"));
				this.pending.delete(id);
				reject(new Error("tunnel response timeout"));
			}, timeoutMs);

			// Capture controller directly - Bun calls start() synchronously
			let capturedController: ReadableStreamDefaultController<Uint8Array> | undefined;

			const stream = new ReadableStream<Uint8Array>({
				start: (controller) => {
					capturedController = controller;
				},
				cancel: () => {
					console.log("[MUX] stream cancelled:", { id });
					const entry = this.pending.get(id);
					if (entry?.onCancel) entry.onCancel();
					// Clean up SSE tracking if this was an SSE connection
					if (entry?.sseKey) {
						this.activeSSE.delete(entry.sseKey);
					}
					this.pending.delete(id);
				},
			});

			// Now capturedController is set (since start() ran synchronously)
			const entry: PendingStreamResponse = {
				resolve,
				reject,
				timer,
				controller: capturedController,
				stream,
				resolved: false,
				bufferedChunks: [],
				onCancel,
				sseKey,
			};

			console.log("[MUX] register:", { id, hasController: !!capturedController, sseKey });
			this.pending.set(id, entry);
		});
	}

	resolveResponse(id: string, responseInit: ResponseInit) {
		const entry = this.pending.get(id);
		if (!entry || entry.resolved) return;
		clearTimeout(entry.timer);
		entry.resolved = true;
		entry.resolve(new Response(entry.stream, responseInit));
	}

	pushData(id: string, chunk: Uint8Array, final: boolean) {
		const entry = this.pending.get(id);
		if (!entry || !entry.resolved) return;
		
		// If controller not ready yet, buffer the chunk
		if (!entry.controller) {
			entry.bufferedChunks.push({ chunk, final });
			return;
		}
		
		// Controller is ready, enqueue directly
		if (chunk.byteLength > 0) entry.controller.enqueue(chunk);
		if (final) {
			entry.controller.close();
			// Clean up SSE tracking if this was an SSE connection
			if (entry.sseKey) {
				this.activeSSE.delete(entry.sseKey);
			}
			this.pending.delete(id);
		}
	}

	reject(id: string, error: Error) {
		const entry = this.pending.get(id);
		if (!entry) return;
		clearTimeout(entry.timer);
		entry.controller?.error(error);
		// Clean up SSE tracking if this was an SSE connection
		if (entry.sseKey) {
			this.activeSSE.delete(entry.sseKey);
		}
		this.pending.delete(id);
		entry.reject(error);
	}

	rejectAll(error: Error) {
		for (const [id, entry] of this.pending.entries()) {
			clearTimeout(entry.timer);
			entry.controller?.error(error);
			// Clean up SSE tracking
			if (entry.sseKey) {
				this.activeSSE.delete(entry.sseKey);
			}
			this.pending.delete(id);
			entry.reject(error);
		}
	}
}
