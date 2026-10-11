import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

const username = process.env.JAXON_E2E_USERNAME;
const password = process.env.JAXON_E2E_PASSWORD;
const backendUrl = process.env.JAXON_E2E_BACKEND_URL;
const databaseContainer = process.env.JAXON_E2E_DATABASE_CONTAINER;

test.beforeAll(() => {
  if (!username || !password || !backendUrl || !databaseContainer) {
    throw new Error("E2E identity, backend, and database configuration are required");
  }
});

test("logs in, manages a persisted asset, and enforces the security boundary", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: username! })).toBeVisible();
  await expect(page.getByText("IT OPERATOR")).toBeVisible();
  await expect(page.getByText("SYSTEM ADMIN")).toBeVisible();

  const assetName = `E2E Workstation ${Date.now()}`;
  const createResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/assets") && response.request().method() === "POST");
  await page.getByLabel("Nombre").fill(assetName);
  await page.getByLabel("Tipo").selectOption("LAPTOP");
  await page.getByRole("button", { name: "Registrar activo" }).click();
  expect((await createResponse).status()).toBe(201);

  const createdCard = page.getByRole("article", { name: "Resultado de creación" });
  await expect(createdCard.getByRole("heading", { name: assetName })).toBeVisible();
  await expect(createdCard.getByText("LAPTOP")).toBeVisible();
  const assetId = await page.getByLabel("UUID del activo").inputValue();
  expect(assetId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await expect(page.getByRole("article", { name: "Consulta por ID" })).toContainText(assetId);

  await page.reload();
  await expect(page.getByRole("heading", { name: username! })).toBeVisible();
  await page.getByLabel("UUID del activo").fill(assetId);
  await page.getByRole("button", { name: "Consultar" }).click();
  const persistedCard = page.getByRole("article", { name: "Consulta por ID" });
  await expect(persistedCard.getByRole("heading", { name: assetName })).toBeVisible();

  const missingCsrf = await page.evaluate(async ({ api, name }) => {
    const response = await fetch(`${api}/api/v1/assets`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, assetType: "DESKTOP", status: "ACTIVE" }),
    });
    return { status: response.status, body: await response.json() };
  }, { api: backendUrl!, name: "Rejected without CSRF" });
  expect(missingCsrf.status).toBe(403);
  expect(missingCsrf.body.code).toBe("CSRF_INVALID");

  const currentSession = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/api/v1/auth/me`, { credentials: "include" });
    return response.json();
  }, backendUrl!);
  execFileSync("docker", [
    "exec",
    databaseContainer!,
    "psql",
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--username",
    "jaxon_e2e",
    "--dbname",
    "jaxon_e2e",
    "--command",
    "DELETE FROM identity.human_user_roles WHERE role_code = 'IT_OPERATOR'",
  ]);
  const forbidden = await page.evaluate(async ({ api, csrf }) => {
    const response = await fetch(`${api}/api/v1/assets`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ name: "Rejected without role", assetType: "DESKTOP", status: "ACTIVE" }),
    });
    return { status: response.status, body: await response.json() };
  }, { api: backendUrl!, csrf: currentSession.csrfToken as string });
  expect(forbidden.status).toBe(403);
  expect(forbidden.body.code).toBe("ACCESS_DENIED");

  await page.context().clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/login");
  await page.getByLabel("Usuario").fill("unknown-user");
  await page.getByLabel("Contraseña").fill("invalid-passphrase");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.locator("#login-error")).toContainText("No fue posible iniciar sesión");
});
