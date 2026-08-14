import { expect, test } from "@playwright/test";
import { FAKE_ORIGIN } from "./fake-ynab-server";
import { configurePlan, newContext, resetFakeYnab, signIn } from "./test-helpers";

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

test("reviews an inbox transaction, creates a zero-net settlement, and restores it", async ({ browser, baseURL }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await resetFakeYnab(page);
  await signIn(page, "adam", "Adam", baseURL!);
  await configurePlan(page, "adam");
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Unapproved transactions" })).toBeVisible();
  await expect(page.getByText("Local market")).toBeVisible();
  const review = page.getByRole("article").filter({ hasText: "Local market" });
  await review.getByLabel("Split type").selectOption("exact");
  await review.getByLabel("Other share (minor units)").fill("0");
  await review.getByLabel("Update unsplit YNAB transaction").uncheck();
  await review.getByRole("button", { name: "Save to ledger" }).click();
  await expect(page.getByText("No unapproved transactions require review.")).toBeVisible();

  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
  await expect(page.getByText("Local market")).toBeVisible();

  const create = await page.request.post(`${baseURL}/settlements/new.data`, { form: { startDate: "2026-08-01", endDate: "2026-08-01", confirmPayment: "on" }, headers: { Accept: "application/json" } });
  expect(create.ok()).toBeTruthy();
  const createBody = await create.text();
  const settlementId = /"settlementId","([^"]+)"/.exec(createBody)?.[1];
  expect(settlementId).toEqual(expect.any(String));
  await page.goto(`/settlements/${settlementId}`);
  await expect(page.getByText(/2026-08-01 through 2026-08-01/)).toBeVisible();
  await expect(page.getByText(/· 0 · closed/)).toBeVisible();

  const voided = await page.request.post(`${baseURL}/settlements/${settlementId}.data`, { form: { intent: "void", confirmVoid: "on" }, headers: { Accept: "application/json" } });
  expect(voided.ok()).toBeTruthy();
  await page.goto(`/settlements/${settlementId}`);
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
