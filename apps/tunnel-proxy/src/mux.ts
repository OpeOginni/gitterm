export interface PendingStreamResponse {
	resolve: (response: Response) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	controller?: ReadableStreamDefaultController<Uint8Array>;
	stream: ReadableStream<Uint8Array>;
	resolved: boolean;
	bufferedChunks: Array<{ chunk: Uint8Array; final: boolean }>;
}

// Request/response correlator with streaming body support.
export class Multiplexer {
	private pending = new Map<string, PendingStreamResponse>();

	createRequestId(): string {
		return crypto.randomUUID();
	}

	register(id: string, timeoutMs: number): Promise<Response> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const entry = this.pending.get(id);
				if (entry?.controller) entry.controller.error(new Error("tunnel response timeout"));
				this.pending.delete(id);
				reject(new Error("tunnel response timeout"));
			}, timeoutMs);

			// Create stream - the start callback will update the entry's controller
			const stream = new ReadableStream<Uint8Array>({
				start: (controller) => {
					console.log("[MUX] ReadableStream.start - controller initialized:", { id });
					const entry = this.pending.get(id);
					if (entry) {
						entry.controller = controller;
						console.log("[MUX] ReadableStream.start - controller assigned, flushing buffer:", { 
							id, 
							bufferedCount: entry.bufferedChunks.length 
						});
						// Flush any buffered chunks
						for (const { chunk, final } of entry.bufferedChunks) {
							if (chunk.byteLength > 0) controller.enqueue(chunk);
							if (final) {
								controller.close();
								this.pending.delete(id);
							}
						}
						entry.bufferedChunks = [];
					}
				},
				cancel: () => {
					console.log("[MUX] ReadableStream.cancel:", { id });
					this.pending.delete(id);
				},
			});

			const entry: PendingStreamResponse = {
				resolve,
				reject,
				timer,
				controller: undefined, // Will be set by start() callback
				stream,
				resolved: false,
				bufferedChunks: [],
			};

			console.log("[MUX] register - entry created:", { id });
			this.pending.set(id, entry);
		});
	}

	resolveResponse(id: string, responseInit: ResponseInit) {
		const entry = this.pending.get(id);
		if (!entry || entry.resolved) return;
		clearTimeout(entry.timer);
		entry.resolved = true;
		console.log("[MUX] resolveResponse - creating Response with stream:", { id, hasController: !!entry.controller });
		entry.resolve(new Response(entry.stream, responseInit));
	}

	pushData(id: string, chunk: Uint8Array, final: boolean) {
		const entry = this.pending.get(id);
		if (!entry || !entry.resolved) {
			console.log("[MUX] pushData - entry not found or not resolved:", { id, hasEntry: !!entry, resolved: entry?.resolved });
			return;
		}
		
		// If controller not ready yet, buffer the chunk
		if (!entry.controller) {
			console.log("[MUX] pushData - controller not ready, buffering chunk:", { id, chunkSize: chunk.byteLength, final });
			entry.bufferedChunks.push({ chunk, final });
			return;
		}
		
		// Controller is ready, enqueue directly
		console.log("[MUX] pushData - enqueueing chunk:", { id, chunkSize: chunk.byteLength, final });
		if (chunk.byteLength > 0) entry.controller.enqueue(chunk);
		if (final) {
			console.log("[MUX] pushData - closing stream:", { id });
			entry.controller.close();
			this.pending.delete(id);
		}
	}

	reject(id: string, error: Error) {
		const entry = this.pending.get(id);
		if (!entry) return;
		clearTimeout(entry.timer);
		entry.controller?.error(error);
		this.pending.delete(id);
		entry.reject(error);
	}

	rejectAll(error: Error) {
		for (const [id, entry] of this.pending.entries()) {
			clearTimeout(entry.timer);
			entry.controller?.error(error);
			this.pending.delete(id);
			entry.reject(error);
		}
	}
}
