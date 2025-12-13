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

			const entry: PendingStreamResponse = {
				resolve,
				reject,
				timer,
				resolved: false,
				stream: new ReadableStream<Uint8Array>({
					start: (controller) => {
						entry.controller = controller;
					},
					cancel: () => {
						this.pending.delete(id);
					},
				}),
			};

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
		if (chunk.byteLength > 0) entry.controller?.enqueue(chunk);
		if (final) {
			entry.controller?.close();
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
