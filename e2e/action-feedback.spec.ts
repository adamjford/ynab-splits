import { expect, test } from "@playwright/test";
import { FAKE_ORIGIN } from "./fake-ynab-server";
import { configurePlan, installFakeOAuth, newContext, resetFakeYnab, signIn, waitForHydration } from "./test-helpers";

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

test("keeps a stale inbox review unsuccessful and asks for a refresh", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await resetFakeYnab(page);
    await signIn(page, "adam", "Adam", baseURL!);
    await configurePlan(page, "adam");
    await page.goto("/inbox");
    await waitForHydration(page);

    const review = page.getByRole("article").filter({ hasText: "Local market" });
    const remoteChange = await page.request.put(`${FAKE_ORIGIN}/v1/plans/fake-plan-adam/transactions/fake-transaction-adam-1`, {
      headers: { Authorization: "Bearer fake-access-adam" },
      data: { transaction: { payee_name: "Changed after review" } },
    });
    expect(remoteChange.ok()).toBeTruthy();

    await review.getByRole("button", { name: "Not shared" }).click();
    await expect(page.getByRole("alert")).toHaveText("The reviewed transaction changed; refresh the inbox before saving.");
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText("Changed after review");
  } finally {
    await context.close();
  }
});

test("shows invalid invite recovery and permits creating a household without it", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await resetFakeYnab(page);
    await installFakeOAuth(page, "chelsea");
    await page.goto("/invite/expired-or-invalid-test-token");
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/onboarding\?invite=expired-or-invalid-test-token$/);

    await page.getByLabel("Ledger display name").fill("Chelsea");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("invite is expired or invalid");
    await page.goto("/onboarding");
    await waitForHydration(page);
    await page.getByLabel("Ledger display name").fill("Chelsea");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  } finally {
    await context.close();
  }
});
