import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.get("/test/reset");
});

const state = async (request: APIRequestContext) =>
  (await (await request.get("/test/state")).json()) as {
    inputs: string[];
    uploads: { args: string[]; data: string }[];
  };
const output = (request: APIRequestContext, data: string) =>
  request.get(`/test/output?data=${encodeURIComponent(data)}`);

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
}

/** The key bar and composer are only on touch screens. */
async function requiresTouch(page: Page) {
  test.skip(!(await page.locator(".touch-bar").isVisible()), "Touch screens only.");
}

test("names the agent ttyd describes and offers its keys", async ({ page, request }) => {
  await open(page);
  await expect(page).toHaveTitle("Test agent");
  await requiresTouch(page);
  await expect(page.getByPlaceholder("Message Test agent")).toBeVisible();
  await page.getByRole("button", { name: "Model" }).click();
  await expect.poll(async () => (await state(request)).inputs).toEqual(["\x0c"]);
});

test("the composer pastes a prompt, then sends Enter on its own", async ({ page, request }) => {
  await open(page);
  await requiresTouch(page);
  await page.getByPlaceholder("Message Test agent").fill("fix the bug\nin main.ts");
  await page.getByRole("button", { name: "Send" }).click();
  await expect
    .poll(async () => (await state(request)).inputs)
    .toEqual(["\x1b[200~fix the bug\rin main.ts\x1b[201~", "\r"]);
  await expect(page.getByPlaceholder("Message Test agent")).toHaveValue("");
  // An empty composer sends Enter, e.g. to confirm.
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(async () => (await state(request)).inputs.at(-1)).toBe("\r");
});

test("sticky Ctrl turns the next key into a control key", async ({ page, request }) => {
  await open(page);
  await requiresTouch(page);
  await page.getByRole("button", { name: "Ctrl" }).click();
  await expect(page.getByRole("button", { name: "Ctrl" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".xterm-helper-textarea").pressSequentially("l");
  await expect.poll(async () => (await state(request)).inputs).toEqual(["\x0c"]);
  await expect(page.getByRole("button", { name: "Ctrl" })).toHaveAttribute("aria-pressed", "false");
  await page.locator(".xterm-helper-textarea").pressSequentially("l");
  await expect.poll(async () => (await state(request)).inputs).toEqual(["\x0c", "l"]);
});

test("a long press shows the screen as text to select", async ({ page, request }) => {
  await open(page);
  await requiresTouch(page);
  await output(request, "first line\r\nsecond line");
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  await page.locator(".xterm-screen").evaluate(
    (screen, { x, y }) => {
      const touch = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", {
          value: type === "touchend" ? [] : [{ clientX: x, clientY: y }],
        });
        screen.dispatchEvent(event);
      };
      touch("touchstart");
      return new Promise((resolve) => setTimeout(() => resolve(touch("touchend")), 700));
    },
    { x: box.x + 40, y: box.y + 20 },
  );
  await expect(page.locator(".screen-text pre")).toContainText("first line\nsecond line");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".screen-text")).toHaveCount(0);
});

test("a copy in the terminal reaches the clipboard", async ({ page, context, request }) => {
  test.skip(test.info().project.name !== "chromium", "Clipboard permissions are Chromium's.");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await output(request, `\x1b]52;c;${Buffer.from("copied text").toString("base64")}\x07`);
  await expect(page.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("copied text");
});

test("without a clipboard API, a copy can still be selected by hand", async ({ page, request }) => {
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined }),
  );
  await open(page);
  await output(request, `\x1b]52;c;${Buffer.from("copied text").toString("base64")}\x07`);
  await page.getByRole("button", { name: "Tap to copy" }).click();
  await expect(page.locator(".screen-text pre")).toHaveText("copied text");
});

test("several lines wait for a prompt that takes them as one paste", async ({ page, request }) => {
  await open(page);
  await requiresTouch(page);
  // The agent exited to a shell, which doesn't ask for bracketed paste.
  await output(request, "\x1b[?2004l$ ");
  const composer = page.getByPlaceholder("Message Test agent");
  await composer.fill("rm -rf build\necho done");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status")).toContainText("Kept your message");
  await expect(composer).toHaveValue("rm -rf build\necho done");
  expect((await state(request)).inputs).toEqual([]);
  // One line is safe to type.
  await composer.fill("ls");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(async () => (await state(request)).inputs).toEqual(["ls", "\r"]);
});

test("Enter that can't follow its paste keeps the message", async ({ page, request }) => {
  await open(page);
  await requiresTouch(page);
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  const composer = page.getByPlaceholder("Message Test agent");
  await composer.fill("fix the bug");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(async () => (await state(request)).inputs).toHaveLength(1);
  // The connection drops between the paste and its Enter.
  await request.get("/test/drop");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "disconnected");
  await page.clock.runFor(100);
  await expect(page.getByRole("status").last()).toContainText("kept your message");
  await expect(composer).toHaveValue("fix the bug");
  expect((await state(request)).inputs).toEqual(["\x1b[200~fix the bug\x1b[201~"]);
});

test("every path the terminal couldn't take stays to copy", async ({ page, context, request }) => {
  test.skip(test.info().project.name !== "chromium", "Dropping files is the desktop's way.");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await request.get("/test/drop");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "disconnected");
  const drop = (names: string[]) =>
    page.evaluate((names) => {
      const transfer = new DataTransfer();
      for (const name of names) transfer.items.add(new File([name], name));
      document
        .querySelector(".workspace-shell")!
        .dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
    }, names);
  // Two batches, one after the other: the second keeps the first's paths.
  await drop(["one.png", "two.png"]);
  await expect(page.getByRole("button", { name: "Copy 2 saved paths" })).toBeVisible();
  await drop(["three.png"]);
  await page.getByRole("button", { name: "Copy 3 saved paths" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    ["one.png", "two.png", "three.png"]
      .map((name) => `/home/u/.gitterm/uploads/1-${name}`)
      .join(" "),
  );
  await expect(page.locator(".unplaced")).toHaveCount(0);
});

test("a path saved while copying stays to copy", async ({ page, request }) => {
  test.skip(test.info().project.name !== "chromium", "Dropping files is the desktop's way.");
  // A clipboard write that finishes only when the test says so.
  await page.addInitScript(() => {
    const clipboard = {
      writes: [] as string[],
      finish: () => {},
      writeText(text: string) {
        clipboard.writes.push(text);
        return new Promise<void>((resolve) => (clipboard.finish = resolve));
      },
    };
    Object.defineProperty(Navigator.prototype, "clipboard", { get: () => clipboard });
  });
  await open(page);
  await request.get("/test/drop");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "disconnected");
  const drop = (name: string) =>
    page.evaluate((name) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([name], name));
      document
        .querySelector(".workspace-shell")!
        .dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
    }, name);
  await drop("one.png");
  await page.getByRole("button", { name: "Copy the saved path" }).click();
  await drop("two.png");
  await expect(page.getByRole("button", { name: "Copy 2 saved paths" })).toBeVisible();
  await page.evaluate(() => (navigator.clipboard as unknown as { finish(): void }).finish());
  // The copy held only the first path, so the second stays.
  await expect(page.getByRole("button", { name: "Copy the saved path" })).toBeVisible();
  await page.getByRole("button", { name: "Copy the saved path" }).click();
  expect(
    await page.evaluate(() => (navigator.clipboard as unknown as { writes: string[] }).writes),
  ).toEqual(["/home/u/.gitterm/uploads/1-one.png", "/home/u/.gitterm/uploads/1-two.png"]);
});

test("an attached file uploads and its path goes in the prompt", async ({ page, request }) => {
  await open(page);
  const file = { name: "shot.png", mimeType: "image/png", buffer: Buffer.from("not really a png") };
  const touch = await page.locator(".touch-bar").isVisible();
  if (touch) {
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByPlaceholder("Message Test agent")).toHaveValue(
      "/home/u/.gitterm/uploads/1-shot.png ",
    );
  } else {
    // A keyboard user drops (or pastes) files on the terminal instead.
    await page.evaluate(
      ({ name, mimeType, data }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([data], name, { type: mimeType }));
        document
          .querySelector(".workspace-shell")!
          .dispatchEvent(
            new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
          );
      },
      { name: file.name, mimeType: file.mimeType, data: file.buffer.toString() },
    );
    await expect
      .poll(async () => (await state(request)).inputs)
      .toEqual(["\x1b[200~/home/u/.gitterm/uploads/1-shot.png \x1b[201~"]);
  }
  const [upload] = (await state(request)).uploads;
  expect(upload.args.slice(0, 2)).toEqual(["upload", "shot.png"]);
  expect(Buffer.from(upload.data, "base64").toString()).toBe("not really a png");
});

test("a hidden tab's title says when output goes quiet", async ({ page, request }) => {
  await page.clock.install();
  await open(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await output(request, "working…");
  await page.clock.runFor(5000);
  await expect(page).toHaveTitle("● Test agent");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page).toHaveTitle("Test agent");
});

test("reconnects after the connection drops", async ({ page, request }) => {
  await open(page);
  await request.get("/test/disconnect");
  await expect(page.getByRole("status")).toHaveText(/Connecting|Disconnected/);
  await request.get("/test/online");
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
});

test("the composer stays above the software keyboard", async ({ page }) => {
  await open(page);
  await requiresTouch(page);
  await page.setViewportSize({ width: 390, height: 430 });
  await expect
    .poll(async () => {
      const box = await page.locator(".touch-bar").boundingBox();
      return box!.y + box!.height;
    })
    .toBeLessThanOrEqual(430);
});
