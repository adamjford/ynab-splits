import { expect, test, type BrowserContext } from "@playwright/test";
import { FAKE_ORIGIN } from "./fake-ynab-server";
import { configurePlan, installFakeOAuth, newContext, resetFakeYnab, signIn, waitForHydration } from "./test-helpers";

test.describe.configure({ mode: "serial" });

test("onboards both identities with isolated cookies and an invite", async ({ browser, baseURL }) => {
  const adam = await newContext(browser);
  const adamPage = await adam.newPage();
  await resetFakeYnab(adamPage);
  await signIn(adamPage, "adam", "Adam", baseURL!);
  await expect(adamPage.getByText("Adam").first()).toBeVisible();
  await adamPage.getByRole("button", { name: "Create one-use invite" }).click();
  const inviteText = await adamPage.getByText(/Invite URL:/).textContent();
  const inviteUrl = new URL(inviteText!.replace(/^.*Invite URL:\s*/, ""), baseURL);
  const invitePath = `${inviteUrl.pathname}${inviteUrl.search}`;

  const chelsea = await newContext(browser);
  const chelseaPage = await chelsea.newPage();
  await signIn(chelseaPage, "chelsea", "Chelsea", baseURL!, invitePath);
  await expect(chelseaPage.context().cookies()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ name: "ynab_splits_auth" })]));
  const adamCookies = await adam.cookies();
  const chelseaCookies = await chelsea.cookies();
  expect(adamCookies.find((cookie) => cookie.name === "ynab_splits_auth")?.value).not.toBe(chelseaCookies.find((cookie) => cookie.name === "ynab_splits_auth")?.value);
  await expect(chelseaPage.getByRole("link", { name: "YNAB settings" })).toBeVisible();

  await configurePlan(adamPage, "adam");
  await configurePlan(chelseaPage, "chelsea");
  await expect(adamPage.getByLabel("Plan ID")).toHaveValue("fake-plan-adam");
  await expect(chelseaPage.getByLabel("Plan ID")).toHaveValue("fake-plan-chelsea");
  await expect(adamPage.locator("body")).not.toContainText("fake-plan-chelsea");
  await expect(chelseaPage.locator("body")).not.toContainText("fake-plan-adam");

  await adam.close();
  await chelsea.close();
});

test("redirects unauthenticated and pending sessions at the authenticated shell", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await resetFakeYnab(page);

    const unauthenticated = await page.request.get(`${baseURL}/ledger`, { maxRedirects: 0 });
    expect(unauthenticated.status()).toBe(302);
    expect(unauthenticated.headers().location).toBe("/auth/ynab/start");

    await installFakeOAuth(page, "adam");
    await page.goto("/auth/ynab/start");
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/onboarding$/);

    const pending = await page.request.get(`${baseURL}/ledger`, { maxRedirects: 0 });
    expect(pending.status()).toBe(302);
    expect(pending.headers().location).toBe("/onboarding");

    await page.getByLabel("Ledger display name").fill("Adam");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("keeps owner-private ledger controls out of the other member's detail view", async ({ browser, baseURL }) => {
  const adam = await newContext(browser);
  const adamPage = await adam.newPage();
  let chelsea: BrowserContext | undefined;
  try {
    await resetFakeYnab(adamPage);
    await signIn(adamPage, "adam", "Adam", baseURL!);
    await configurePlan(adamPage, "adam");

    const sourceUpdate = await adamPage.request.put(`${FAKE_ORIGIN}/v1/plans/fake-plan-adam/transactions/fake-transaction-adam-1`, {
      headers: { Authorization: "Bearer fake-access-adam" },
      data: {
        transaction: {
          subtransactions: [
            { amount: -9440, category_id: "fake-category-groceries-adam", payee_name: "Local market", memo: "Owner share" },
            { amount: -9450, category_id: "fake-category-splitting-adam", payee_name: "Local market", memo: "Household share" },
          ],
        },
      },
    });
    expect(sourceUpdate.ok()).toBeTruthy();

    await adamPage.goto("/inbox");
    await waitForHydration(adamPage);
    const review = adamPage.getByRole("article").filter({ hasText: "Local market" });
    await review.getByLabel("Split type").selectOption("exact");
    await review.getByLabel("Other share (minor units)").fill("945");
    await review.getByLabel("Update unsplit YNAB transaction").uncheck();
    await review.getByRole("button", { name: "Save to ledger" }).click();
    await expect(adamPage.getByText("No unapproved transactions require review.")).toBeVisible();

    await adamPage.goto("/ledger");
    await waitForHydration(adamPage);
    const entryLink = adamPage.getByRole("link", { name: "Local market", exact: true });
    const entryPath = await entryLink.getAttribute("href");
    expect(entryPath).toMatch(/^\/ledger\/[^/]+$/);
    const entryId = entryPath!.split("/").pop()!;

    await adamPage.goto("/");
    await adamPage.getByRole("button", { name: "Create one-use invite" }).click();
    const inviteText = await adamPage.getByText(/Invite URL:/).textContent();
    const inviteUrl = new URL(inviteText!.replace(/^.*Invite URL:\s*/, ""), baseURL);

    await adamPage.goto(`/ledger/${entryId}`);
    await waitForHydration(adamPage);
    await expect(adamPage.getByRole("heading", { name: "Manual YNAB steps" })).toBeVisible();
    await expect(adamPage.getByRole("button", { name: "Verify" })).toBeVisible();
    await expect(adamPage.getByRole("button", { name: "Dismiss" })).toBeVisible();

    await adamPage.locator('input[name="taskId"]').last().evaluate((element) => {
      (element as HTMLInputElement).value = "forged-task-id";
    });
    await adamPage.getByRole("button", { name: "Dismiss" }).click();
    await expect(adamPage.getByRole("alert")).toHaveText("Verification failed.");
    await expect(adamPage.getByRole("heading", { name: "Manual YNAB steps" })).toBeVisible();

    chelsea = await newContext(browser);
    const chelseaPage = await chelsea.newPage();
    await signIn(chelseaPage, "chelsea", "Chelsea", baseURL!, `${inviteUrl.pathname}${inviteUrl.search}`);
    await configurePlan(chelseaPage, "chelsea");
    await chelseaPage.goto(`/ledger/${entryId}`);
    await waitForHydration(chelseaPage);
    await expect(chelseaPage.getByRole("heading", { name: "Local market" })).toBeVisible();
    await expect(chelseaPage.getByRole("heading", { name: "Manual YNAB steps" })).toHaveCount(0);
    await expect(chelseaPage.getByRole("button", { name: "Verify" })).toHaveCount(0);
    await expect(chelseaPage.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
    await expect(chelseaPage.getByRole("button", { name: "Save allocation guidance" })).toHaveCount(0);
    await expect(chelseaPage.locator("body")).not.toContainText("fake-transaction-adam-1");
  } finally {
    await chelsea?.close();
    await adam.close();
  }
});

test("reviews an inbox transaction, creates a zero-net settlement, and restores it", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await resetFakeYnab(page);
  await signIn(page, "adam", "Adam", baseURL!);
  await configurePlan(page, "adam");
  await page.goto("/inbox");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Unapproved transactions" })).toBeVisible();
  await expect(page.getByText("Local market")).toBeVisible();
  const review = page.getByRole("article").filter({ hasText: "Local market" });
  await review.getByLabel("Split type").selectOption("exact");
  await review.getByLabel("Other share (minor units)").fill("0");
  await review.getByLabel("Update unsplit YNAB transaction").uncheck();
  await review.getByRole("button", { name: "Save to ledger" }).click();
  await expect(page.getByText("No unapproved transactions require review.")).toBeVisible();

  await page.goto("/ledger");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
  await expect(page.getByText("Local market")).toBeVisible();

  const create = await page.request.post(`${baseURL}/settlements/new.data`, { form: { startDate: "2026-08-01", endDate: "2026-08-01", confirmPayment: "on" }, headers: { Accept: "application/json" } });
  expect(create.ok()).toBeTruthy();
  const createBody = await create.text();
  const settlementId = /"settlementId","([^"]+)"/.exec(createBody)?.[1];
  expect(settlementId).toEqual(expect.any(String));
  await page.goto(`/settlements/${settlementId}`);
  await waitForHydration(page);
  await expect(page.getByText(/2026-08-01 through 2026-08-01/)).toBeVisible();
  await expect(page.getByText(/· 0 · closed/)).toBeVisible();

  const voided = await page.request.post(`${baseURL}/settlements/${settlementId}.data`, { form: { intent: "void", confirmVoid: "on" }, headers: { Accept: "application/json" } });
  expect(voided.ok()).toBeTruthy();
  await page.goto(`/settlements/${settlementId}`);
  await waitForHydration(page);
  await expect(page.getByText(/· voided/)).toBeVisible();
  await page.getByRole("button", { name: "Restore settlement" }).click();
  await expect(page.getByText(/· 0 · closed/)).toBeVisible();
  await context.close();
});

test("supports logout and responsive navigation without retaining the session", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  await signIn(page, "adam", "Adam", baseURL!);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.context().unroute("**/auth/ynab/start**");
  await page.context().route("**/auth/ynab/start**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Signed out</h1>" }));
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/auth\/ynab\/start/);
  const root = await page.request.get(`${baseURL}/`, { maxRedirects: 0 });
  expect(root.status()).toBe(302);
  expect(root.headers().location).toBe("/auth/ynab/start");
  await context.close();
});

test("fake service controls expose deterministic transport outcomes", async ({ request }) => {
  const control = await request.post(`${FAKE_ORIGIN}/__control`, { data: { mode: "rate_limit", path: "/v1/user" } });
  expect(control.ok()).toBeTruthy();
  await expect((await request.get(`${FAKE_ORIGIN}/__health`)).json()).resolves.toEqual({ ok: true });
  const reset = await request.post(`${FAKE_ORIGIN}/__control`, { data: { mode: "success" } });
  expect(reset.ok()).toBeTruthy();
});
