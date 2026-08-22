import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { FAKE_ORIGIN, type FakeIdentity } from "./fake-ynab-server";

export async function waitForHydration(page: Page): Promise<void> {
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
}

export async function installFakeOAuth(page: Page, identity: FakeIdentity): Promise<void> {
  await page.context().route("**/invite/**", async (route) => {
    const upstream = await route.fetch({ maxRedirects: 0 });
    const location = upstream.headers().location ?? "/";
    await route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace(${JSON.stringify(location)})</script>` });
  });
  await page.context().route("**/auth/ynab/start**", async (route) => {
    const upstream = await route.fetch({ maxRedirects: 0 });
    const authorization = new URL(upstream.headers().location ?? "");
    const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("code", identity === "adam" ? "fake-code-adam" : "fake-code-chelsea");
    callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
    await route.fulfill({
      status: 200,
      headers: { "set-cookie": upstream.headers()["set-cookie"] ?? "" },
      contentType: "text/html",
      body: `<script>location.replace(${JSON.stringify(callback.toString())})</script>`,
    });
  });
}

export async function signIn(page: Page, identity: FakeIdentity, displayName: string, _baseURL: string, startPath = "/auth/ynab/start"): Promise<void> {
  await installFakeOAuth(page, identity);
  await page.goto(startPath);
  await waitForHydration(page);
  if (/\/onboarding/.test(page.url())) {
    await page.getByLabel("Ledger display name").fill(displayName);
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

export async function configurePlan(page: Page, identity: FakeIdentity): Promise<void> {
  const suffix = identity;
  await page.goto("/settings/ynab");
  await waitForHydration(page);
  await page.getByLabel("Plan ID").fill(`fake-plan-${suffix}`);
  await page.getByLabel("Settlement account ID").fill(`fake-account-${suffix}`);
  await page.getByLabel("Splitting category ID").fill(`fake-category-splitting-${suffix}`);
  await page.getByLabel("Source account IDs (one per line)").fill(`fake-account-${suffix}`);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
}

export async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ serviceWorkers: "block" });
}

export async function resetFakeYnab(page: Page): Promise<void> {
  const response = await page.request.post(`${FAKE_ORIGIN}/__reset`);
  await expect(response).toBeOK();
}
