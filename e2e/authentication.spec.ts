import { expect, test } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, writeFileSync } from "node:fs";

const username = process.env.JAXON_E2E_USERNAME;
const password = process.env.JAXON_E2E_PASSWORD;
const backendUrl = process.env.JAXON_E2E_BACKEND_URL;
const databaseContainer = process.env.JAXON_E2E_DATABASE_CONTAINER;
const sftpGoContainer = process.env.JAXON_E2E_SFTPGO_CONTAINER;
const automationDir = process.env.JAXON_E2E_AUTOMATION_DIR;
const agentStateDir = process.env.JAXON_E2E_AGENT_STATE_DIR;
const sftpGoApiUrl = process.env.JAXON_SFTPGO_ADMIN_API_URL;
const sftpGoAdminUsername = process.env.JAXON_SFTPGO_ADMIN_USERNAME;
const sftpGoAdminPassword = process.env.JAXON_SFTPGO_ADMIN_PASSWORD;

test.beforeAll(() => {
  if (!username || !password || !backendUrl || !databaseContainer || !sftpGoContainer || !automationDir
    || !agentStateDir || !sftpGoApiUrl || !sftpGoAdminUsername || !sftpGoAdminPassword) {
    throw new Error("E2E identity, backend, database, SFTPGo, and Agent configuration are required");
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

  const supportUsername = `support.only.${Date.now()}`;
  const supportPassword = `Support-${crypto.randomUUID()}-Aa9!`;
  const createUserResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/users") && response.request().method() === "POST"
  ));
  await page.getByLabel("Usuario", { exact: true }).fill(supportUsername);
  await page.getByLabel("Contraseña inicial").fill(supportPassword);
  await page.getByLabel(/Atención técnica/).check();
  await page.getByRole("button", { name: "Crear usuario" }).click();
  expect((await createUserResponse).status()).toBe(201);
  const createdUserCard = page.getByRole("article", { name: "Usuario creado" });
  await expect(createdUserCard).toContainText(supportUsername);
  await expect(createdUserCard).toContainText("SUPPORT_TECHNICIAN");
  await expect(page.getByLabel("Contraseña inicial")).toHaveValue("");
  const persistedSupportUser = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT u.status || ':' || string_agg(r.role_code, ',' ORDER BY r.role_code) || ':' ||
      (SELECT count(*) FROM identity.outbox_events e
       WHERE e.event_type = 'HUMAN_USER_CREATED' AND e.resource_id = u.id
         AND e.payload = '{"status":"ACTIVE"}'::jsonb)
      FROM identity.human_users u
      JOIN identity.human_user_roles r ON r.user_id = u.id
      WHERE u.normalized_username = '${supportUsername}'
      GROUP BY u.id`,
  ], { encoding: "utf8" }).trim();
  expect(persistedSupportUser).toBe("ACTIVE:SUPPORT_TECHNICIAN:1");

  const adminLogoutResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/auth/logout") && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  expect((await adminLogoutResponse).status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Usuario").fill(supportUsername);
  await page.getByLabel("Contraseña").fill(supportPassword);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/(?:\?page=0&size=20)?$/);
  await expect(page.getByRole("heading", { name: supportUsername })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Usuarios humanos" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Activos" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Tickets" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Bandeja técnica" })).toBeVisible();
  const supportLogoutResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/auth/logout") && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  expect((await supportLogoutResponse).status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Usuario").fill(username!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL("/");

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
  const technicalEventsConnected = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/assets/${assetId}/technical-state/events`)
      && response.status() === 200
  ));
  await page.getByLabel("UUID del activo").fill(assetId);
  await page.getByRole("button", { name: "Consultar" }).click();
  const persistedCard = page.getByRole("article", { name: "Consulta por ID" });
  await expect(persistedCard.getByRole("heading", { name: assetName })).toBeVisible();

  const ticketSummary = `E2E printer incident ${Date.now()}`;
  const ticketDescription = "The E2E reception printer is unavailable.";
  const createTicketResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/tickets") && response.request().method() === "POST"
  ));
  const ticketListResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/v1/tickets")
      && response.request().method() === "GET"
      && url.searchParams.get("page") === "0"
      && url.searchParams.get("size") === "20";
  });
  await page.getByLabel("Resumen").fill(ticketSummary);
  await page.getByLabel("Descripción").fill(ticketDescription);
  await page.getByLabel("Activo asociado por UUID (opcional)").fill(assetId);
  await page.getByRole("button", { name: "Crear ticket" }).click();
  expect((await createTicketResponse).status()).toBe(201);
  const ticketId = await page.getByLabel("UUID del ticket").inputValue();
  expect(ticketId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const createdTicketCard = page.getByRole("article", { name: "Resultado de creación del ticket" });
  await expect(createdTicketCard.getByRole("heading", { name: ticketSummary })).toBeVisible();
  await expect(createdTicketCard).toContainText("OPEN");
  await expect(createdTicketCard).toContainText("NORMAL");
  await expect(createdTicketCard).toContainText(assetId);
  const listedTickets = await (await ticketListResponse).json() as { items: Record<string, unknown>[] };
  const listedTicket = listedTickets.items.find((item) => item.ticketId === ticketId);
  expect(listedTicket).toBeDefined();
  expect(listedTicket).not.toHaveProperty("description");
  expect(Object.keys(listedTicket!).sort()).toEqual([
    "assetId", "assigneeUserId", "createdAt", "createdByUserId", "priority",
    "requesterUserId", "source", "status", "summary", "ticketId", "type", "updatedAt", "version",
  ]);

  const persistedTicket = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT t.status || ':' || t.priority || ':' || t.source || ':' || t.asset_id || ':' ||
      (SELECT count(*) FROM support.outbox_events e
       WHERE e.event_type = 'TICKET_CREATED' AND e.resource_id = t.id
         AND NOT e.payload ? 'description' AND NOT e.payload ? 'summary')
      FROM support.tickets t WHERE t.id = '${ticketId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedTicket).toBe(`OPEN:NORMAL:WEB:${assetId}:1`);

  const ticketLookupResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/${ticketId}`) && response.request().method() === "GET"
  ));
  await page.getByRole("button", { name: "Buscar ticket" }).click();
  expect((await ticketLookupResponse).status()).toBe(200);
  const queriedTicketCard = page.getByRole("article", { name: "Consulta del ticket por ID" });
  await expect(queriedTicketCard.getByRole("heading", { name: ticketSummary })).toBeVisible();
  await expect(queriedTicketCard).toContainText(ticketDescription);
  await expect(page.getByRole("button", { name: new RegExp(ticketSummary) })).toBeVisible();
  await expect(page.getByText("Aún no hay comentarios públicos.")).toBeVisible();

  const ticketComment = "E2E public follow-up: technician visit requested.";
  const commentResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/${ticketId}/comments`)
      && response.request().method() === "POST"
  ));
  await page.getByLabel("Añadir comentario público").fill(ticketComment);
  await page.getByRole("button", { name: "Publicar comentario" }).click();
  expect((await commentResponse).status()).toBe(201);
  await expect(page.getByText(ticketComment)).toBeVisible();

  const persistedComment = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT c.visibility || ':' || c.body || ':' ||
      (c.author_user_id = t.requester_user_id)::text || ':' ||
      (SELECT count(*) FROM support.outbox_events e
       WHERE e.event_type = 'TICKET_COMMENT_ADDED' AND e.resource_id = t.id
         AND e.payload->>'commentId' = c.id::text
         AND e.payload->>'visibility' = 'PUBLIC'
         AND NOT e.payload ? 'body' AND NOT e.payload ? 'summary' AND NOT e.payload ? 'description')
      FROM support.ticket_comments c
      JOIN support.tickets t ON t.id = c.ticket_id
      WHERE c.ticket_id = '${ticketId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedComment).toBe(`PUBLIC:${ticketComment}:true:1`);

  const requesterLogoutResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/auth/logout") && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  expect((await requesterLogoutResponse).status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Usuario", { exact: true }).fill(supportUsername);
  await page.getByLabel("Contraseña").fill(supportPassword);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Bandeja técnica" })).toBeVisible();
  await expect(page).toHaveURL(/\?page=0&size=20$/);
  await page.getByRole("button", { name: new RegExp(ticketSummary) }).click();
  const technicianTicketCard = page.getByRole("article", { name: "Detalle técnico del ticket" });
  await expect(technicianTicketCard).toContainText(ticketDescription);
  await expect(page.getByText(ticketComment)).toBeVisible();
  await expect(page.getByLabel("Visibilidad", { exact: true })).not.toBeVisible();

  const claimResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/${ticketId}/claim`)
      && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Asignarme ticket" }).click();
  expect((await claimResponse).status()).toBe(200);
  await expect(technicianTicketCard).toContainText("Asignado a ti");
  await expect(technicianTicketCard).toContainText("Versión1");

  const internalNote = "E2E internal diagnosis: replace the pickup roller.";
  const technicianPublicComment = "E2E technician public update: repair scheduled.";
  const visibility = page.getByLabel("Visibilidad", { exact: true });
  const technicianCommentBody = page.getByLabel("Comentario técnico");
  await expect(visibility).toHaveValue("");
  await expect(page.getByRole("button", { name: "Añadir a la conversación" })).toBeDisabled();

  const internalResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/technician-queue/${ticketId}/conversation`)
      && response.request().method() === "POST"
  ));
  await visibility.selectOption("INTERNAL");
  await technicianCommentBody.fill(internalNote);
  await page.getByRole("button", { name: "Añadir a la conversación" }).click();
  expect((await internalResponse).status()).toBe(201);
  await expect(page.getByText(internalNote)).toBeVisible();
  await expect(page.getByLabel("Visibilidad: interno")).toBeVisible();
  await expect(visibility).toHaveValue("");
  await expect(technicianCommentBody).toHaveValue("");

  const technicianPublicResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/technician-queue/${ticketId}/conversation`)
      && response.request().method() === "POST"
  ));
  await visibility.selectOption("PUBLIC");
  await technicianCommentBody.fill(technicianPublicComment);
  await page.getByRole("button", { name: "Añadir a la conversación" }).click();
  expect((await technicianPublicResponse).status()).toBe(201);
  await expect(page.getByText(technicianPublicComment)).toBeVisible();
  await expect(page.getByLabel("Visibilidad: público").last()).toBeVisible();

  const persistedTechnicalConversation = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT string_agg(c.visibility || ':' || c.body || ':' ||
        (c.author_user_id = u.id)::text || ':' ||
        (e.actor_id = u.id)::text || ':' ||
        (e.payload = jsonb_build_object('commentId', c.id::text, 'visibility', c.visibility))::text || ':' ||
        (NOT e.payload ? 'body' AND NOT e.payload ? 'summary' AND NOT e.payload ? 'description')::text,
        '|' ORDER BY c.created_at, c.id)
      FROM support.ticket_comments c
      JOIN support.tickets t ON t.id = c.ticket_id
      JOIN identity.human_users u ON u.normalized_username = '${supportUsername}'
      JOIN support.outbox_events e ON e.event_type = 'TICKET_COMMENT_ADDED'
        AND e.resource_id = c.ticket_id AND e.payload->>'commentId' = c.id::text
      WHERE c.ticket_id = '${ticketId}' AND c.author_user_id = u.id`,
  ], { encoding: "utf8" }).trim();
  expect(persistedTechnicalConversation).toBe(
    `INTERNAL:${internalNote}:true:true:true:true|PUBLIC:${technicianPublicComment}:true:true:true:true`,
  );

  const persistedClaim = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT
      (t.assignee_user_id = u.id)::text || ':' || t.version || ':' || t.status || ':' ||
      (SELECT count(*) FROM support.outbox_events e
       WHERE e.event_type = 'TICKET_ASSIGNED' AND e.resource_id = t.id) || ':' ||
      (SELECT bool_and(e.actor_id = u.id AND e.resource_version = 1)
       FROM support.outbox_events e
       WHERE e.event_type = 'TICKET_ASSIGNED' AND e.resource_id = t.id) || ':' ||
      (SELECT bool_and(e.payload = jsonb_build_object('assigneeUserId', u.id::text))
       FROM support.outbox_events e
       WHERE e.event_type = 'TICKET_ASSIGNED' AND e.resource_id = t.id)
      FROM support.tickets t
      JOIN identity.human_users u ON u.normalized_username = '${supportUsername}'
      WHERE t.id = '${ticketId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedClaim).toBe("true:1:OPEN:1:true:true");

  const technicianLogoutResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/auth/logout") && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  expect((await technicianLogoutResponse).status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Usuario", { exact: true }).fill(username!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { name: username! })).toBeVisible();

  const requesterConversationResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/v1/tickets/${ticketId}/comments?`)
      && response.request().method() === "GET"
  ));
  await page.getByRole("button", { name: new RegExp(ticketSummary) }).click();
  const requesterConversation = await (await requesterConversationResponse).json() as {
    items: Array<{ visibility: string; body: string }>;
  };
  expect(requesterConversation.items.map((item) => item.body)).toContain(technicianPublicComment);
  expect(requesterConversation.items.map((item) => item.body)).not.toContain(internalNote);
  expect(requesterConversation.items.every((item) => item.visibility === "PUBLIC")).toBe(true);
  await expect(page.getByText(technicianPublicComment)).toBeVisible();
  await expect(page.getByText(internalNote)).not.toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain(internalNote);

  await page.getByLabel("UUID del activo").fill(assetId);
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByRole("article", { name: "Consulta por ID" })).toContainText(assetName);

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

  const activationResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/agents/${agentId}/activate`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Activar Agent" }).click();
  expect((await activationResponse).status()).toBe(200);
  await expect(agentCard).toContainText("ACTIVE");
  await expect(agentCard).toContainText("Sin contacto");
  await expect(agentCard).toContainText("Estado administrativoACTIVE");
  const connectionCard = page.getByRole("article", { name: "Conexión SFTP del Agent" });
  await expect(connectionCard).toBeVisible();
  const connectionText = await connectionCard.textContent();
  expect(connectionText).not.toContain(password);
  const connectionResponse = await (await activationResponse).json() as {
    host: string;
    port: number;
    username: string;
    publicHostKey: string;
  };
  const configuredOutput = execFileSync("uv", [
    "run",
    "--project",
    automationDir!,
    "--locked",
    "jaxon-agent",
    "configure-sftp",
    "--state-dir",
    agentStateDir!,
    "--host",
    connectionResponse.host,
    "--port",
    String(connectionResponse.port),
    "--username",
    connectionResponse.username,
    "--host-key",
    connectionResponse.publicHostKey,
  ], { encoding: "utf8" });
  expect(JSON.parse(configuredOutput).changed).toBe(true);
  const verifiedOutput = execFileSync("uv", [
    "run",
    "--project",
    automationDir!,
    "--locked",
    "jaxon-agent",
    "verify-sftp",
    "--state-dir",
    agentStateDir!,
  ], { encoding: "utf8" });
  expect(JSON.parse(verifiedOutput).status).toBe("verified");
  await expect(page.getByRole("button", { name: "Activar Agent" })).not.toBeVisible();
  await expect(page.getByText("Aún no hay información técnica observada para este activo.")).toBeVisible();
  await technicalEventsConnected;

  const snapshotOutput = execFileSync("uv", [
    "run",
    "--project",
    automationDir!,
    "--locked",
    "jaxon-agent",
    "send-snapshot",
    "--state-dir",
    agentStateDir!,
  ], { encoding: "utf8" });
  const sentSnapshot = JSON.parse(snapshotOutput) as {
    messageId: string;
    snapshotId: string;
    capturedAt: string;
    remotePath: string;
    status: string;
  };
  expect(sentSnapshot.status).toBe("SENT");
  expect(sentSnapshot.remotePath).toBe(`/snapshots/${sentSnapshot.messageId}.json`);

  const technicalState = async (id: string) => page.evaluate(async ({ api, id }) => {
    const response = await fetch(`${api}/api/v1/assets/${id}/technical-state`, { credentials: "include" });
    return { status: response.status, body: await response.json() };
  }, { api: backendUrl!, id });
  const agentState = async (id: string) => page.evaluate(async ({ api, id }) => {
    const response = await fetch(`${api}/api/v1/agents/${id}`, { credentials: "include" });
    return { status: response.status, body: await response.json() };
  }, { api: backendUrl!, id });
  const observedCard = page.getByRole("article", { name: "Última observación técnica" });
  await expect(observedCard).toContainText(sentSnapshot.snapshotId, { timeout: 30_000 });
  await expect(observedCard).toContainText("LINUX");
  await expect(page.getByRole("heading", { name: "Información oficial del activo" }).last()).toBeVisible();
  await page.getByRole("button", { name: "Consultar Agent" }).click();
  await expect(agentCard).toContainText("En línea");
  await expect(agentCard).toContainText("ACTIVE");
  const onlineAgent = await agentState(agentId);
  expect(onlineAgent.status).toBe(200);
  expect(onlineAgent.body.operationalStatus).toBe("ONLINE");
  expect(onlineAgent.body.lastSeenAt).toBeTruthy();
  expect(onlineAgent.body.lastSnapshotAt).toBe(sentSnapshot.capturedAt);

  const createTaskResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/agents/${agentId}/tasks`)
      && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Solicitar snapshot" }).click();
  const createdTaskResponse = await createTaskResponse;
  expect(createdTaskResponse.status()).toBe(201);
  const createdTask = await createdTaskResponse.json() as { taskId: string; status: string };
  expect(createdTask.taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(createdTask.status).toBe("DISPATCHED");
  const taskCard = page.getByRole("article", { name: "Estado de la tarea Agent" });
  await expect(taskCard).toContainText("DISPATCHED");

  const runnerOutput = execFileSync("uv", [
    "run",
    "--project",
    automationDir!,
    "--locked",
    "jaxon-agent",
    "run",
    "--state-dir",
    agentStateDir!,
    "--once",
  ], { encoding: "utf8", timeout: 330_000 });
  expect(JSON.parse(runnerOutput)).toMatchObject({ cycles: 1, status: "STOPPED" });
  await expect.poll(async () => page.evaluate(async ({ api, agent, task }) => {
    const response = await fetch(`${api}/api/v1/agents/${agent}/tasks/${task}`, {
      credentials: "include",
    });
    return (await response.json() as { status?: string }).status;
  }, { api: backendUrl!, agent: agentId, task: createdTask.taskId }), { timeout: 30_000 })
    .toBe("SUCCEEDED");
  await page.getByRole("button", { name: "Actualizar tarea" }).click();
  await expect(taskCard).toContainText("SUCCEEDED");
  await expect(taskCard).toContainText("COLLECT_SNAPSHOT");
  await expect.poll(async () => (
    await technicalState(assetId)
  ).body.latestObservation?.snapshotId, { timeout: 30_000 }).not.toBe(sentSnapshot.snapshotId);
  const taskSnapshotId = (await technicalState(assetId)).body.latestObservation.snapshotId as string;

  execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `UPDATE collector.accepted_snapshots
      SET received_at = CURRENT_TIMESTAMP - INTERVAL '6 minutes'
      WHERE agent_id = '${agentId}'`,
  ]);
  await page.getByRole("button", { name: "Consultar Agent" }).click();
  await expect(agentCard).toContainText("Fuera de línea");
  await expect(agentCard).toContainText("ACTIVE");
  const offlineAgent = await agentState(agentId);
  expect(offlineAgent.body.operationalStatus).toBe("OFFLINE");
  const offlineLastSeenAt = offlineAgent.body.lastSeenAt as string;

  const partialMessageId = "9d0d4d9b-4f40-4e15-88ae-451824e5ca92";
  const rejectedMessageId = "f2774922-02bb-42f8-a793-3e924bd753f8";
  const knownHosts = `${agentStateDir}/known_hosts_e2e`;
  const partialPayload = `${agentStateDir}/partial-e2e.json`;
  const acceptedPayload = `${agentStateDir}/accepted-e2e.json`;
  writeFileSync(knownHosts, `[127.0.0.1]:${connectionResponse.port} ${connectionResponse.publicHostKey}\n`, { mode: 0o600 });
  writeFileSync(partialPayload, "not-a-final-snapshot", { mode: 0o600 });
  execFileSync("docker", [
    "cp",
    `${sftpGoContainer}:/srv/sftpgo/data/agent-${agentId}-snapshots/${sentSnapshot.messageId}.json`,
    acceptedPayload,
  ]);
  execFileSync("docker", [
    "run", "--rm", "--volume", `${acceptedPayload}:/fixture`,
    "alpine:3.22", "chmod", "0644", "/fixture",
  ]);
  const partialUpload = spawnSync("sftp", [
    "-b", "-", "-P", String(connectionResponse.port),
    "-i", `${agentStateDir}/id_ed25519`,
    "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHosts}`,
    `${connectionResponse.username}@127.0.0.1`,
  ], {
    encoding: "utf8",
    input: `put ${partialPayload} /snapshots/${partialMessageId}.json.part\nput ${partialPayload} /snapshots/${rejectedMessageId}.json\n`,
  });
  expect(partialUpload.status).toBe(0);
  await page.waitForTimeout(2_500);
  expect(execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--tuples-only", "--no-align",
    "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT count(*) FROM collector.snapshot_ingestions WHERE claimed_message_id = '${partialMessageId}'`,
  ], { encoding: "utf8" }).trim()).toBe("0");
  expect(execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--tuples-only", "--no-align",
    "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT count(*) FROM collector.accepted_snapshots WHERE message_id = '${sentSnapshot.messageId}'`,
  ], { encoding: "utf8" }).trim()).toBe("1");
  await expect.poll(() => execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--tuples-only", "--no-align",
    "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT status FROM collector.snapshot_ingestions WHERE source_path LIKE '%/${rejectedMessageId}.json' ORDER BY received_at DESC LIMIT 1`,
  ], { encoding: "utf8" }).trim(), { timeout: 30_000 }).toBe("REJECTED");
  const afterRejection = await agentState(agentId);
  expect(afterRejection.body.status).toBe("ACTIVE");
  expect(afterRejection.body.operationalStatus).toBe("OFFLINE");
  expect(afterRejection.body.lastSeenAt).toBe(offlineLastSeenAt);
  expect(execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--tuples-only", "--no-align",
    "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT count(*) FROM collector.snapshot_ingestions WHERE claimed_message_id = '${sentSnapshot.messageId}' AND status = 'ACCEPTED'`,
  ], { encoding: "utf8" }).trim()).toBe("1");

  const currentSession = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/api/v1/auth/me`, { credentials: "include" });
    return response.json();
  }, backendUrl!);
  const apiMutation = async (
    path: string,
    method: "POST" | "PUT",
    body?: Record<string, string>,
  ) => page.evaluate(async ({ api, path, method, csrf, body }) => {
    const response = await fetch(`${api}/api/v1${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        "X-CSRF-Token": csrf,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }, { api: backendUrl!, path, method, csrf: currentSession.csrfToken as string, body });

  const repeatedActivation = await apiMutation(`/agents/${agentId}/activate`, "POST");
  expect(repeatedActivation.status).toBe(200);
  expect(repeatedActivation.body).toEqual(connectionResponse);

  const secondAsset = await apiMutation("/assets", "POST", {
    name: `E2E isolated asset ${Date.now()}`,
    assetType: "SERVER",
    status: "ACTIVE",
  });
  expect(secondAsset.status).toBe(201);
  const secondAgent = await apiMutation("/agents", "POST", {
    assetId: secondAsset.body.assetId as string,
  });
  expect(secondAgent.status).toBe(201);
  const secondAgentId = secondAgent.body.agentId as string;
  const secondStateDir = `${agentStateDir}-second`;
  const secondInitialized = JSON.parse(execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "initialize",
    "--agent-id", secondAgentId, "--state-dir", secondStateDir,
  ], { encoding: "utf8" })) as { publicKey: string };
  const secondKey = await apiMutation(`/agents/${secondAgentId}/ssh-key`, "PUT", {
    publicKey: secondInitialized.publicKey,
  });
  expect(secondKey.status).toBe(200);
  const secondActivation = await apiMutation(`/agents/${secondAgentId}/activate`, "POST");
  expect(secondActivation.status).toBe(200);
  expect(secondActivation.body.username).not.toBe(connectionResponse.username);

  const wrongHostStateDir = `${agentStateDir}-wrong-host`;
  const crossUserStateDir = `${agentStateDir}-cross-user`;
  cpSync(secondStateDir, wrongHostStateDir, { recursive: true });
  cpSync(secondStateDir, crossUserStateDir, { recursive: true });
  chmodSync(wrongHostStateDir, 0o700);
  chmodSync(crossUserStateDir, 0o700);
  execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "configure-sftp",
    "--state-dir", secondStateDir,
    "--host", secondActivation.body.host as string,
    "--port", String(secondActivation.body.port),
    "--username", secondActivation.body.username as string,
    "--host-key", secondActivation.body.publicHostKey as string,
  ]);
  expect(JSON.parse(execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "verify-sftp",
    "--state-dir", secondStateDir,
  ], { encoding: "utf8" })).status).toBe("verified");
  const secondSnapshot = JSON.parse(execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "send-snapshot",
    "--state-dir", secondStateDir,
  ], { encoding: "utf8" })) as { snapshotId: string; status: string };
  expect(secondSnapshot.status).toBe("SENT");
  await expect.poll(async () => (
    await technicalState(secondAsset.body.assetId as string)
  ).body.latestObservation?.snapshotId, { timeout: 30_000 }).toBe(secondSnapshot.snapshotId);
  expect(secondSnapshot.snapshotId).not.toBe(sentSnapshot.snapshotId);
  expect((await technicalState(assetId)).body.latestObservation.snapshotId).toBe(taskSnapshotId);

  const secondKnownHosts = `${secondStateDir}/known_hosts_e2e`;
  writeFileSync(secondKnownHosts, `[127.0.0.1]:${secondActivation.body.port} ${secondActivation.body.publicHostKey}\n`, { mode: 0o600 });
  const crossAgentUpload = spawnSync("sftp", [
    "-b", "-", "-P", String(secondActivation.body.port),
    "-i", `${secondStateDir}/id_ed25519`,
    "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${secondKnownHosts}`,
    `${secondActivation.body.username}@127.0.0.1`,
  ], { encoding: "utf8", input: `put ${acceptedPayload} /snapshots/${sentSnapshot.messageId}.json\n` });
  expect(crossAgentUpload.status).toBe(0);
  await expect.poll(() => execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--tuples-only", "--no-align",
    "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT reason_code FROM collector.snapshot_ingestions WHERE claimed_agent_id = '${secondAgentId}' AND claimed_message_id = '${sentSnapshot.messageId}' ORDER BY received_at DESC LIMIT 1`,
  ], { encoding: "utf8" }).trim(), { timeout: 30_000 }).toBe("PATH_AGENT_ID_MISMATCH");

  execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "configure-sftp",
    "--state-dir", wrongHostStateDir,
    "--host", secondActivation.body.host as string,
    "--port", String(secondActivation.body.port),
    "--username", secondActivation.body.username as string,
    "--host-key", initialized.publicKey,
  ]);
  const wrongHostVerification = spawnSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "verify-sftp",
    "--state-dir", wrongHostStateDir,
  ], { encoding: "utf8" });
  expect(wrongHostVerification.status).toBe(2);
  expect(wrongHostVerification.stderr).toContain("could not be verified securely");

  execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "configure-sftp",
    "--state-dir", crossUserStateDir,
    "--host", secondActivation.body.host as string,
    "--port", String(secondActivation.body.port),
    "--username", connectionResponse.username,
    "--host-key", secondActivation.body.publicHostKey as string,
  ]);
  const crossUserVerification = spawnSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "verify-sftp",
    "--state-dir", crossUserStateDir,
  ], { encoding: "utf8" });
  expect(crossUserVerification.status).toBe(2);
  expect(crossUserVerification.stderr).toContain("could not be verified securely");

  const conflictingAgent = await apiMutation("/agents", "POST", { assetId });
  expect(conflictingAgent.status).toBe(201);
  const conflictingAgentId = conflictingAgent.body.agentId as string;
  const conflictingStateDir = `${agentStateDir}-conflicting`;
  const conflictingIdentity = JSON.parse(execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-agent", "initialize",
    "--agent-id", conflictingAgentId, "--state-dir", conflictingStateDir,
  ], { encoding: "utf8" })) as { publicKey: string };
  expect((await apiMutation(`/agents/${conflictingAgentId}/ssh-key`, "PUT", {
    publicKey: conflictingIdentity.publicKey,
  })).status).toBe(200);
  const activationConflict = await apiMutation(`/agents/${conflictingAgentId}/activate`, "POST");
  expect(activationConflict.status).toBe(409);
  expect(activationConflict.body.code).toBe("ASSET_ACTIVE_AGENT_CONFLICT");
  const conflictingState = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT status || ':' ||
      (SELECT count(*) FROM collector.outbox_events
       WHERE event_type = 'AGENT_ACTIVATED' AND resource_id = a.id)
      FROM collector.agents a WHERE id = '${conflictingAgentId}'`,
  ], { encoding: "utf8" }).trim();
  expect(conflictingState).toBe("PENDING:0");
  const tokenResponse = await fetch(`${sftpGoApiUrl}/token`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${sftpGoAdminUsername}:${sftpGoAdminPassword}`).toString("base64")}`,
    },
  });
  expect(tokenResponse.status).toBe(200);
  const adminToken = (await tokenResponse.json() as { access_token: string }).access_token;
  const conflictingSftpUser = await fetch(
    `${sftpGoApiUrl}/users/${encodeURIComponent(`agent-${conflictingAgentId}`)}`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  expect(conflictingSftpUser.status).toBe(404);

  await page.reload();
  await page.getByLabel("UUID del activo").fill(assetId);
  await page.getByRole("button", { name: "Consultar" }).click();
  await page.getByLabel("UUID del Agent").fill(agentId);
  await page.getByRole("button", { name: "Consultar Agent" }).click();
  await expect(page.getByRole("article", { name: "Estado del Agent" })).toContainText(initialized.publicKeyFingerprint);
  await expect(page.getByRole("article", { name: "Estado del Agent" })).toContainText("ACTIVE");
  await expect(page.getByRole("article", { name: "Conexión SFTP del Agent" })).not.toBeVisible();

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
  expect(persistedAgent).toBe(`ACTIVE:${initialized.publicKeyFingerprint}:2:1`);

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
  await page.getByRole("button", { name: "Actualizar información técnica" }).click();
  await expect(page.getByText("La sesión no autoriza consultar la información técnica observada.")).toBeVisible();
  await expect(page.getByRole("article", { name: "Última observación técnica" })).not.toBeVisible();

  await page.context().clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/login");
  await page.getByLabel("Usuario").fill("unknown-user");
  await page.getByLabel("Contraseña").fill("invalid-passphrase");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.locator("#login-error")).toContainText("No fue posible iniciar sesión");
});
