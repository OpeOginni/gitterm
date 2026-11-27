/** Larger files are rarely what an agent needs, and travel as text through the terminal. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const base = () => location.pathname.replace(/\/+$/, "");

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Saves a file in the workspace and resolves with its path there. It travels over a second
 * ttyd connection that runs `session.sh upload <name> <size>` (ttyd's URL arguments) instead
 * of attaching to the agent: base64 in once the script says it's ready, the saved path out.
 */
export async function upload(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files over 20 MB can't be uploaded here.");
  const [data, response] = await Promise.all([
    base64(file),
    fetch(`${base()}/token`, { cache: "no-store", credentials: "same-origin" }),
  ]);
  if (!response.ok) throw new Error("The workspace didn't answer.");
  const { token } = await response.json();
  const args = ["upload", file.name || "file", String(data.length)];
  const url = new URL(
    `${base()}/ws?${args.map((arg) => `arg=${encodeURIComponent(arg)}`).join("&")}`,
    location.href,
  );
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const encoder = new TextEncoder();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, ["tty"]);
    socket.binaryType = "arraybuffer";
    let output = "";
    let sent = false;
    socket.onopen = () =>
      socket.send(encoder.encode(JSON.stringify({ AuthToken: token, columns: 80, rows: 24 })));
    socket.onmessage = (event) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes[0] !== 48) return;
      output += new TextDecoder().decode(bytes.subarray(1));
      if (!sent && output.includes("ready")) {
        sent = true;
        for (let at = 0; at < data.length; at += 32_768) {
          socket.send(encoder.encode(`0${data.slice(at, at + 32_768)}`));
        }
      }
      const saved = /saved (\S+)\r?\n/.exec(output);
      if (saved) {
        resolve(saved[1]);
        socket.close();
      }
    };
    socket.onclose = () => reject(new Error("The upload didn't finish."));
  });
}
