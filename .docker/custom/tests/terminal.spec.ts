import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.get("/test/reset");
});

test("fits a phone, exposes wide mode, inserts multiline without submitting", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  for (const label of ["Wide", "Settings"]) {
    const box = await page.getByRole("button", { name: label, exact: true }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await page.locator("#draft").fill("hello\nworld 🌍");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.locator("#draft")).toHaveValue("hello\nworld 🌍");
  await expect
    .poll(async () => (await (await request.get("/test/state")).json()).inputs)
    .toEqual(["\x1b[200~hello\rworld 🌍\x1b[201~"]);
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get("/test/state")).json()).inputs.at(-1))
    .toBe("\r");
  const before = (await (await request.get("/test/state")).json()).sizes.at(-1).columns;
  await page.getByRole("button", { name: "Wide", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get("/test/state")).json()).sizes.at(-1).columns)
    .toBeGreaterThan(120);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get("/test/state")).json()).sizes.at(-1).columns)
    .toBe(before);
  await page.setViewportSize({ width: 390, height: 430 });
  await expect
    .poll(
      async () =>
        (await page.locator(".mobile-input").boundingBox())!.y +
        (await page.locator(".mobile-input").boundingBox())!.height,
    )
    .toBeLessThanOrEqual(430);
  expect((await (await request.get("/test/state")).json()).tokenRequests).toBeGreaterThan(1);
});

test("keeps drafts through disconnect and rejects unbracketed multiline input", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await page.locator("#draft").fill("keep\nthis");
  await request.get("/test/disconnect");
  await expect(page.getByRole("button", { name: "Insert", exact: true })).toBeDisabled();
  await expect(page.locator("#draft")).toHaveValue("keep\nthis");
  await request.get("/test/online");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  await request.get(`/test/output?data=${encodeURIComponent("\x1b[?2004l")}`);
  // Wait for xterm's asynchronous write queue, not a fixed sleep.
  await expect
    .poll(async () => page.evaluate(() => document.querySelector(".xterm") !== null))
    .toBe(true);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.locator("#draft")).toHaveValue("keep\nthis");
  expect((await (await request.get("/test/state")).json()).inputs).toEqual([]);
});

test("readonly disables controls; blocked storage does not break startup", async ({
  page,
  request,
}) => {
  await request.get("/test/readonly");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status").first()).toHaveText("Read only");
  await expect(page.getByRole("button", { name: "Enter", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Wide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fit", exact: true })).toBeVisible();
});

test("application shortcuts are explicit and configurable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
  await expect(page.getByRole("button", { name: "Sidebar", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByLabel("Sidebar key sequence").fill('"\\u0001b"');
  await page.getByRole("button", { name: "Sidebar", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get("/test/state")).json()).inputs)
    .toEqual(["\x01b"]);
});

test("touch pans horizontally and uses negotiated mouse encoding", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-connection", "connected");
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
  expect((await (await request.get("/test/state")).json()).inputs).toEqual([]);
  await request.get(`/test/output?data=${encodeURIComponent("\x1b[?1049h\x1b[?1000h\x1b[?1006h")}`);
  await swipe(false);
  await expect
    .poll(async () => (await (await request.get("/test/state")).json()).inputs.join(""))
    .toMatch(/\x1b\[<65;/);
});
