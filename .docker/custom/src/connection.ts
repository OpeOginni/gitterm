export type ConnectionState = "connecting" | "connected" | "disconnected";

// ttyd's small, versioned transport boundary. No upstream frontend internals.
export class Connection {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private attempt = 0;
  private generation = 0;
  private lastActivity = 0;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private state: ConnectionState = "disconnected";
  private base = location.pathname.replace(/\/+$/, "");
  private abort?: AbortController;

  constructor(
    private callbacks: {
      state(state: ConnectionState): void;
      size(): { cols: number; rows: number };
      output(data: Uint8Array, done: () => void): void;
      reset(): void;
      preferences(value: Record<string, unknown>): void;
    },
  ) {}

  get connected() {
    return this.state === "connected" && this.socket?.readyState === WebSocket.OPEN;
  }

  resume() {
    // Do not replace a live client: attaching again changes tmux's sizing owner.
    // ttyd/libwebsockets handles dead-peer detection; onclose schedules recovery.
    if (!this.connected && this.state !== "connecting") void this.connect();
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.callbacks.state(state);
  }

  async connect() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    const generation = ++this.generation;
    this.abort?.abort();
    this.socket?.close();
    this.setState("connecting");
    this.abort = new AbortController();
    this.deadline = setTimeout(() => {
      if (generation !== this.generation || this.stopped) return;
      // Recover hung token requests and sockets that never finish the handshake.
      this.generation++;
      this.abort?.abort();
      this.socket?.close();
      this.retry();
    }, 15_000);
    try {
      const response = await fetch(`${this.base}/token`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: this.abort.signal,
      });
      if (!response.ok) throw new Error(`Token request failed: ${response.status}`);
      const { token } = await response.json();
      if (this.stopped || generation !== this.generation) return;
      const url = new URL(`${this.base}/ws${location.search}`, location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = (this.socket = new WebSocket(url, ["tty"]));
      socket.binaryType = "arraybuffer";
      let pending = 0;
      socket.onopen = () => {
        if (generation !== this.generation || this.stopped) return;
        this.callbacks.reset();
        const { cols, rows } = this.callbacks.size();
        socket.send(this.encoder.encode(JSON.stringify({ AuthToken: token, columns: cols, rows })));
        // Wait for server preferences before enabling input (including readonly).
      };
      socket.onmessage = (event) => {
        if (generation !== this.generation || this.stopped) return;
        const data = new Uint8Array(event.data as ArrayBuffer);
        if (data[0] === 48) {
          const chunk = data.subarray(1);
          pending += chunk.length;
          if (pending > 500_000) this.control("2");
          this.callbacks.output(chunk, () => {
            if (generation !== this.generation) return;
            const before = pending;
            pending -= chunk.length;
            if (before > 100_000 && pending <= 100_000) this.control("3");
          });
        } else if (data[0] === 50) {
          try {
            this.callbacks.preferences(JSON.parse(this.decoder.decode(data.subarray(1))));
            clearTimeout(this.deadline);
            this.attempt = 0;
            this.setState("connected");
          } catch {
            socket.close();
          }
        }
      };
      socket.onclose = () => {
        if (generation === this.generation && !this.stopped) this.retry();
      };
      socket.onerror = () => socket.close();
    } catch {
      if (generation === this.generation && !this.stopped) this.retry();
    }
  }

  private retry() {
    clearTimeout(this.deadline);
    this.setState("disconnected");
    this.timer = setTimeout(
      () => void this.connect(),
      Math.min(1000 * 2 ** this.attempt++, 15_000),
    );
  }

  activity() {
    if (!this.connected || Date.now() - this.lastActivity < 60_000) return;
    this.lastActivity = Date.now();
    void fetch(`${this.base}/token`, { cache: "no-store", credentials: "same-origin" }).catch(
      () => {},
    );
  }

  send(data: string | Uint8Array): boolean {
    if (!this.connected) return false;
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data;
    const payload = new Uint8Array(bytes.length + 1);
    payload[0] = 48;
    payload.set(bytes, 1);
    try {
      this.socket!.send(payload);
    } catch {
      return false;
    }
    this.activity();
    return true;
  }

  resize(cols: number, rows: number) {
    this.control(`1${JSON.stringify({ columns: cols, rows })}`);
  }

  private control(data: string) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(this.encoder.encode(data));
  }

  dispose() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.abort?.abort();
    this.socket?.close();
  }
}
