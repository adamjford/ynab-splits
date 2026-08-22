import { expect, test } from "@playwright/test";
import { configurePlan, newContext, resetFakeYnab, signIn, waitForHydration } from "./test-helpers";

test.describe.configure({ mode: "serial" });

test("focuses dashboard invitation feedback", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await resetFakeYnab(page);
    await signIn(page, "adam", "Adam", baseURL!);

    const inviteButton = page.getByRole("button", { name: "Create one-use invite" });
    await inviteButton.focus();
    await inviteButton.press("Enter");

    const status = page.getByRole("status");
    await expect(status).toHaveText("Invitation created. Copy the invite URL for the other member.");
    await expect(status).toBeFocused();
    await expect(page.getByText(/Invite URL:/)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("focuses settings feedback without shell route focus", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await resetFakeYnab(page);
    await signIn(page, "adam", "Adam", baseURL!);
    await configurePlan(page, "adam");
    await page.goto("/settings/ynab");
    await waitForHydration(page);

    const saveButton = page.getByRole("button", { name: "Save settings" });
    await saveButton.focus();
    await saveButton.press("Enter");

    await expect(page).toHaveURL(/\/settings\/ynab$/);
    const status = page.getByRole("status");
    await expect(status).toHaveText("Settings saved.");
    await expect(status).toBeFocused();
    await expect(page.locator("#main-content")).not.toBeFocused();
  } finally {
    await context.close();
  }
});

test("focuses inbox feedback after keyboard save", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await resetFakeYnab(page);
    await signIn(page, "adam", "Adam", baseURL!);
    await configurePlan(page, "adam");
    await page.goto("/inbox");
    await waitForHydration(page);

    const review = page.getByRole("article").filter({ hasText: "Local market" });
    const splitType = review.getByLabel("Split type");
    await splitType.focus();
    await splitType.press("End");
    await expect(splitType).toHaveValue("exact");

    const otherShare = review.getByLabel("Other share (minor units)");
    await otherShare.focus();
    await otherShare.press("0");

    const updateYnab = review.getByLabel("Update unsplit YNAB transaction");
    await expect(updateYnab).toBeChecked();
    await updateYnab.focus();
    await updateYnab.press("Space");
    await expect(updateYnab).not.toBeChecked();

    const saveButton = review.getByRole("button", { name: "Save to ledger" });
    await saveButton.focus();
    await saveButton.press("Enter");

    const status = page.getByRole("status");
    await expect(status).toHaveText("Transaction review saved.");
    await expect(status).toBeFocused();
    await expect(page.getByRole("article").filter({ hasText: "Local market" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
