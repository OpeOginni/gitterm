import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.get("/test/reset");
});

const state = async (request: APIRequestContext) =>
  (await (await request.get("/test/state")).json()) as {
    inputs: string[];
    sizes: { columns: number; rows: number }[];
    tokenRequests: number;
  };

/** Accessory keys are only rendered for touch-first devices. */
async function requiresTouch(page: Page) {
  test.skip(!(await page.locator(".mobile-input").isVisible()), "Accessory keys are touch-only.");
}

test("fits the viewport and toggles wide mode", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  for (const label of ["Wide", "Settings"]) {
    const box = await page.getByRole("button", { name: label, exact: true }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  const before = (await state(request)).sizes.at(-1)!.columns;
  await page.getByRole("button", { name: "Wide", exact: true }).click();
  await expect.poll(async () => (await state(request)).sizes.at(-1)!.columns).toBeGreaterThan(120);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect.poll(async () => (await state(request)).sizes.at(-1)!.columns).toBe(before);
});

test("touch layout keeps the key bar above the software keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await requiresTouch(page);
  const bar = page.locator(".mobile-input");
  await page.setViewportSize({ width: 390, height: 430 });
  await expect
    .poll(async () => {
      const box = await bar.boundingBox();
      return box!.y + box!.height;
    })
    .toBeLessThanOrEqual(430);
});

test("touch draft inserts without submitting and retains text", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  await requiresTouch(page);
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await page.locator("#draft").fill("hello\nworld 🌍");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  // The editor closes so the prompt is visible; the framed paste is sent, not submitted.
  await expect(page.locator("#draft")).toHaveCount(0);
  await expect
    .poll(async () => (await state(request)).inputs)
    .toEqual(["\x1b[200~hello\rworld 🌍\x1b[201~"]);
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect.poll(async () => (await state(request)).inputs.at(-1)).toBe("\r");
  // Reopening the editor shows the retained draft, proving Insert did not clear it.
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(page.locator("#draft")).toHaveValue("hello\nworld 🌍");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator("#draft")).toHaveValue("");
});

test("touch retains the draft through disconnect and refuses unbracketed paste", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  await requiresTouch(page);
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await page.locator("#draft").fill("keep\nthis");
  await request.get("/test/disconnect");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "disconnected");
  await expect(page.getByRole("button", { name: "Insert", exact: true })).toBeDisabled();
  await expect(page.locator("#draft")).toHaveValue("keep\nthis");
  await request.get("/test/online");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected", {
    timeout: 20_000,
  });
  // Turn bracketed paste off: the multiline draft must be refused, not executed.
  await request.get(`/test/output?data=${encodeURIComponent("\x1b[?2004l")}`);
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-bracketed-paste", "false");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.locator("#draft")).toHaveValue("keep\nthis");
  expect((await state(request)).inputs).toEqual([]);
});

test("readonly shows status and disables input", async ({ page, request }) => {
  await request.get("/test/readonly");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  await expect(page.getByRole("status").first()).toHaveText("Read only");
  if (await page.locator(".mobile-input").isVisible()) {
    await expect(page.getByRole("button", { name: "Enter", exact: true })).toBeDisabled();
  }
  await page.getByRole("button", { name: "Wide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fit", exact: true })).toBeVisible();
});

test("application shortcuts are opted-in and configurable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  await expect(page.getByRole("button", { name: "Sidebar", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByLabel("Sidebar key sequence").fill('"\\u0001b"');
  await page.getByRole("button", { name: "Sidebar", exact: true }).click();
  await expect.poll(async () => (await state(request)).inputs).toEqual(["\x01b"]);
});

test("touch pans horizontally and uses negotiated mouse encoding", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  await requiresTouch(page);
  await page.getByRole("button", { name: "Wide", exact: true }).click();
  const swipe = async (horizontal: boolean) =>
    page.locator(".xterm-screen").evaluate((screen, horizontal) => {
      const rect = screen.getBoundingClientRect();
      const dispatch = (type: string, x: number, y: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", {
          value: type === "touchend" ? [] : [{ clientX: x, clientY: y }],
        });
        screen.dispatchEvent(event);
      };
      dispatch("touchstart", 250, rect.top + 140);
      dispatch("touchmove", horizontal ? 80 : 250, rect.top + (horizontal ? 140 : 70));
      dispatch("touchend", 80, rect.top + 70);
    }, horizontal);
  await swipe(true);
  await expect
    .poll(() => page.locator(".terminal-shell").evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await swipe(false);
  expect((await state(request)).inputs).toEqual([]);
  await request.get(`/test/output?data=${encodeURIComponent("\x1b[?1049h\x1b[?1000h\x1b[?1006h")}`);
  await swipe(false);
  await expect.poll(async () => (await state(request)).inputs.join("")).toMatch(/\x1b\[<65;/);
});
