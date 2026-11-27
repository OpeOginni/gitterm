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
