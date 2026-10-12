import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

const username = process.env.JAXON_E2E_USERNAME;
const password = process.env.JAXON_E2E_PASSWORD;
const backendUrl = process.env.JAXON_E2E_BACKEND_URL;
const databaseContainer = process.env.JAXON_E2E_DATABASE_CONTAINER;
const automationDir = process.env.JAXON_E2E_AUTOMATION_DIR;
const agentStateDir = process.env.JAXON_E2E_AGENT_STATE_DIR;

test.beforeAll(() => {
  if (!username || !password || !backendUrl || !databaseContainer || !automationDir || !agentStateDir) {
    throw new Error("E2E identity, backend, database, and Agent configuration are required");
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

  const preRegisterResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/agents") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Pre-registrar Agent" }).click();
  expect((await preRegisterResponse).status()).toBe(201);
  const agentId = await page.getByLabel("UUID del Agent").inputValue();
  expect(agentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const initializedOutput = execFileSync("uv", [
    "run",
    "--project",
    automationDir!,
    "--locked",
    "jaxon-agent",
    "initialize",
    "--agent-id",
    agentId,
    "--state-dir",
    agentStateDir!,
  ], { encoding: "utf8" });
  expect(initializedOutput).not.toContain("OPENSSH PRIVATE KEY");
  const initialized = JSON.parse(initializedOutput) as {
    agentId: string;
    publicKey: string;
    publicKeyFingerprint: string;
  };
  expect(initialized.agentId).toBe(agentId);
  expect(initialized.publicKey).toMatch(/^ssh-ed25519 /);

  const keyResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/agents/${agentId}/ssh-key`) && response.request().method() === "PUT");
  await page.getByLabel("Clave pública OpenSSH Ed25519").fill(initialized.publicKey);
  await page.getByRole("button", { name: "Registrar clave pública" }).click();
  expect((await keyResponse).status()).toBe(200);
  const agentCard = page.getByRole("article", { name: "Estado del Agent" });
  await expect(agentCard).toContainText("PENDING");
  await expect(agentCard).toContainText(initialized.publicKeyFingerprint);
  await expect(page.locator("body")).not.toContainText("OPENSSH PRIVATE KEY");

  await page.reload();
  await page.getByLabel("UUID del activo").fill(assetId);
  await page.getByRole("button", { name: "Consultar" }).click();
  await page.getByLabel("UUID del Agent").fill(agentId);
  await page.getByRole("button", { name: "Consultar Agent" }).click();
  await expect(page.getByRole("article", { name: "Estado del Agent" })).toContainText(initialized.publicKeyFingerprint);

  const persistedAgent = execFileSync("docker", [
    "exec",
    databaseContainer!,
    "psql",
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--username",
    "jaxon_e2e",
    "--dbname",
    "jaxon_e2e",
    "--command",
    `SELECT a.status || ':' || i.public_key_fingerprint || ':' ||
      (SELECT count(*) FROM collector.outbox_events WHERE resource_id = a.id) || ':' ||
      (SELECT count(*) FROM identity.outbox_events WHERE event_type = 'AGENT_PUBLIC_KEY_REGISTERED' AND resource_id = a.id)
     FROM collector.agents a
     JOIN identity.technical_identities i ON i.agent_id = a.id
     WHERE a.id = '${agentId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedAgent).toBe(`PENDING:${initialized.publicKeyFingerprint}:1:1`);

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
