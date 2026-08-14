import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { configurePlan, newContext, resetFakeYnab, signIn } from "./test-helpers";

test.describe.configure({ mode: "serial" });

type Viewport = { width: number; height: number };

async function signedInPage(browser: Browser, baseURL: string, viewport?: Viewport): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  await resetFakeYnab(page);
  await signIn(page, "adam", "Adam", baseURL);
  return { context, page };
}

async function ensureLocalMarketEntry(page: Page): Promise<void> {
  await configurePlan(page, "adam");
  await page.goto("/ledger");
  const existingEntry = page.getByRole("link", { name: "Local market", exact: true });
  if (await existingEntry.count() > 0) return;
  await page.goto("/inbox");
  const review = page.getByRole("article").filter({ hasText: "Local market" });
  await review.getByLabel("Split type").selectOption("exact");
  await review.getByLabel("Other share (minor units)").fill("0");
  await review.getByLabel("Update unsplit YNAB transaction").uncheck();
  await review.getByRole("button", { name: "Save to ledger" }).click();
  await expect(page.getByText("No unapproved transactions require review.")).toBeVisible();
}

async function createSettlement(page: Page, baseURL: string): Promise<string> {
  const response = await page.request.post(`${baseURL}/settlements/new.data`, {
    form: { startDate: "2026-08-01", endDate: "2026-08-01", confirmPayment: "on" },
    headers: { Accept: "application/json" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.text();
  const settlementId = /"settlementId","([^"]+)"/.exec(body)?.[1];
  expect(settlementId).toEqual(expect.any(String));
  return settlementId!;
}

function dialog(page: Page) {
  return page.locator("dialog[aria-labelledby='quick-navigation-title']");
}

function navigationFilter(page: Page) {
  return page.getByLabel("Navigation filter");
}

async function openPalette(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(navigationFilter(page)).toBeFocused();
  await expect(navigationFilter(page)).toHaveValue("");
}

async function closePalette(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
}

async function dispatchShortcut(page: Page, modifiers: { controlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): Promise<void> {
  await page.evaluate((options) => {
    const { controlKey, ...keyboardOptions } = options;
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
      ctrlKey: controlKey,
      ...keyboardOptions,
    }));
  }, modifiers);
}

async function focusStyle(locator: Locator): Promise<{ outlineStyle: string; outlineWidth: number; outlineOffset: number }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineOffset: Number.parseFloat(style.outlineOffset),
    };
  });
}

async function hoverStyle(locator: Locator): Promise<{ color: string; backgroundColor: string; borderColor: string }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, backgroundColor: style.backgroundColor, borderColor: style.borderColor };
  });
}

test("supports skip navigation and current-section semantics", async ({ browser, baseURL }) => {
  const { context, page } = await signedInPage(browser, baseURL!, { width: 390, height: 844 });
  try {
    await page.goto("/");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content", exact: true });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    const main = page.locator("#main-content");
    await expect(main).toBeFocused();
    await expect(main).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("Tab");
    await expect(main).not.toBeFocused();

    await page.reload();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    const headerLabels = ["Household ledger", "Inbox", "Ledger", "Settle up", "YNAB settings", "Navigate", "Log out"];
    for (const label of headerLabels) {
      await page.keyboard.press("Tab");
      const control = label === "Navigate" || label === "Log out"
        ? page.getByRole("button", { name: label, exact: true })
        : page.getByRole("link", { name: label, exact: true });
      await expect(control).toBeFocused();
      await expect(page.getByText("Adam", { exact: true }).first()).not.toBeFocused();
    }

    await ensureLocalMarketEntry(page);
    await page.goto("/ledger");
    await page.getByRole("link", { name: "Local market", exact: true }).click();
    await expect(page).toHaveURL(/\/ledger\/[^/]+$/);
    await expect(page.getByRole("link", { name: "Ledger", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Inbox", exact: true })).not.toHaveAttribute("aria-current", "page");
    expect(await page.locator('[aria-current="page"]').count()).toBe(1);

    const settlementId = await createSettlement(page, baseURL!);
    await page.goto(`/settlements/${settlementId}`);
    await expect(page).toHaveURL(new RegExp(`/settlements/${settlementId}$`));
    await expect(page.getByRole("link", { name: "Settle up", exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.locator('[aria-current="page"]').count()).toBe(1);
  } finally {
    await context.close();
  }
});

test("focuses main after pathname navigation", async ({ browser, baseURL }) => {
  const { context, page } = await signedInPage(browser, baseURL!);
  try {
    const main = page.locator("#main-content");
    await expect(main).not.toBeFocused();

    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(main).toBeFocused();

    const ledger = page.getByRole("link", { name: "Ledger", exact: true });
    await ledger.focus();
    await ledger.press("Enter");
    await expect(page).toHaveURL(/\/ledger$/);
    await expect(main).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(main).toBeFocused();
    await page.goForward();
    await expect(page).toHaveURL(/\/ledger$/);
    await expect(main).toBeFocused();
  } finally {
    await context.close();
  }
});

test("opens quick navigation by pointer and exact keyboard shortcut", async ({ browser, baseURL }) => {
  const { context, page } = await signedInPage(browser, baseURL!);
  try {
    await openPalette(page);
    await navigationFilter(page).fill("stale query");
    await closePalette(page);

    await page.keyboard.press("Control+k");
    await expect(dialog(page)).toBeVisible();
    await expect(navigationFilter(page)).toHaveValue("");
    await expect(navigationFilter(page)).toBeFocused();
    await closePalette(page);

    await dispatchShortcut(page, { metaKey: true });
    await expect(dialog(page)).toBeVisible();
    await expect(navigationFilter(page)).toHaveValue("");
    await expect(navigationFilter(page)).toBeFocused();
    await closePalette(page);

    for (const modifiers of [
      { controlKey: true, shiftKey: true },
      { controlKey: true, altKey: true },
      { controlKey: true, metaKey: true },
    ]) {
      await dispatchShortcut(page, modifiers);
      await expect(dialog(page)).not.toBeVisible();
    }

    await page.goto("/settings/ynab");
    const planId = page.getByLabel("Plan ID");
    await planId.fill("unchanged-plan-id");
    await planId.focus();
    await page.evaluate(() => {
      (window as typeof window & { __shortcutDefaultPrevented?: boolean }).__shortcutDefaultPrevented = undefined;
      document.addEventListener("keydown", (event) => {
        if (event.key.toLowerCase() === "k") {
          (window as typeof window & { __shortcutDefaultPrevented?: boolean }).__shortcutDefaultPrevented = event.defaultPrevented;
        }
      }, { once: true, capture: true });
    });
    await page.evaluate(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await expect(dialog(page)).not.toBeVisible();
    await expect(planId).toBeFocused();
    await expect(planId).toHaveValue("unchanged-plan-id");
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __shortcutDefaultPrevented?: boolean }).__shortcutDefaultPrevented)).toBe(false);
  } finally {
    await context.close();
  }
});

test("filters and activates visible quick-navigation results", async ({ browser, baseURL }) => {
  const { context, page } = await signedInPage(browser, baseURL!);
  try {
    await openPalette(page);
    await navigationFilter(page).fill("sett");
    const filteredLinks = dialog(page).getByRole("link");
    await expect(filteredLinks).toHaveCount(1);
    await expect(filteredLinks.first()).toHaveText("Settle up");
    await navigationFilter(page).press("Enter");
    await expect(page).toHaveURL(/\/settlements\/new$/);
    await expect(page.locator("#main-content")).toBeFocused();

    await openPalette(page);
    const results = dialog(page).getByRole("link");
    await expect(results).toHaveCount(5);
    await navigationFilter(page).press("ArrowDown");
    await expect(dialog(page).getByRole("link", { name: "Dashboard", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(dialog(page).getByRole("link", { name: "Inbox", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(dialog(page).getByRole("link", { name: "Dashboard", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(dialog(page).getByRole("link", { name: "YNAB settings", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(dialog(page).getByRole("link", { name: "Dashboard", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(dialog(page).getByRole("link", { name: "YNAB settings", exact: true })).toBeFocused();
    await expect(dialog(page).getByRole("link", { name: "Settle up", exact: true })).toHaveAttribute("aria-current", "page");
    await closePalette(page);

    await openPalette(page);
    await dialog(page).getByRole("link", { name: "Inbox", exact: true }).press("Enter");
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.locator("#main-content")).toBeFocused();

    await openPalette(page);
    await dialog(page).getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.locator("#main-content")).toBeFocused();

    await page.getByRole("link", { name: "Ledger", exact: true }).click();
    await expect(page).toHaveURL(/\/ledger$/);
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(page.getByRole("link", { name: "Ledger", exact: true })).toHaveAttribute("aria-current", "page");

    await openPalette(page);
    const ledgerResult = dialog(page).getByRole("link", { name: "Ledger", exact: true });
    await expect(ledgerResult).toHaveAttribute("aria-current", "page");
    await ledgerResult.focus();
    await dialog(page).getByRole("link", { name: "Inbox", exact: true }).hover();
    await expect(ledgerResult).toBeFocused();

    await navigationFilter(page).fill("does-not-exist");
    await expect(dialog(page).getByText("No destinations found.", { exact: true })).toBeVisible();
    await expect(navigationFilter(page)).toBeFocused();
    const currentURL = page.url();
    for (const key of ["Enter", "ArrowDown", "ArrowUp", "Home", "End"]) {
      await page.keyboard.press(key);
      await expect(navigationFilter(page)).toBeFocused();
      await expect(page).toHaveURL(currentURL);
    }
    await expect(dialog(page).locator("a")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("restores focus after palette dismissal", async ({ browser, baseURL }) => {
  const { context, page } = await signedInPage(browser, baseURL!);
  try {
    const trigger = page.getByRole("button", { name: "Navigate", exact: true });
    await openPalette(page);
    await closePalette(page);
    await expect(trigger).toBeFocused();

    await openPalette(page);
    await dialog(page).dispatchEvent("cancel");
    await expect(dialog(page)).not.toBeVisible();
    await expect(trigger).toBeFocused();

    await openPalette(page);
    const close = dialog(page).getByRole("button", { name: /close/i });
    await close.click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(trigger).toBeFocused();

    await openPalette(page);
    await dialog(page).getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(dialog(page)).not.toBeVisible();
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(trigger).not.toBeFocused();

    await openPalette(page);
    await dialog(page).getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(dialog(page)).not.toBeVisible();
    await expect(page.locator("#main-content")).toBeFocused();

    const closedDialog = dialog(page);
    await expect(closedDialog).not.toBeVisible();
    await expect.poll(() => closedDialog.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      await expect.poll(() => closedDialog.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    }
  } finally {
    await context.close();
  }
});

test("renders keyboard-visible controls without mobile overflow", async ({ browser, baseURL }) => {
  const { context, page } = await signedInPage(browser, baseURL!, { width: 390, height: 844 });
  try {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const controls = [
      page.getByRole("link", { name: "Household ledger", exact: true }),
      page.getByRole("link", { name: "Inbox", exact: true }),
      page.getByRole("link", { name: "Ledger", exact: true }),
      page.getByRole("link", { name: "Settle up", exact: true }),
      page.getByRole("link", { name: "YNAB settings", exact: true }),
      page.getByRole("button", { name: "Navigate", exact: true }),
      page.getByRole("button", { name: "Log out", exact: true }),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      await expect.poll(async () => (await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    const representativeLink = page.getByRole("link", { name: "Inbox", exact: true });
    const representativeButton = page.getByRole("button", { name: "Navigate", exact: true });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(representativeLink).toBeFocused();
    const linkFocus = await focusStyle(representativeLink);
    expect(linkFocus.outlineStyle).not.toBe("none");
    expect(linkFocus.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(linkFocus.outlineOffset).toBeGreaterThan(0);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(representativeButton).toBeFocused();
    const buttonFocus = await focusStyle(representativeButton);
    expect(buttonFocus.outlineStyle).not.toBe("none");
    expect(buttonFocus.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(buttonFocus.outlineOffset).toBeGreaterThan(0);

    await page.getByRole("link", { name: "YNAB settings", exact: true }).click();
    const representativeInput = page.getByLabel("Plan ID");
    await page.getByLabel("Currency ISO code").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(representativeInput).toBeFocused();
    const inputFocus = await focusStyle(representativeInput);
    expect(inputFocus.outlineStyle).not.toBe("none");
    expect(inputFocus.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(inputFocus.outlineOffset).toBeGreaterThan(0);


    await representativeLink.focus();
    const linkBeforeHover = await hoverStyle(representativeLink);
    await representativeLink.hover();
    const linkAfterHover = await hoverStyle(representativeLink);
    expect(linkAfterHover).not.toEqual(linkBeforeHover);
    await expect(representativeLink).toBeFocused();

    await representativeButton.focus();
    const buttonBeforeHover = await hoverStyle(representativeButton);
    await representativeButton.hover();
    const buttonAfterHover = await hoverStyle(representativeButton);
    expect(buttonAfterHover).not.toEqual(buttonBeforeHover);
    await expect(representativeButton).toBeFocused();
  } finally {
    await context.close();
  }
});
