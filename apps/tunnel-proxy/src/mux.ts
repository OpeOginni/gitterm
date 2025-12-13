export interface PendingStreamResponse {
	resolve: (response: Response) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	controller?: ReadableStreamDefaultController<Uint8Array>;
	stream: ReadableStream<Uint8Array>;
	resolved: boolean;
	bufferedChunks: Array<{ chunk: Uint8Array; final: boolean }>;
	onCancel?: () => void;
}

// Request/response correlator with streaming body support.
export class Multiplexer {
	private pending = new Map<string, PendingStreamResponse>();

	createRequestId(): string {
		return crypto.randomUUID();
	}

	register(id: string, timeoutMs: number, onCancel?: () => void): Promise<Response> {
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
			};

			console.log("[MUX] register:", { id, hasController: !!capturedController });
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
