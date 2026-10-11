import { expect, test } from "@playwright/test";

const username = process.env.JAXON_E2E_USERNAME;
const password = process.env.JAXON_E2E_PASSWORD;

test.beforeAll(() => {
  if (!username || !password) {
    throw new Error("JAXON_E2E_USERNAME and JAXON_E2E_PASSWORD are required");
  }
});

test("logs in, recovers the session after refresh, and rejects invalid credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: username! })).toBeVisible();
  await expect(page.getByText("IT OPERATOR")).toBeVisible();
  await expect(page.getByText("SYSTEM ADMIN")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: username! })).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/login");
  await page.getByLabel("Usuario").fill("unknown-user");
  await page.getByLabel("Contraseña").fill("invalid-passphrase");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.locator("#login-error")).toContainText("No fue posible iniciar sesión");
});
