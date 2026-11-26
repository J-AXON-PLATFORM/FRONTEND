import { expect, test } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const username = process.env.JAXON_E2E_USERNAME;
const password = process.env.JAXON_E2E_PASSWORD;
const backendUrl = process.env.JAXON_E2E_BACKEND_URL;
const unavailableBackendUrl = process.env.JAXON_E2E_UNAVAILABLE_BACKEND_URL;
const databaseContainer = process.env.JAXON_E2E_DATABASE_CONTAINER;
const sftpGoContainer = process.env.JAXON_E2E_SFTPGO_CONTAINER;
const automationDir = process.env.JAXON_E2E_AUTOMATION_DIR;
const agentStateDir = process.env.JAXON_E2E_AGENT_STATE_DIR;
const sftpGoApiUrl = process.env.JAXON_SFTPGO_ADMIN_API_URL;
const sftpGoAdminUsername = process.env.JAXON_SFTPGO_ADMIN_USERNAME;
const sftpGoAdminPassword = process.env.JAXON_SFTPGO_ADMIN_PASSWORD;
const aiStorageRoot = process.env.JAXON_E2E_AI_STORAGE_ROOT;

test.beforeAll(() => {
  if (!username || !password || !backendUrl || !unavailableBackendUrl || !databaseContainer || !sftpGoContainer || !automationDir
    || !agentStateDir || !sftpGoApiUrl || !sftpGoAdminUsername || !sftpGoAdminPassword) {
    throw new Error("E2E identity, backend, database, SFTPGo, and Agent configuration are required");
  }
  if (!aiStorageRoot) throw new Error("E2E AI document storage configuration is required");
});

test("logs in, manages a persisted asset, and enforces the security boundary", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: username! })).toBeVisible();
  await expect(page.getByText("IT OPERATOR")).toBeVisible();
  await expect(page.getByText("SYSTEM ADMIN")).toBeVisible();

  const aiWorkspace = page.getByRole("region", { name: "Fuentes documentales" });
  await expect(aiWorkspace).toBeVisible();
  await expect(aiWorkspace.getByText("No hay fuentes registradas.")).toBeVisible();

  const retrievalWorkspace = page.getByRole("region", { name: "Recuperación de evidencia" });
  await expect(retrievalWorkspace).toBeVisible();
  await retrievalWorkspace.getByLabel("Consulta").fill("operations handbook");
  const emptyRetrievalResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/ai/retrieval") && response.request().method() === "POST"
  ));
  await retrievalWorkspace.getByRole("button", { name: "Recuperar fragmentos" }).click();
  const emptyRetrieval = await emptyRetrievalResponse;
  expect(emptyRetrieval.status()).toBe(200);
  expect(await emptyRetrieval.json()).toEqual({ limit: 5, results: [] });
  await expect(retrievalWorkspace.getByText("No se encontró evidencia en fuentes listas para esta consulta."))
    .toBeVisible();
  const aiName = `E2E Operations Handbook ${Date.now()}`;
  const aiContent = Buffer.from("J-AXON E2E operations handbook\nStrict UTF-8: valid.\n", "utf8");
  await aiWorkspace.getByLabel("Nombre").fill(aiName);

  await aiWorkspace.getByLabel("Archivo de texto").setInputFiles({
    name: "wrong-media.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("plain bytes"),
  });
  await aiWorkspace.getByRole("button", { name: "Registrar fuente" }).click();
  await expect(aiWorkspace.getByRole("alert")).toContainText("exactamente el tipo text/plain");
  await expect(aiWorkspace.getByLabel("Nombre")).toHaveValue(aiName);

  await aiWorkspace.getByLabel("Archivo de texto").setInputFiles({
    name: "invalid-utf8.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xc3, 0x28]),
  });
  await aiWorkspace.getByRole("button", { name: "Registrar fuente" }).click();
  await expect(aiWorkspace.getByRole("alert")).toContainText("UTF-8 válido");
  await expect(aiWorkspace.getByLabel("Nombre")).toHaveValue(aiName);

  await aiWorkspace.getByLabel("Archivo de texto").setInputFiles({
    name: "oversized.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(1024 * 1024 + 1, 0x61),
  });
  await aiWorkspace.getByRole("button", { name: "Registrar fuente" }).click();
  await expect(aiWorkspace.getByRole("alert")).toContainText("superar 1 MiB");
  await expect(aiWorkspace.getByLabel("Nombre")).toHaveValue(aiName);

  await aiWorkspace.getByLabel("Archivo de texto").setInputFiles({
    name: "operations.txt",
    mimeType: "text/plain",
    buffer: aiContent,
  });
  page.once("dialog", (dialog) => dialog.accept());
  const createAiSourceResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/ai/sources") && response.request().method() === "POST"
  ));
  const firstAiPageResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/v1/ai/sources")
      && response.request().method() === "GET"
      && url.searchParams.get("page") === "0"
      && url.searchParams.get("size") === "20";
  });
  const aiDetailResponsePromise = page.waitForResponse((response) => (
    /\/api\/v1\/ai\/sources\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname)
      && response.request().method() === "GET"
  ));
  await aiWorkspace.getByRole("button", { name: "Registrar fuente" }).click();
  const createdAiResponse = await createAiSourceResponse;
  expect(createdAiResponse.status()).toBe(201);
  expect(createdAiResponse.request().headers()["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  const createdAiSource = await createdAiResponse.json() as {
    sourceId: string;
    name: string;
    mediaType: string;
    sizeBytes: number;
    sha256: string;
    status: string;
    version: number;
    createdByUserId: string;
    createdAt: string;
    updatedAt: string;
  };
  expect(Object.keys(createdAiSource).sort()).toEqual([
    "createdAt", "createdByUserId", "mediaType", "name", "sha256", "sizeBytes",
    "sourceId", "status", "updatedAt", "version",
  ]);
  expect(createdAiSource).toMatchObject({
    name: aiName,
    mediaType: "text/plain",
    sizeBytes: aiContent.length,
    sha256: createHash("sha256").update(aiContent).digest("hex"),
    status: "PENDING",
    version: 0,
  });
  expect((await firstAiPageResponse).status()).toBe(200);
  const aiDetailResponse = await aiDetailResponsePromise;
  expect(aiDetailResponse.url()).toContain(createdAiSource.sourceId);
  expect(aiDetailResponse.status()).toBe(200);
  expect(await aiDetailResponse.json()).toEqual(createdAiSource);
  const aiDetail = aiWorkspace.getByRole("article", { name: "Detalle de fuente documental" });
  await expect(aiDetail).toContainText(aiName);
  await expect(aiDetail).toContainText("PENDING · versión 0");
  await expect(aiDetail).toContainText(createdAiSource.sha256);
  await expect(aiWorkspace.getByLabel("Nombre")).toHaveValue("");
  await expect(aiWorkspace.getByLabel("Archivo de texto")).toHaveValue("");
  await expect(aiWorkspace.getByRole("link")).toHaveCount(0);

  const adminSession = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/api/v1/auth/me`, { credentials: "include" });
    return response.json() as Promise<{ csrfToken: string }>;
  }, backendUrl!);
  const rejectedAiRequests = await page.evaluate(async ({ api, csrf }) => {
    const request = async (content: Blob, token?: string) => {
      const body = new FormData();
      body.append("name", "Rejected E2E source");
      body.append("file", content, "rejected.txt");
      const response = await fetch(`${api}/api/v1/ai/sources`, {
        method: "POST",
        credentials: "include",
        headers: token ? { "X-CSRF-Token": token } : undefined,
        body,
      });
      return response.status;
    };
    return {
      csrf: await request(new Blob(["valid"], { type: "text/plain" })),
      media: await request(new Blob(["valid"], { type: "application/octet-stream" }), csrf),
      utf8: await request(new Blob([new Uint8Array([0xc3, 0x28])], { type: "text/plain" }), csrf),
      size: await request(new Blob([new Uint8Array(1024 * 1024 + 1)], { type: "text/plain" }), csrf),
    };
  }, { api: backendUrl!, csrf: adminSession.csrfToken });
  expect(rejectedAiRequests).toEqual({ csrf: 403, media: 422, utf8: 422, size: 413 });

  const aiStorageKey = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT storage_key FROM ai.document_sources WHERE id = '${createdAiSource.sourceId}'`,
  ], { encoding: "utf8" }).trim();
  expect(aiStorageKey).toMatch(/^[0-9a-f-]{36}\.txt$/);
  const persistedAiSource = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT s.status || ':' || s.version || ':' || s.media_type || ':' || s.size_bytes || ':' ||
      s.sha256 || ':' ||
      (SELECT count(*) FROM ai.outbox_events e
       WHERE e.resource_id = s.id AND e.event_type = 'AI_SOURCE_REGISTERED'
         AND e.event_version = '1.0' AND e.producer_module = 'AI'
         AND e.resource_type = 'AI_SOURCE' AND e.resource_version = 0
         AND e.payload = '{"status":"PENDING"}'::jsonb
         AND NOT e.payload ? 'name' AND NOT e.payload ? 'sha256')
      FROM ai.document_sources s WHERE s.id = '${createdAiSource.sourceId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedAiSource).toBe(
    `PENDING:0:text/plain:${aiContent.length}:${createdAiSource.sha256}:1`,
  );
  const aiStorageState = execFileSync("docker", [
    "exec", "--user", "0", databaseContainer!, "stat", "-c", "%a:%u:%g:%s",
    `${aiStorageRoot}/${aiStorageKey}`,
  ], { encoding: "utf8" }).trim();
  expect(aiStorageState).toBe(`600:10001:10001:${aiContent.length}`);
  const aiStorageRootState = execFileSync("docker", [
    "exec", "--user", "0", databaseContainer!, "stat", "-c", "%a:%u:%g",
    aiStorageRoot!,
  ], { encoding: "utf8" }).trim();
  expect(aiStorageRootState).toBe("700:10001:10001");
  const aiTempDir = mkdtempSync(join(tmpdir(), "jaxon-ai-source-"));
  try {
    const copiedAiSource = join(aiTempDir, "stored.txt");
    execFileSync("docker", [
      "cp", `${databaseContainer}:${aiStorageRoot}/${aiStorageKey}`, copiedAiSource,
    ]);
    expect(readFileSync(copiedAiSource)).toEqual(aiContent);
  } finally {
    rmSync(aiTempDir, { recursive: true, force: true });
  }

  const unavailableIndexing = await page.evaluate(async ({ api, sourceId, csrf }) => {
    const response = await fetch(`${api}/api/v1/ai/sources/${sourceId}/index`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ expectedVersion: 0 }),
    });
    return { status: response.status, body: await response.json() as { code?: string } };
  }, { api: unavailableBackendUrl!, sourceId: createdAiSource.sourceId, csrf: adminSession.csrfToken });
  expect(unavailableIndexing).toEqual({ status: 503, body: expect.objectContaining({ code: "AI_INDEXING_UNAVAILABLE" }) });
  const sourceAfterUnavailable = await page.evaluate(async ({ api, sourceId }) => (
    await (await fetch(`${api}/api/v1/ai/sources/${sourceId}`, { credentials: "include" })).json()
  ), { api: backendUrl!, sourceId: createdAiSource.sourceId });
  expect(sourceAfterUnavailable).toMatchObject({ status: "PENDING", version: 0 });

  page.once("dialog", (dialog) => dialog.accept());
  const indexAiSourceResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/ai/sources/${createdAiSource.sourceId}/index`)
      && response.request().method() === "POST"
  ));
  const indexedAiDetailResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/ai/sources/${createdAiSource.sourceId}`)
      && response.request().method() === "GET"
  ));
  await aiDetail.getByRole("button", { name: "Solicitar indexación" }).click();
  const acceptedIndexingResponse = await indexAiSourceResponse;
  expect(acceptedIndexingResponse.status()).toBe(202);
  expect(await acceptedIndexingResponse.json()).toMatchObject({
    sourceId: createdAiSource.sourceId,
    status: "INDEXING",
    version: 1,
  });
  expect((await indexedAiDetailResponse).status()).toBe(200);
  await expect(aiDetail.getByText(/(?:INDEXING|READY) · versión [12]/)).toBeVisible();

  const rejectedIndexRequests = await page.evaluate(async ({ api, sourceId, csrf }) => {
    const request = async (token?: string) => (await fetch(`${api}/api/v1/ai/sources/${sourceId}/index`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-CSRF-Token": token } : {}),
      },
      body: JSON.stringify({ expectedVersion: 0 }),
    })).status;
    return { csrf: await request(), stale: await request(csrf) };
  }, { api: backendUrl!, sourceId: createdAiSource.sourceId, csrf: adminSession.csrfToken });
  expect(rejectedIndexRequests).toEqual({ csrf: 403, stale: 409 });

  await expect.poll(() => execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT s.status || ':' || s.version || ':' ||
      (SELECT count(*) FROM ai.source_chunks c WHERE c.source_id = s.id
        AND c.token_count <= 480 AND c.end_token - c.start_token = c.token_count
        AND c.model_id = 'intfloat/multilingual-e5-small'
        AND c.model_revision = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
        AND c.chunker_version = 'token-480-overlap-72-v1') || ':' ||
      (SELECT count(*) FROM ai.outbox_events e WHERE e.resource_id = s.id
        AND e.event_type = 'AI_SOURCE_INDEXING_REQUESTED' AND e.resource_version = 1
        AND e.payload = '{"status":"INDEXING"}'::jsonb) || ':' ||
      (SELECT count(*) FROM ai.outbox_events e WHERE e.resource_id = s.id
        AND e.event_type = 'AI_SOURCE_INDEXED' AND e.resource_version = 2
        AND e.payload = '{"status":"READY"}'::jsonb)
      FROM ai.document_sources s WHERE s.id = '${createdAiSource.sourceId}'`,
  ], { encoding: "utf8" }).trim(), { timeout: 60_000 }).toBe("READY:2:1:1:1");
  await aiDetail.getByRole("button", { name: "Actualizar estado" }).click();
  await expect(aiDetail.getByText("READY · versión 2")).toBeVisible();
  await expect(aiWorkspace.getByRole("button", { name: new RegExp(aiName) })).toContainText("READY");

  await retrievalWorkspace.getByLabel("Máximo de fragmentos").selectOption("3");
  const readyRetrievalResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/ai/retrieval") && response.request().method() === "POST"
  ));
  await retrievalWorkspace.getByRole("button", { name: "Recuperar fragmentos" }).click();
  const readyRetrieval = await readyRetrievalResponse;
  expect(readyRetrieval.status()).toBe(200);
  expect(JSON.parse(readyRetrieval.request().postData() ?? "{}")).toEqual({ query: "operations handbook", limit: 3 });
  const retrieved = await readyRetrieval.json() as {
    limit: number;
    results: Array<{
      sourceId: string; sourceName: string; sourceSha256: string; chunkId: string; ordinal: number;
      startToken: number; endToken: number; contentSha256: string; content: string; similarity: number;
    }>;
  };
  expect(retrieved.limit).toBe(3);
  expect(retrieved.results).toHaveLength(1);
  const [evidence] = retrieved.results;
  expect(Object.keys(evidence).sort()).toEqual([
    "chunkId", "content", "contentSha256", "endToken", "ordinal", "similarity", "sourceId",
    "sourceName", "sourceSha256", "startToken",
  ]);
  expect(evidence).toMatchObject({
    sourceId: createdAiSource.sourceId,
    sourceName: aiName,
    sourceSha256: createdAiSource.sha256,
    ordinal: 0,
  });
  expect(evidence.content).toContain("operations handbook");
  expect(Number.isFinite(evidence.similarity) && evidence.similarity > 0 && evidence.similarity <= 1).toBe(true);
  const persistedEvidence = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT c.source_id || ':' || c.ordinal || ':' || c.content_sha256 || ':' ||
      c.start_token || ':' || c.end_token || ':' ||
      (SELECT count(*) FROM ai.outbox_events e WHERE e.resource_id = c.source_id)
      FROM ai.source_chunks c WHERE c.id = '${evidence.chunkId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedEvidence).toBe(
    `${createdAiSource.sourceId}:0:${evidence.contentSha256}:${evidence.startToken}:${evidence.endToken}:3`,
  );
  const evidenceCard = retrievalWorkspace.getByRole("article", { name: `Fragmento 1 de ${aiName}` });
  await expect(evidenceCard).toContainText(createdAiSource.sourceId);
  await expect(evidenceCard).toContainText(evidence.chunkId);
  await expect(evidenceCard).toContainText(`similitud ${evidence.similarity.toFixed(4)}`);
  await expect(retrievalWorkspace.getByText(/sin generación ni interpretación/)).toBeVisible();
  expect(JSON.stringify(retrieved)).not.toContain(aiStorageKey);

  const rejectedRetrievals = await page.evaluate(async ({ api, unavailableApi, csrf }) => {
    const request = async (base: string, body: string, token?: string) => (await fetch(`${base}/api/v1/ai/retrieval`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
      body,
    })).status;
    return {
      csrf: await request(api, JSON.stringify({ query: "handbook" })),
      unknown: await request(api, JSON.stringify({ query: "handbook", extra: true }), csrf),
      limit: await request(api, JSON.stringify({ query: "handbook", limit: 11 }), csrf),
      duplicate: await request(api, "{\"query\":\"a\",\"query\":\"b\"}", csrf),
      unavailable: await request(unavailableApi, JSON.stringify({ query: "handbook" }), csrf),
    };
  }, { api: backendUrl!, unavailableApi: unavailableBackendUrl!, csrf: adminSession.csrfToken });
  expect(rejectedRetrievals).toEqual({ csrf: 403, unknown: 422, limit: 422, duplicate: 400, unavailable: 503 });

  const chunksBeforeDisable = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT string_agg(id || ':' || content_sha256 || ':' || md5(embedding::text), ',' ORDER BY ordinal)
      FROM ai.source_chunks WHERE source_id = '${createdAiSource.sourceId}'`,
  ], { encoding: "utf8" }).trim();
  expect(chunksBeforeDisable).not.toBe("");
  const rejectedDisableRequests = await page.evaluate(async ({ api, sourceId, csrf }) => {
    const request = async (body: string, token?: string) => (await fetch(`${api}/api/v1/ai/sources/${sourceId}/disable`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
      body,
    })).status;
    return {
      csrf: await request(JSON.stringify({ expectedVersion: 2 })),
      stale: await request(JSON.stringify({ expectedVersion: 1 }), csrf),
      unknown: await request(JSON.stringify({ expectedVersion: 2, reason: "x" }), csrf),
    };
  }, { api: backendUrl!, sourceId: createdAiSource.sourceId, csrf: adminSession.csrfToken });
  expect(rejectedDisableRequests).toEqual({ csrf: 403, stale: 409, unknown: 422 });

  page.once("dialog", (dialog) => dialog.accept());
  const disableAiSourceResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/ai/sources/${createdAiSource.sourceId}/disable`)
      && response.request().method() === "POST"
  ));
  const retrievalAfterDisableResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/ai/retrieval") && response.request().method() === "POST"
  ));
  await aiDetail.getByRole("button", { name: "Deshabilitar" }).click();
  const disabledAiSourceResponse = await disableAiSourceResponse;
  expect(disabledAiSourceResponse.status()).toBe(200);
  expect(JSON.parse(disabledAiSourceResponse.request().postData() ?? "{}")).toEqual({ expectedVersion: 2 });
  expect(await disabledAiSourceResponse.json()).toMatchObject({
    sourceId: createdAiSource.sourceId,
    status: "DISABLED",
    version: 3,
  });
  await expect(aiDetail.getByText("DISABLED · versión 3")).toBeVisible();
  await expect(aiWorkspace.getByRole("button", { name: new RegExp(aiName) })).toContainText("DISABLED");
  await expect(aiDetail.getByRole("button", { name: "Deshabilitar" })).toHaveCount(0);
  await expect(aiDetail.getByRole("button", { name: "Solicitar indexación" })).toHaveCount(0);
  const retrievalAfterDisable = await retrievalAfterDisableResponse;
  expect(retrievalAfterDisable.status()).toBe(200);
  expect((await retrievalAfterDisable.json() as { results: unknown[] }).results).toEqual([]);
  await expect(retrievalWorkspace.getByText("No se encontró evidencia en fuentes listas para esta consulta."))
    .toBeVisible();

  const explicitRetrievalResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/ai/retrieval") && response.request().method() === "POST"
  ));
  await retrievalWorkspace.getByRole("button", { name: "Recuperar fragmentos" }).click();
  const explicitRetrieval = await explicitRetrievalResponse;
  expect(explicitRetrieval.status()).toBe(200);
  expect(JSON.stringify(await explicitRetrieval.json())).not.toContain(createdAiSource.sourceId);

  const noOpDisable = await page.evaluate(async ({ api, sourceId, csrf }) => {
    const request = async (expectedVersion: number) => {
      const response = await fetch(`${api}/api/v1/ai/sources/${sourceId}/disable`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ expectedVersion }),
      });
      return { status: response.status, body: await response.json() as { status?: string; version?: number } };
    };
    return { current: await request(3), stale: (await request(2)).status };
  }, { api: backendUrl!, sourceId: createdAiSource.sourceId, csrf: adminSession.csrfToken });
  expect(noOpDisable).toEqual({
    current: { status: 200, body: expect.objectContaining({ status: "DISABLED", version: 3 }) },
    stale: 409,
  });
  expect(execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT s.status || ':' || s.version || ':' ||
      (SELECT count(*) FROM ai.outbox_events e WHERE e.resource_id = s.id
        AND e.event_type = 'AI_SOURCE_DISABLED' AND e.resource_version = 3
        AND e.payload = '{"previousStatus":"READY","newStatus":"DISABLED"}'::jsonb) || ':' ||
      (SELECT count(*) FROM ai.outbox_events e WHERE e.resource_id = s.id) || '|' ||
      (SELECT string_agg(c.id || ':' || c.content_sha256 || ':' || md5(c.embedding::text), ',' ORDER BY c.ordinal)
        FROM ai.source_chunks c WHERE c.source_id = s.id)
      FROM ai.document_sources s WHERE s.id = '${createdAiSource.sourceId}'`,
  ], { encoding: "utf8" }).trim()).toBe(`DISABLED:3:1:4|${chunksBeforeDisable}`);
  const disabledAuditSource = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT event_id || ':' || correlation_id || ':' || actor_id FROM ai.outbox_events
      WHERE resource_id = '${createdAiSource.sourceId}' AND event_type = 'AI_SOURCE_DISABLED'`,
  ], { encoding: "utf8" }).trim().split(":");
  const [disabledEventId, disabledCorrelationId, disabledActorId] = disabledAuditSource;
  await expect.poll(() => execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT
      (SELECT d.status || ':' || d.attempts FROM ai.outbox_deliveries d
        WHERE d.event_id = '${disabledEventId}' AND d.consumer = 'AUDIT') || '|' ||
      (SELECT a.event_type || ':' || a.producer_module || ':' || a.actor_id || ':' || a.resource_type || ':' ||
              a.resource_id || ':' || a.resource_version || ':' || a.result || ':' || a.correlation_id || ':' ||
              a.metadata::text
        FROM audit_reporting.audit_events a WHERE a.source_event_id = '${disabledEventId}') || '|' ||
      (SELECT e.status FROM ai.outbox_events e WHERE e.event_id = '${disabledEventId}')`,
  ], { encoding: "utf8" }).trim(), { timeout: 30_000 }).toBe(
    `DELIVERED:1|AI_SOURCE_DISABLED:AI:${disabledActorId}:AI_SOURCE:${createdAiSource.sourceId}:3:SUCCESS:`
      + `${disabledCorrelationId}:{"newStatus": "DISABLED", "previousStatus": "READY"}|PENDING`,
  );
  await expect(page.getByRole("heading", { name: "Auditoría", exact: true })).toHaveCount(0);
  const auditorUsername = `auditor.only.${Date.now()}`;
  const auditorPassword = `Auditor-${crypto.randomUUID()}-Aa9!`;
  const adminAuditAccess = await page.evaluate(async ({ api, csrf, user, secret }) => {
    const audit = await fetch(`${api}/api/v1/audit/events`, { credentials: "include" });
    const created = await fetch(`${api}/api/v1/users`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ username: user, password: secret, roles: ["AUDITOR"] }),
    });
    return { audit: audit.status, created: created.status };
  }, { api: backendUrl!, csrf: adminSession.csrfToken, user: auditorUsername, secret: auditorPassword });
  expect(adminAuditAccess).toEqual({ audit: 403, created: 201 });
  const disabledAiTempDir = mkdtempSync(join(tmpdir(), "jaxon-ai-disabled-source-"));
  try {
    const copiedDisabledSource = join(disabledAiTempDir, "stored.txt");
    execFileSync("docker", [
      "cp", `${databaseContainer}:${aiStorageRoot}/${aiStorageKey}`, copiedDisabledSource,
    ]);
    expect(readFileSync(copiedDisabledSource)).toEqual(aiContent);
  } finally {
    rmSync(disabledAiTempDir, { recursive: true, force: true });
  }

  const scopeName = `E2E authorized network ${Date.now()}`;
  const createScopeResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/discovery/scopes") && response.request().method() === "POST"
  ));
  await page.getByLabel("Nombre del ámbito").fill(scopeName);
  await page.getByLabel("Red CIDR canónica").fill("198.51.100.0/24");
  await page.getByRole("button", { name: "Crear ámbito" }).click();
  const createdScopeResponse = await createScopeResponse;
  expect(createdScopeResponse.status()).toBe(201);
  const createdScope = await createdScopeResponse.json() as { scopeId: string; version: number };
  const scopeCard = page.getByRole("heading", { name: scopeName }).locator("../..");
  await expect(scopeCard).toContainText("198.51.100.0/24");
  await expect(scopeCard).toContainText("ACTIVE");

  const executorName = `E2E Discovery Executor ${Date.now()}`;
  const executorWorkspace = page.getByRole("region", { name: "Discovery Executors" });
  const createExecutorResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/discovery/executors")
      && response.request().method() === "POST"
  ));
  await executorWorkspace.getByLabel("Nombre", { exact: true }).fill(executorName);
  await executorWorkspace.getByRole("checkbox", { name: new RegExp(scopeName) }).check();
  await executorWorkspace.getByRole("button", { name: "Pre-registrar executor" }).click();
  const createdExecutorResponse = await createExecutorResponse;
  expect(createdExecutorResponse.status()).toBe(201);
  const createdExecutor = await createdExecutorResponse.json() as {
    executorId: string;
    status: string;
    version: number;
  };
  expect(createdExecutor.status).toBe("PENDING");
  expect(createdExecutor.version).toBe(0);

  const executorStateDir = `${agentStateDir}-discovery-${Date.now()}`;
  const initializerOutput = execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-discovery-executor",
    "initialize", "--executor-id", createdExecutor.executorId,
    "--state-dir", executorStateDir,
  ], { encoding: "utf8" });
  expect(initializerOutput).not.toContain("OPENSSH PRIVATE KEY");
  const initializedExecutor = JSON.parse(initializerOutput) as {
    executorId: string;
    publicKey: string;
    publicKeyFingerprint: string;
  };
  expect(initializedExecutor.executorId).toBe(createdExecutor.executorId);
  await expect(executorWorkspace.getByText(new RegExp(`jaxon-discovery-executor initialize --executor-id ${createdExecutor.executorId}`)))
    .toBeVisible();

  const registerExecutorKeyResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/discovery/executors/${createdExecutor.executorId}/ssh-key`)
      && response.request().method() === "PUT"
  ));
  await executorWorkspace.getByLabel("Clave pública Ed25519").fill(initializedExecutor.publicKey);
  await executorWorkspace.getByRole("button", { name: "Registrar clave pública" }).click();
  expect((await registerExecutorKeyResponse).status()).toBe(200);
  await expect(executorWorkspace.getByText(initializedExecutor.publicKeyFingerprint)).toBeVisible();

  const activateExecutorResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/discovery/executors/${createdExecutor.executorId}/activate`)
      && response.request().method() === "POST"
  ));
  await executorWorkspace.getByRole("button", { name: "Activar Discovery Executor" }).click();
  const activatedExecutorResponse = await activateExecutorResponse;
  expect(activatedExecutorResponse.status()).toBe(200);
  const executorConnection = await activatedExecutorResponse.json() as {
    host: string;
    port: number;
    username: string;
    hostKey: string;
    hostKeyFingerprint: string;
  };
  expect(executorConnection.username).toBe(`discovery-executor-${createdExecutor.executorId}`);
  const executorConnectionCard = executorWorkspace.getByRole("article", {
    name: "Conexión SFTP del Discovery Executor",
  });
  await expect(executorConnectionCard).toContainText(executorConnection.hostKeyFingerprint);
  await expect(executorWorkspace.getByText(/ACTIVE · versión 1/)).toBeVisible();
  await expect(executorWorkspace.getByRole("button", { name: "Activar Discovery Executor" }))
    .not.toBeVisible();
  expect((await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))))
    .toEqual({ local: 0, session: 0 });

  const configuredExecutor = JSON.parse(execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-discovery-executor",
    "configure-sftp", "--state-dir", executorStateDir,
    "--host", executorConnection.host,
    "--port", String(executorConnection.port),
    "--username", executorConnection.username,
    "--host-key", executorConnection.hostKey,
  ], { encoding: "utf8" })) as { changed: boolean; hostKeyFingerprint: string };
  expect(configuredExecutor.changed).toBe(true);
  expect(configuredExecutor.hostKeyFingerprint).toBe(executorConnection.hostKeyFingerprint);
  const verifiedExecutor = JSON.parse(execFileSync("uv", [
    "run", "--project", automationDir!, "--locked", "jaxon-discovery-executor",
    "verify-sftp", "--state-dir", executorStateDir,
  ], { encoding: "utf8" })) as { status: string; executorId: string };
  expect(verifiedExecutor).toMatchObject({
    status: "verified",
    executorId: createdExecutor.executorId,
  });

  const repeatedExecutorActivation = await page.evaluate(async ({ api, executorId, csrf }) => {
    const response = await fetch(`${api}/api/v1/discovery/executors/${executorId}/activate`, {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": csrf },
    });
    return { status: response.status, body: await response.json() };
  }, {
    api: backendUrl!,
    executorId: createdExecutor.executorId,
    csrf: activatedExecutorResponse.request().headers()["x-csrf-token"],
  });
  expect(repeatedExecutorActivation).toEqual({ status: 200, body: executorConnection });

  const discoveryTokenResponse = await fetch(`${sftpGoApiUrl}/token`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${sftpGoAdminUsername}:${sftpGoAdminPassword}`).toString("base64")}`,
    },
  });
  expect(discoveryTokenResponse.status).toBe(200);
  const discoveryToken = (await discoveryTokenResponse.json() as { access_token: string }).access_token;
  const discoveryUserResponse = await fetch(
    `${sftpGoApiUrl}/users/${encodeURIComponent(executorConnection.username)}`,
    { headers: { Authorization: `Bearer ${discoveryToken}` } },
  );
  expect(discoveryUserResponse.status).toBe(200);
  const discoveryUser = await discoveryUserResponse.json() as {
    username: string;
    home_dir: string;
    permissions: Record<string, string[]>;
    virtual_folders: Array<{
      virtual_path: string;
      mapped_path: string;
      quota_size: number;
      quota_files: number;
    }>;
    quota_size: number;
    quota_files: number;
  };
  expect(discoveryUser).toMatchObject({
    username: executorConnection.username,
    home_dir: `/srv/sftpgo/data/${executorConnection.username}`,
    permissions: {
      "/": ["list"],
      "/jobs": ["list", "download"],
      "/results": expect.arrayContaining(["list", "download", "upload", "rename_files"]),
    },
    quota_size: 0,
    quota_files: 0,
  });
  expect(discoveryUser.virtual_folders).toEqual(expect.arrayContaining([
    expect.objectContaining({
      virtual_path: "/jobs",
      mapped_path: `/srv/sftpgo/discovery-jobs/${executorConnection.username}-jobs`,
    }),
    expect.objectContaining({
      virtual_path: "/results",
      mapped_path: `/srv/sftpgo/discovery-results/${executorConnection.username}-results`,
      quota_size: 15 * 1024 * 1024,
      quota_files: 3,
    }),
  ]));
  expect(discoveryUser).not.toHaveProperty("password");

  const jobWorkspace = page.getByRole("region", { name: "Discovery Jobs" });
  await jobWorkspace.getByLabel("Executor activo").selectOption(createdExecutor.executorId);
  await jobWorkspace.getByLabel("Ámbito activo asociado").selectOption(createdScope.scopeId);
  const createJobResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/v1/discovery/jobs")
      && response.request().method() === "POST"
  ));
  await jobWorkspace.getByRole("button", { name: "Crear Discovery Job" }).click();
  const createdJobResponse = await createJobResponse;
  expect(createdJobResponse.status()).toBe(201);
  const createdJob = await createdJobResponse.json() as {
    jobId: string;
    executorId: string;
    scopeId: string;
    profile: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    dispatchedAt: string;
    version: number;
  };
  expect(createdJob).toMatchObject({
    executorId: createdExecutor.executorId,
    scopeId: createdScope.scopeId,
    profile: "BASIC",
    status: "DISPATCHED",
    version: 1,
  });
  expect(Date.parse(createdJob.expiresAt) - Date.parse(createdJob.createdAt)).toBe(60 * 60 * 1000);
  await expect(jobWorkspace.getByRole("article", { name: "Estado del Discovery Job" }))
    .toContainText("DISPATCHED · versión 1");
  const refreshJobResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/discovery/jobs/${createdJob.jobId}`)
      && response.request().method() === "GET"
  ));
  await jobWorkspace.getByRole("button", { name: "Actualizar job" }).click();
  expect((await refreshJobResponse).status()).toBe(200);

  const jobPath = `/srv/sftpgo/discovery-jobs/${executorConnection.username}-jobs/${createdJob.jobId}.json`;
  const jobTempDir = mkdtempSync(join(tmpdir(), "jaxon-discovery-job-"));
  const localJobPath = join(jobTempDir, `${createdJob.jobId}.json`);
  try {
    execFileSync("docker", ["cp", `${sftpGoContainer}:${jobPath}`, localJobPath]);
    expect(spawnSync("docker", [
      "cp", `${sftpGoContainer}:${jobPath}.part`, `${localJobPath}.part`,
    ]).status).not.toBe(0);
    const publishedJob = JSON.parse(readFileSync(localJobPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(publishedJob).sort()).toEqual([
      "createdAt", "executorId", "expiresAt", "jobId", "messageType",
      "profile", "schemaVersion", "scopeCidr", "scopeId",
    ]);
    expect(publishedJob).toMatchObject({
      schemaVersion: "1.0",
      messageType: "DISCOVERY_JOB",
      jobId: createdJob.jobId,
      executorId: createdExecutor.executorId,
      scopeId: createdScope.scopeId,
      scopeCidr: "198.51.100.0/24",
      profile: "BASIC",
      createdAt: createdJob.createdAt,
      expiresAt: createdJob.expiresAt,
    });
  } finally {
    rmSync(jobTempDir, { recursive: true, force: true });
  }
  const persistedJob = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT j.status || ':' || j.version || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = j.job_id AND e.event_type = 'DISCOVERY_JOB_CREATED'
         AND e.resource_version = 0
         AND e.payload = '{"status":"PENDING","profile":"BASIC"}'::jsonb) || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = j.job_id AND e.event_type = 'DISCOVERY_JOB_DISPATCHED'
         AND e.resource_version = 1
         AND e.payload = '{"status":"DISPATCHED"}'::jsonb)
      FROM discovery.discovery_jobs j WHERE j.job_id = '${createdJob.jobId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedJob).toBe("DISPATCHED:1:1:1");

  const resultTempDir = mkdtempSync(join(tmpdir(), "jaxon-discovery-result-"));
  try {
    const resultPath = join(resultTempDir, `${createdJob.jobId}.json`);
    const batchPath = join(resultTempDir, "sftp.batch");
    const knownHostsPath = join(resultTempDir, "known_hosts");
    const completedAt = createdJob.dispatchedAt;
    writeFileSync(resultPath, JSON.stringify({
      schemaVersion: "1.0",
      messageType: "DISCOVERY_RESULT",
      resultId: crypto.randomUUID(),
      jobId: createdJob.jobId,
      executorId: createdExecutor.executorId,
      scopeId: createdScope.scopeId,
      profile: "BASIC",
      startedAt: createdJob.dispatchedAt,
      completedAt,
      status: "SUCCEEDED",
      failureCode: null,
      summary: { targetsConsidered: 256, targetsScanned: 256, observationsFound: 3 },
      observations: [{
        ipAddress: "198.51.100.10",
        macAddress: "02:00:5e:10:00:01",
        hostname: "e2e-discovered.example.internal",
        evidence: ["ARP", "TCP"],
        openTcpPorts: [22, 443],
      }, {
        ipAddress: "198.51.100.11",
        macAddress: "02:00:5e:10:00:02",
        hostname: "e2e-incorporated.example.internal",
        evidence: ["ICMP", "TCP"],
        openTcpPorts: [80],
      }, {
        ipAddress: "198.51.100.12",
        macAddress: "02:00:5e:10:00:03",
        hostname: "e2e-new-asset.example.internal",
        evidence: ["ARP", "TCP"],
        openTcpPorts: [443],
      }],
    }));
    writeFileSync(batchPath, [
      `put ${resultPath} /results/${createdJob.jobId}.json.part`,
      `rename /results/${createdJob.jobId}.json.part /results/${createdJob.jobId}.json`,
      "",
    ].join("\n"));
    writeFileSync(
      knownHostsPath,
      `[${executorConnection.host}]:${executorConnection.port} ${executorConnection.hostKey}\n`,
    );
    chmodSync(knownHostsPath, 0o600);
    execFileSync("sftp", [
      "-P", String(executorConnection.port),
      "-i", join(executorStateDir, "executor_ed25519"),
      "-o", `UserKnownHostsFile=${knownHostsPath}`,
      "-o", "StrictHostKeyChecking=yes",
      "-b", batchPath,
      `${executorConnection.username}@${executorConnection.host}`,
    ]);
  } finally {
    rmSync(resultTempDir, { recursive: true, force: true });
  }

  await expect.poll(async () => {
    const responsePromise = page.waitForResponse((response) => (
      response.url().endsWith(`/api/v1/discovery/jobs/${createdJob.jobId}`)
        && response.request().method() === "GET"
    ));
    await jobWorkspace.getByRole("button", { name: "Actualizar job" }).click();
    const response = await responsePromise;
    return (await response.json() as { status: string }).status;
  }, { timeout: 15_000 }).toBe("SUCCEEDED");
  await expect(jobWorkspace.getByRole("article", { name: "Estado del Discovery Job" }))
    .toContainText("SUCCEEDED · versión 2");
  const discoveredDevices = jobWorkspace.getByRole("region", { name: "Dispositivos descubiertos" });
  await expect(discoveredDevices.getByRole("heading", { name: "e2e-discovered.example.internal" }))
    .toBeVisible();
  await expect(discoveredDevices).toContainText("198.51.100.10");
  await expect(discoveredDevices).toContainText("22, 443");
  const inventoryCountBeforeIgnore = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", "SELECT count(*) FROM inventory.assets",
  ], { encoding: "utf8" }).trim();
  const discoveredDeviceCard = discoveredDevices.getByRole("listitem")
    .filter({ hasText: "e2e-discovered.example.internal" });
  page.once("dialog", (dialog) => dialog.accept());
  const ignoreDeviceResponse = page.waitForResponse((response) => (
    response.url().endsWith("/ignore") && response.request().method() === "POST"
  ));
  await discoveredDeviceCard.getByRole("button", {
    name: "Ignorar e2e-discovered.example.internal",
  }).click();
  const ignoredDeviceResponse = await ignoreDeviceResponse;
  expect(ignoredDeviceResponse.status()).toBe(200);
  expect(await ignoredDeviceResponse.json()).toMatchObject({
    jobId: createdJob.jobId,
    status: "IGNORED",
    version: 1,
  });
  await expect(discoveredDeviceCard).toContainText("IGNORED");
  await expect(discoveredDeviceCard).toContainText("Revisado");
  await expect(discoveredDeviceCard.getByRole("button", { name: /Ignorar/ })).toHaveCount(0);
  const persistedIgnoredDevice = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT d.status || ':' || d.version || ':' || (d.reviewed_at IS NOT NULL) || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = d.discovered_device_id AND e.event_type = 'DISCOVERED_DEVICE_IGNORED'
         AND e.resource_version = 1
         AND e.payload = '{"newStatus":"IGNORED","previousStatus":"UNREVIEWED"}'::jsonb) || ':' ||
      (SELECT count(*) FROM inventory.assets)
       FROM discovery.discovered_devices d
       WHERE d.job_id = '${createdJob.jobId}' AND d.status = 'IGNORED'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedIgnoredDevice).toBe(`IGNORED:1:true:1:${inventoryCountBeforeIgnore}`);
  const persistedDiscoveryResult = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT j.status || ':' || j.version || ':' ||
      (SELECT count(*) FROM discovery.discovered_devices d
       WHERE d.job_id = j.job_id AND d.status = 'IGNORED') || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = j.job_id AND e.event_type = 'DISCOVERY_JOB_COMPLETED'
         AND e.resource_version = 2)
      FROM discovery.discovery_jobs j WHERE j.job_id = '${createdJob.jobId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedDiscoveryResult).toBe("SUCCEEDED:2:1:1");

  const disableScopeResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/discovery/scopes/${createdScope.scopeId}/status`)
      && response.request().method() === "PUT"
  ));
  await scopeCard.getByRole("button", { name: `Deshabilitar ${scopeName}` }).click();
  expect((await disableScopeResponse).status()).toBe(200);
  await expect(scopeCard).toContainText("DISABLED");
  await expect(executorWorkspace.getByText(createdScope.scopeId)).toBeVisible();
  const persistedScope = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT s.status || ':' || s.version || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = s.id AND e.event_type = 'DISCOVERY_SCOPE_CREATED'
         AND e.resource_version = 0 AND e.payload = '{"status":"ACTIVE"}'::jsonb
         AND NOT e.payload ? 'name' AND NOT e.payload ? 'cidr') || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = s.id AND e.event_type = 'DISCOVERY_SCOPE_STATUS_CHANGED'
         AND e.resource_version = 1
         AND e.payload = '{"previousStatus":"ACTIVE","newStatus":"DISABLED"}'::jsonb
         AND NOT e.payload ? 'name' AND NOT e.payload ? 'cidr')
      FROM discovery.authorized_scopes s WHERE s.id = '${createdScope.scopeId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedScope).toBe("DISABLED:1:1:1");
  const persistedExecutor = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT x.status || ':' || x.version || ':' ||
       (SELECT count(*) FROM discovery.discovery_executor_scopes a
        WHERE a.executor_id = x.id AND a.scope_id = '${createdScope.scopeId}') || ':' ||
       ((x.sftp_username = '${executorConnection.username}' AND x.activated_at IS NOT NULL)::int) || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = x.id AND e.event_type = 'DISCOVERY_EXECUTOR_PRE_REGISTERED'
         AND e.resource_version = 0 AND e.payload = '{"status":"PENDING"}'::jsonb) || ':' ||
      (SELECT count(*) FROM identity.technical_identities i
       WHERE i.discovery_executor_id = x.id AND i.agent_id IS NULL
         AND i.identity_type = 'DISCOVERY_EXECUTOR'
         AND i.public_key_fingerprint = '${initializedExecutor.publicKeyFingerprint}') || ':' ||
       (SELECT count(*) FROM discovery.outbox_events e
        WHERE e.resource_id = x.id AND e.event_type = 'DISCOVERY_EXECUTOR_ACTIVATED'
          AND e.resource_version = 1 AND e.payload = '{"status":"ACTIVE"}'::jsonb) || ':' ||
       (SELECT count(*) FROM identity.outbox_events e
        WHERE e.resource_id = x.id
         AND e.event_type = 'DISCOVERY_EXECUTOR_PUBLIC_KEY_REGISTERED'
         AND e.resource_type = 'DISCOVERY_EXECUTOR_TECHNICAL_IDENTITY'
         AND e.payload = '{}'::jsonb)
      FROM discovery.discovery_executors x WHERE x.id = '${createdExecutor.executorId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedExecutor).toBe("ACTIVE:1:1:1:1:1:1:1");

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
  await expect(page.getByRole("heading", { name: "Fuentes documentales" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Bandeja técnica" })).toBeVisible();
  const forbiddenAiOperations = await page.evaluate(async ({ api, sourceId }) => {
    const sessionResponse = await fetch(`${api}/api/v1/auth/me`, { credentials: "include" });
    const session = await sessionResponse.json() as { csrfToken: string };
    const body = new FormData();
    body.append("name", "Forbidden source");
    body.append("file", new Blob(["forbidden"], { type: "text/plain" }), "forbidden.txt");
    const [list, detail, create, index, retrieval, disable] = await Promise.all([
      fetch(`${api}/api/v1/ai/sources?page=0&size=20`, { credentials: "include" }),
      fetch(`${api}/api/v1/ai/sources/${sourceId}`, { credentials: "include" }),
      fetch(`${api}/api/v1/ai/sources`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": session.csrfToken },
        body,
      }),
      fetch(`${api}/api/v1/ai/sources/${sourceId}/index`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ expectedVersion: 2 }),
      }),
      fetch(`${api}/api/v1/ai/retrieval`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ query: "handbook" }),
      }),
      fetch(`${api}/api/v1/ai/sources/${sourceId}/disable`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
    ]);
    return {
      list: list.status, detail: detail.status, create: create.status, index: index.status,
      retrieval: retrieval.status, disable: disable.status,
    };
  }, { api: backendUrl!, sourceId: createdAiSource.sourceId });
  expect(forbiddenAiOperations).toEqual({
    list: 403, detail: 403, create: 403, index: 403, retrieval: 403, disable: 403,
  });
  await expect(page.getByRole("heading", { name: "Recuperación de evidencia" })).not.toBeVisible();
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
  await page.getByRole("region", { name: "Activos" }).getByLabel("Nombre", { exact: true }).fill(assetName);
  await page.getByLabel("Tipo").selectOption("LAPTOP");
  await page.getByRole("button", { name: "Registrar activo" }).click();
  expect((await createResponse).status()).toBe(201);

  const createdCard = page.getByRole("article", { name: "Resultado de creación" });
  await expect(createdCard.getByRole("heading", { name: assetName })).toBeVisible();
  await expect(createdCard.getByText("LAPTOP")).toBeVisible();
  const assetId = await page.getByLabel("UUID del activo").inputValue();
  expect(assetId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await expect(page.getByRole("article", { name: "Consulta por ID" })).toContainText(assetId);

  const inventoryBeforeIncorporation = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT md5(row_to_json(a)::text) || ':' ||
      (SELECT count(*) FROM inventory.outbox_events) FROM inventory.assets a WHERE a.id = '${assetId}'`,
  ], { encoding: "utf8" }).trim();
  await jobWorkspace.getByLabel("UUID del job").fill(createdJob.jobId);
  await jobWorkspace.getByRole("button", { name: "Consultar job" }).click();
  const incorporatedDeviceCard = jobWorkspace.getByRole("listitem")
    .filter({ hasText: "e2e-incorporated.example.internal" });
  await expect(incorporatedDeviceCard).toContainText("UNREVIEWED");
  await incorporatedDeviceCard.getByLabel("UUID del activo para e2e-incorporated.example.internal")
    .fill(assetId);
  page.once("dialog", (dialog) => dialog.accept());
  const incorporateDeviceResponse = page.waitForResponse((response) => (
    response.url().endsWith("/incorporate") && response.request().method() === "POST"
  ));
  await incorporatedDeviceCard.getByRole("button", {
    name: "Incorporar e2e-incorporated.example.internal",
    exact: true,
  }).click();
  const incorporatedResponse = await incorporateDeviceResponse;
  expect(incorporatedResponse.status()).toBe(200);
  const incorporatedDevice = await incorporatedResponse.json() as { discoveredDeviceId: string };
  await expect(incorporatedDeviceCard).toContainText("INCORPORATED");
  await expect(incorporatedDeviceCard).toContainText(assetId);
  await expect(incorporatedDeviceCard.getByRole("button", { name: /Incorporar/ })).toHaveCount(0);
  const persistedIncorporation = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT d.status || ':' || d.version || ':' || d.inventory_asset_id || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = d.discovered_device_id
         AND e.event_type = 'DISCOVERED_DEVICE_INCORPORATED'
         AND e.event_version = '1.0' AND e.producer_module = 'DISCOVERY'
         AND e.resource_type = 'DISCOVERED_DEVICE' AND e.resource_version = 1
         AND e.payload = jsonb_build_object('previousStatus', 'UNREVIEWED',
           'newStatus', 'INCORPORATED', 'assetId', '${assetId}'))
      FROM discovery.discovered_devices d WHERE d.discovered_device_id = '${incorporatedDevice.discoveredDeviceId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedIncorporation).toBe(`INCORPORATED:1:${assetId}:1`);
  const inventoryAfterIncorporation = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT md5(row_to_json(a)::text) || ':' ||
      (SELECT count(*) FROM inventory.outbox_events) FROM inventory.assets a WHERE a.id = '${assetId}'`,
  ], { encoding: "utf8" }).trim();
  expect(inventoryAfterIncorporation).toBe(inventoryBeforeIncorporation);

  const newAssetName = `E2E Discovered Asset ${Date.now()}`;
  const newAssetDeviceCard = jobWorkspace.getByRole("listitem")
    .filter({ hasText: "e2e-new-asset.example.internal" });
  await expect(newAssetDeviceCard).toContainText("UNREVIEWED");
  await newAssetDeviceCard.getByLabel("Nombre del activo para e2e-new-asset.example.internal")
    .fill(newAssetName);
  await newAssetDeviceCard.getByLabel("Tipo del activo para e2e-new-asset.example.internal")
    .selectOption("NETWORK_DEVICE");
  page.once("dialog", (dialog) => dialog.accept());
  const createAndIncorporateResponse = page.waitForResponse((response) => (
    response.url().endsWith("/incorporate-new-asset") && response.request().method() === "POST"
  ));
  await newAssetDeviceCard.getByRole("button", {
    name: "Crear activo e incorporar e2e-new-asset.example.internal",
  }).click();
  const createdAndIncorporatedResponse = await createAndIncorporateResponse;
  expect(createdAndIncorporatedResponse.status()).toBe(200);
  const createdAndIncorporatedDevice = await createdAndIncorporatedResponse.json() as {
    discoveredDeviceId: string;
    assetId: string;
  };
  expect(createdAndIncorporatedDevice.assetId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  await expect(newAssetDeviceCard).toContainText("INCORPORATED");
  await expect(newAssetDeviceCard).toContainText(createdAndIncorporatedDevice.assetId);
  await expect(newAssetDeviceCard.getByRole("button", { name: /Crear activo e incorporar/ }))
    .toHaveCount(0);

  const persistedNewAssetIncorporation = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT d.status || ':' || d.version || ':' || d.inventory_asset_id || ':' ||
      a.name || ':' || a.asset_type || ':' || a.status || ':' || a.version || ':' ||
      (SELECT count(*) FROM inventory.outbox_events e
       WHERE e.resource_id = a.id AND e.event_type = 'ASSET_CREATED'
         AND e.event_version = '1.0' AND e.producer_module = 'INVENTORY'
         AND e.resource_type = 'ASSET' AND e.resource_version = 0 AND e.payload = '{}'::jsonb) || ':' ||
      (SELECT count(*) FROM discovery.outbox_events e
       WHERE e.resource_id = d.discovered_device_id
         AND e.event_type = 'DISCOVERED_DEVICE_INCORPORATED'
         AND e.event_version = '1.0' AND e.producer_module = 'DISCOVERY'
         AND e.resource_type = 'DISCOVERED_DEVICE' AND e.resource_version = 1
         AND e.payload = jsonb_build_object('previousStatus', 'UNREVIEWED',
           'newStatus', 'INCORPORATED', 'assetId', a.id::text))
      FROM discovery.discovered_devices d
      JOIN inventory.assets a ON a.id = d.inventory_asset_id
      WHERE d.discovered_device_id = '${createdAndIncorporatedDevice.discoveredDeviceId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedNewAssetIncorporation).toBe(
    `INCORPORATED:1:${createdAndIncorporatedDevice.assetId}:${newAssetName}:NETWORK_DEVICE:ACTIVE:0:1:1`,
  );
  const countsBeforeRepeat = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT
      (SELECT count(*) FROM inventory.assets) || ':' ||
      (SELECT count(*) FROM inventory.outbox_events WHERE event_type = 'ASSET_CREATED') || ':' ||
      (SELECT count(*) FROM inventory.assets WHERE name = '${newAssetName}') || ':' ||
      (SELECT count(*) FROM discovery.outbox_events
       WHERE resource_id = '${createdAndIncorporatedDevice.discoveredDeviceId}'
         AND event_type = 'DISCOVERED_DEVICE_INCORPORATED')`,
  ], { encoding: "utf8" }).trim();

  const repeatedNewAssetIncorporation = await page.evaluate(async ({ api, jobId, deviceId, csrf, name }) => {
    const response = await fetch(
      `${api}/api/v1/discovery-jobs/${jobId}/discovered-devices/${deviceId}/incorporate-new-asset`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ name, assetType: "NETWORK_DEVICE", expectedVersion: 0 }),
      },
    );
    return response.status;
  }, {
    api: backendUrl!,
    jobId: createdJob.jobId,
    deviceId: createdAndIncorporatedDevice.discoveredDeviceId,
    csrf: createdAndIncorporatedResponse.request().headers()["x-csrf-token"],
    name: newAssetName,
  });
  expect(repeatedNewAssetIncorporation).toBe(409);
  const countsAfterRepeat = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT
      (SELECT count(*) FROM inventory.assets) || ':' ||
      (SELECT count(*) FROM inventory.outbox_events WHERE event_type = 'ASSET_CREATED') || ':' ||
      (SELECT count(*) FROM inventory.assets WHERE name = '${newAssetName}') || ':' ||
      (SELECT count(*) FROM discovery.outbox_events
       WHERE resource_id = '${createdAndIncorporatedDevice.discoveredDeviceId}'
         AND event_type = 'DISCOVERED_DEVICE_INCORPORATED')`,
  ], { encoding: "utf8" }).trim();
  expect(countsAfterRepeat).toBe(countsBeforeRepeat);

  await page.reload();
  await expect(page.getByRole("heading", { name: username! })).toBeVisible();
  const technicalEventsConnected = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/assets/${assetId}/technical-state/events`)
      && response.status() === 200
  ));
  await page.getByLabel("UUID del activo").fill(assetId);
  await page.getByRole("region", { name: "Activos" })
    .getByRole("button", { name: "Consultar" }).click();
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

  const priorityResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/${ticketId}/priority`)
      && response.request().method() === "PUT"
  ));
  await page.getByLabel("Prioridad", { exact: true }).selectOption("URGENT");
  expect((await priorityResponse).status()).toBe(200);
  await expect(technicianTicketCard).toContainText("URGENT");
  await expect(technicianTicketCard).toContainText("Versión2");

  const changeStatus = async (button: string, expectedStatus: string, expectedVersion: number) => {
    const statusResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/v1/tickets/${ticketId}/status`)
        && response.request().method() === "PUT"
    ));
    await page.getByRole("button", { name: button }).click();
    expect((await statusResponse).status()).toBe(200);
    await expect(technicianTicketCard).toContainText(expectedStatus);
    await expect(technicianTicketCard).toContainText(`Versión${expectedVersion}`);
  };
  await changeStatus("Iniciar atención", "IN_PROGRESS", 3);
  await changeStatus("Esperar respuesta del requester", "WAITING_FOR_REQUESTER", 4);
  await changeStatus("Reanudar atención", "IN_PROGRESS", 5);

  const technicianSession = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/api/v1/auth/me`, { credentials: "include" });
    return response.json();
  }, backendUrl!);
  const staleNoOp = await page.evaluate(async ({ api, id, csrf }) => {
    const response = await fetch(`${api}/api/v1/tickets/${id}/status`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ status: "IN_PROGRESS", expectedVersion: 4 }),
    });
    return { status: response.status, body: await response.json() };
  }, { api: backendUrl!, id: ticketId, csrf: technicianSession.csrfToken as string });
  expect(staleNoOp.status).toBe(409);
  expect(staleNoOp.body.code).toBe("TICKET_MUTATION_CONFLICT");

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
      (t.assignee_user_id = u.id)::text || ':' || t.version || ':' || t.status || ':' || t.priority || ':' ||
      (SELECT count(*) FROM support.outbox_events e
       WHERE e.event_type = 'TICKET_ASSIGNED' AND e.resource_id = t.id) || ':' ||
      (SELECT bool_and(e.actor_id = u.id AND e.resource_version = 1)
       FROM support.outbox_events e
       WHERE e.event_type = 'TICKET_ASSIGNED' AND e.resource_id = t.id) || ':' ||
      (SELECT bool_and(e.payload = jsonb_build_object('assigneeUserId', u.id::text))
       FROM support.outbox_events e
       WHERE e.event_type = 'TICKET_ASSIGNED' AND e.resource_id = t.id) || ':' ||
       (SELECT count(*) FROM support.outbox_events e
        WHERE e.event_type = 'TICKET_PRIORITY_CHANGED' AND e.resource_id = t.id) || ':' ||
       (SELECT count(*) FROM support.outbox_events e
        WHERE e.event_type = 'TICKET_STATUS_CHANGED' AND e.resource_id = t.id)
       FROM support.tickets t
      JOIN identity.human_users u ON u.normalized_username = '${supportUsername}'
      WHERE t.id = '${ticketId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedClaim).toBe("true:5:IN_PROGRESS:URGENT:1:true:true:1:3");

  const resolutionSummary = "E2E resolution: pickup roller replaced and print test completed.";
  const resolveResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/${ticketId}/resolve`)
      && response.request().method() === "POST"
  ));
  await page.getByLabel("Resumen de resolución").fill(resolutionSummary);
  await page.getByRole("button", { name: "Resolver", exact: true }).click();
  expect((await resolveResponse).status()).toBe(200);
  await expect(technicianTicketCard).toContainText("RESOLVED");
  await expect(technicianTicketCard).toContainText("Versión6");
  await expect(page.locator("section.lifecycle-timeline"))
    .toContainText(resolutionSummary);

  const closeResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/${ticketId}/close`)
      && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  expect((await closeResponse).status()).toBe(200);
  await expect(technicianTicketCard).toContainText("CLOSED");
  await expect(technicianTicketCard).toContainText("Versión7");
  await expect(page.getByText("El ticket está cerrado. Reábrelo para continuar la conversación.")).toBeVisible();
  await expect(page.getByLabel("Comentario técnico")).not.toBeVisible();

  const persistedTerminalLifecycle = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT t.status || ':' || t.version || ':' ||
      (t.assignee_user_id = u.id)::text || ':' ||
      (SELECT string_agg(l.event_type || ':' || l.from_status || '>' || l.to_status || ':' ||
          coalesce(l.close_reason, '-') || ':' || coalesce(l.resolution_summary, '-'),
          '|' ORDER BY l.resource_version)
       FROM support.ticket_lifecycle_events l WHERE l.ticket_id = t.id) || ':' ||
      (SELECT bool_and(
          e.payload = jsonb_build_object(
            'lifecycleEventId', l.id::text,
            'fromStatus', l.from_status,
            'toStatus', l.to_status
          )
          AND NOT e.payload ? 'resolutionSummary' AND NOT e.payload ? 'reopenReason')
       FROM support.ticket_lifecycle_events l
       JOIN support.outbox_events e ON e.resource_id = l.ticket_id
         AND e.resource_version = l.resource_version
       WHERE l.ticket_id = t.id AND l.event_type = 'RESOLVED') || ':' ||
      (SELECT bool_and(
          e.payload = jsonb_build_object(
            'lifecycleEventId', l.id::text,
            'fromStatus', l.from_status,
            'toStatus', l.to_status,
            'closeReason', l.close_reason
          )
          AND NOT e.payload ? 'resolutionSummary' AND NOT e.payload ? 'reopenReason')
       FROM support.ticket_lifecycle_events l
       JOIN support.outbox_events e ON e.resource_id = l.ticket_id
         AND e.resource_version = l.resource_version
       WHERE l.ticket_id = t.id AND l.event_type = 'CLOSED')
      FROM support.tickets t
      JOIN identity.human_users u ON u.normalized_username = '${supportUsername}'
      WHERE t.id = '${ticketId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedTerminalLifecycle).toBe(
    `CLOSED:7:true:RESOLVED:IN_PROGRESS>RESOLVED:-:${resolutionSummary}|CLOSED:RESOLVED>CLOSED:RESOLVED:-:true:true`,
  );

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
  const requesterLifecycleResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/v1/tickets/${ticketId}/lifecycle?`)
      && response.request().method() === "GET"
  ));
  await page.getByRole("button", { name: new RegExp(ticketSummary) }).click();
  const requesterConversation = await (await requesterConversationResponse).json() as {
    items: Array<{ visibility: string; body: string }>;
  };
  expect((await requesterLifecycleResponse).status()).toBe(200);
  expect(requesterConversation.items.map((item) => item.body)).toContain(technicianPublicComment);
  expect(requesterConversation.items.map((item) => item.body)).not.toContain(internalNote);
  expect(requesterConversation.items.every((item) => item.visibility === "PUBLIC")).toBe(true);
  await expect(page.getByText(technicianPublicComment)).toBeVisible();
  await expect(page.getByText(internalNote)).not.toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain(internalNote);
  await expect(page.getByRole("article", { name: "Consulta del ticket por ID" })).toContainText("CLOSED");
  await expect(page.locator("section.lifecycle-timeline"))
    .toContainText(resolutionSummary);
  await expect(page.getByLabel("Añadir comentario público")).not.toBeVisible();

  const reopenReason = "E2E reopen: printing defect reproduced after requester validation.";
  const reopenResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/tickets/${ticketId}/reopen`)
      && response.request().method() === "POST"
  ));
  await page.getByLabel("Motivo de reapertura").fill(reopenReason);
  await page.getByRole("button", { name: "Reabrir ticket" }).click();
  expect((await reopenResponse).status()).toBe(200);
  await expect(page.getByRole("article", { name: "Consulta del ticket por ID" })).toContainText("OPEN");
  await expect(page.locator("section.lifecycle-timeline"))
    .toContainText(reopenReason);
  await expect(page.getByLabel("Añadir comentario público")).toBeVisible();

  const persistedReopen = execFileSync("docker", [
    "exec", databaseContainer!, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--username", "jaxon_e2e", "--dbname", "jaxon_e2e",
    "--command", `SELECT t.status || ':' || t.version || ':' ||
      (t.assignee_user_id = technician.id)::text || ':' ||
      l.event_type || ':' || l.from_status || '>' || l.to_status || ':' || l.reopen_reason || ':' ||
      (e.actor_id = t.requester_user_id)::text || ':' ||
      (e.payload = jsonb_build_object(
        'lifecycleEventId', l.id::text,
        'fromStatus', l.from_status,
        'toStatus', l.to_status
      ))::text || ':' ||
      (NOT e.payload ? 'resolutionSummary' AND NOT e.payload ? 'reopenReason')::text
      FROM support.tickets t
      JOIN identity.human_users technician ON technician.normalized_username = '${supportUsername}'
      JOIN support.ticket_lifecycle_events l ON l.ticket_id = t.id AND l.event_type = 'REOPENED'
      JOIN support.outbox_events e ON e.resource_id = t.id
        AND e.resource_version = l.resource_version AND e.event_type = 'TICKET_REOPENED'
      WHERE t.id = '${ticketId}'`,
  ], { encoding: "utf8" }).trim();
  expect(persistedReopen).toBe(`OPEN:8:true:REOPENED:CLOSED>OPEN:${reopenReason}:true:true:true`);

  const requesterSession = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/api/v1/auth/me`, { credentials: "include" });
    return response.json();
  }, backendUrl!);
  const forbiddenTriage = await page.evaluate(async ({ api, id, csrf }) => {
    const response = await fetch(`${api}/api/v1/tickets/${id}/priority`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ priority: "LOW", expectedVersion: 8 }),
    });
    return { status: response.status, body: await response.json() };
  }, { api: backendUrl!, id: ticketId, csrf: requesterSession.csrfToken as string });
  expect(forbiddenTriage.status).toBe(403);
  expect(forbiddenTriage.body.code).toBe("ACCESS_DENIED");

  await page.getByLabel("UUID del activo").fill(assetId);
  await page.getByRole("region", { name: "Activos" })
    .getByRole("button", { name: "Consultar", exact: true }).click();
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
  await page.getByRole("region", { name: "Activos" })
    .getByRole("button", { name: "Consultar" }).click();
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
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(auditorUsername);
  await page.getByLabel("Contraseña").fill(auditorPassword);
  const initialAuditResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/v1/audit/events" && response.request().method() === "GET"
  ));
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { name: auditorUsername })).toBeVisible();
  expect((await initialAuditResponse).status()).toBe(200);
  const auditWorkspace = page.getByRole("region", { name: "Auditoría" });
  await expect(auditWorkspace).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fuentes documentales" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Usuarios humanos" })).not.toBeVisible();
  await auditWorkspace.getByLabel("Correlation ID").fill(disabledCorrelationId);
  await auditWorkspace.getByLabel("Recurso ID").fill(createdAiSource.sourceId);
  await auditWorkspace.getByLabel("Módulo").selectOption("AI");
  const filteredAuditResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/v1/audit/events" && response.request().method() === "GET"
  ));
  await auditWorkspace.getByRole("button", { name: "Consultar auditoría" }).click();
  const filteredAudit = await filteredAuditResponse;
  expect(new URL(filteredAudit.url()).search).toBe(
    `?module=AI&resourceId=${createdAiSource.sourceId}&correlationId=${disabledCorrelationId}&page=0&size=50`,
  );
  const auditPage = await filteredAudit.json() as {
    totalElements: number;
    items: Array<Record<string, unknown>>;
  };
  expect(auditPage.totalElements).toBe(1);
  expect(auditPage.items[0]).toMatchObject({
    sourceEventId: disabledEventId,
    eventType: "AI_SOURCE_DISABLED",
    producerModule: "AI",
    actorType: "HUMAN_USER",
    actorId: disabledActorId,
    resourceType: "AI_SOURCE",
    resourceId: createdAiSource.sourceId,
    resourceVersion: 3,
    result: "SUCCESS",
    correlationId: disabledCorrelationId,
    metadata: { previousStatus: "READY", newStatus: "DISABLED" },
  });
  expect(JSON.stringify(auditPage)).not.toContain(aiName);
  expect(JSON.stringify(auditPage)).not.toContain(aiStorageKey);
  const auditCard = auditWorkspace.getByRole("article", { name: /Evento AI_SOURCE_DISABLED/ });
  await expect(auditCard).toContainText(createdAiSource.sourceId);
  await expect(auditCard).toContainText(disabledCorrelationId);
  await expect(auditCard).toContainText("READY");
  const auditorForbidden = await page.evaluate(async ({ api }) => (
    await fetch(`${api}/api/v1/ai/sources?page=0&size=20`, { credentials: "include" })
  ).status, { api: backendUrl! });
  expect(auditorForbidden).toBe(403);

  await page.context().clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/login");
  await page.getByLabel("Usuario").fill("unknown-user");
  await page.getByLabel("Contraseña").fill("invalid-passphrase");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.locator("#login-error")).toContainText("No fue posible iniciar sesión");
});
