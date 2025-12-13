export interface PendingStreamResponse {
	resolve: (response: Response) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	controller?: ReadableStreamDefaultController<Uint8Array>;
	stream: ReadableStream<Uint8Array>;
	resolved: boolean;
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

			const stream = new ReadableStream<Uint8Array>({
				start: (controller) => {
					// Update the entry with the controller after it's been added to the map
					const entry = this.pending.get(id);
					if (entry) {
						console.log("[MUX] ReadableStream.start - setting controller:", { id });
						entry.controller = controller;
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
				controller: undefined,
				stream,
				resolved: false,
			};

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
		if (!entry.controller) {
			console.log("[MUX] pushData - controller not initialized yet:", { id });
			return;
		}
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
