import { expect, test, type Page } from "@playwright/test";
import { configurePlan, newContext, resetFakeYnab, signIn } from "./test-helpers";

test.describe.configure({ mode: "serial" });

const settlementError = "Confirm that the real payment occurred before creating a settlement.";

async function reviewPositiveLedgerEntry(page: Page): Promise<void> {
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Unapproved transactions" })).toBeVisible();
  const review = page.getByRole("article").filter({ hasText: "Local market" });
  await review.getByLabel("Split type").selectOption("exact");
  await review.getByLabel("Other share (minor units)").fill("944");
  await review.getByLabel("Update unsplit YNAB transaction").uncheck();
  const save = review.getByRole("button", { name: "Save to ledger" });
  await save.click();
  await expect(page.getByText("No unapproved transactions require review.")).toBeVisible();
}

async function createPositiveSettlement(page: Page, baseURL: string): Promise<string> {
  await page.goto("/settlements/new");
  await page.getByLabel("Start date").fill("2026-08-01");
  await page.getByLabel("End date").fill("2026-08-01");
  const confirmation = page.getByRole("checkbox", { name: "I confirm the real payment occurred." });
  await confirmation.focus();
  await page.keyboard.press("Space");
  await expect(confirmation).toBeChecked();

  const create = page.getByRole("button", { name: "Create settlement" });
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/settlements/new"));
  await create.focus();
  await page.keyboard.press("Enter");
  const response = await responsePromise;
  const body = await response.text();
  const settlementId = /"settlementId"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? /"settlementId","([^"]+)"/.exec(body)?.[1];
  expect(settlementId).toEqual(expect.any(String));
  await expect(page).toHaveURL(`${baseURL}/settlements/new`);
  return settlementId!;
}

test("focuses repeated settlement errors and the created-settlement link", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await resetFakeYnab(page);
    await signIn(page, "adam", "Adam", baseURL!);
    await configurePlan(page, "adam");
    await reviewPositiveLedgerEntry(page);

    await page.goto("/settlements/new");
    await page.getByLabel("Start date").fill("2026-08-01");
    await page.getByLabel("End date").fill("2026-08-01");
    const create = page.getByRole("button", { name: "Create settlement" });
    await create.focus();
    await page.keyboard.press("Enter");
    const firstError = page.getByRole("alert");
    await expect(firstError).toHaveText(settlementError);
    await expect(firstError).toBeFocused();

    await page.getByLabel("Start date").focus();
    await create.focus();
    await page.keyboard.press("Enter");
    const repeatedError = page.getByRole("alert");
    await expect(repeatedError).toHaveText(settlementError);
    await expect(repeatedError).toBeFocused();

    const confirmation = page.getByRole("checkbox", { name: "I confirm the real payment occurred." });
    await confirmation.focus();
    await page.keyboard.press("Space");
    await expect(confirmation).toBeChecked();
    await create.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("status")).toHaveText("Settlement created.");
    const openSettlement = page.getByRole("link", { name: "Open settlement" });
    const settlementHref = await openSettlement.getAttribute("href");
    expect(settlementHref).toMatch(/^\/settlements\/[^/]+$/);
    await expect(openSettlement).toBeFocused();
    await openSettlement.press("Enter");
    await expect(page).toHaveURL(`${baseURL}${settlementHref}`);
  } finally {
    await context.close();
  }
});

test("focuses settlement copy and restore feedback", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await resetFakeYnab(page);
    await signIn(page, "adam", "Adam", baseURL!);
    await configurePlan(page, "adam");
    await reviewPositiveLedgerEntry(page);

    const settlementId = await createPositiveSettlement(page, baseURL!);
    await page.goto(`/settlements/${settlementId}`);
    await expect(page.getByText(/2026-08-01 through 2026-08-01/)).toBeVisible();
    await expect(page.getByText(/· 944 · closed/)).toBeVisible();

    const copy = page.getByRole("button", { name: "Copy my settlement to YNAB" });
    await copy.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText("Settlement copied to YNAB.");
    await expect(page.getByRole("status")).toBeFocused();

    await copy.focus();
    await page.keyboard.press("Enter");
    const repeatedCopy = page.getByRole("status");
    await expect(repeatedCopy).toHaveText("Settlement copied to YNAB.");
    await expect(repeatedCopy).toBeFocused();

    const voided = await page.request.post(`${baseURL}/settlements/${settlementId}.data`, {
      form: { intent: "void", confirmVoid: "on", confirmRemoteCleanup: "on" },
      headers: { Accept: "application/json" },
    });
    expect(voided.ok()).toBeTruthy();
    await page.goto(`/settlements/${settlementId}`);
    await expect(page.getByText(/· 944 · voided/)).toBeVisible();

    const restore = page.getByRole("button", { name: "Restore settlement" });
    await restore.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText("Settlement restored.");
    await expect(page.getByRole("status")).toBeFocused();
    await expect(page.getByText(/· 944 · closed/)).toBeVisible();
  } finally {
    await context.close();
  }
});
