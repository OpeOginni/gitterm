function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DeviceCodeInfo = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
};

export type LoginWithDeviceCodeOptions = {
  clientName?: string;
  fetch?: typeof fetch;
  onCode?: (code: Omit<DeviceCodeInfo, "deviceCode">) => void | Promise<void>;
};

export async function loginWithDeviceCode(
  serverUrl: string,
  options: LoginWithDeviceCodeOptions = {},
): Promise<{ token: string }> {
  const fetchImpl = options.fetch ?? fetch;
  const codeRes = await fetchImpl(new URL("/api/device/code", serverUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientName: options.clientName ?? "gitterm" }),
  });

  if (!codeRes.ok) throw new Error(`Failed to start device login: ${codeRes.status}`);

  const codeJson = (await codeRes.json()) as DeviceCodeInfo;
  await options.onCode?.({
    userCode: codeJson.userCode,
    verificationUri: codeJson.verificationUri,
    intervalSeconds: codeJson.intervalSeconds,
    expiresInSeconds: codeJson.expiresInSeconds,
  });

  const deadline = Date.now() + codeJson.expiresInSeconds * 1000;
  while (Date.now() < deadline) {
    const tokenRes = await fetchImpl(new URL("/api/device/token", serverUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: codeJson.deviceCode }),
    });

    if (tokenRes.ok) {
      const tokenJson = (await tokenRes.json()) as { accessToken: string };
      return { token: tokenJson.accessToken };
    }

    if (tokenRes.status !== 428) {
      const errText = await tokenRes.text().catch(() => "");
      throw new Error(`Login failed: ${tokenRes.status} ${errText}`);
    }

    await sleep(Math.max(1, codeJson.intervalSeconds) * 1000);
  }

  throw new Error("Device code expired; try again.");
}
