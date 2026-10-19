import type { Session } from "@/features/auth/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentEnrollment } from "./agent-enrollment";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Agent.Operator",
  roles: ["IT_OPERATOR"],
  csrfToken: "sensitive-session-value-kept-in-memory",
  expiresAt: "2026-10-11T23:00:00Z",
};
const assetId = "8b90cfac-9304-4a11-9422-7c834431f920";
const agentId = "07f234fd-21fe-4f86-bb1c-bfb34aeb189d";
const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKg2VaOybk2P/sGQKcJkL7QWqLpzaxLfOjfPCsqSy5aL";
const pendingAgent = {
  agentId,
  assetId,
  status: "PENDING",
  operationalStatus: "UNKNOWN",
  lastSeenAt: null,
  lastSnapshotAt: null,
  publicKeyRegistered: false,
  publicKeyFingerprint: null,
  createdAt: "2026-10-11T20:00:00Z",
  updatedAt: "2026-10-11T20:00:00Z",
  version: 0,
};
const registeredAgent = {
  ...pendingAgent,
  publicKeyRegistered: true,
  publicKeyFingerprint: "SHA256:vi4Mo/pzHrbpqbCCSjJz4KjU8NjWTGGjHSXfTYzA9aE",
  updatedAt: "2026-10-11T20:05:00Z",
};
const activeAgent = { ...registeredAgent, status: "ACTIVE", version: 1 };
const onlineAgent = {
  ...activeAgent,
  operationalStatus: "ONLINE",
  lastSeenAt: "2026-10-18T12:00:00Z",
  lastSnapshotAt: "2026-10-18T11:59:57Z",
};
const taskId = "d9bdb20c-9b56-4b91-8c4a-a83f64d5802a";
const dispatchedTask = {
  taskId,
  agentId,
  taskType: "COLLECT_SNAPSHOT",
  status: "DISPATCHED",
  createdAt: "2026-10-18T12:00:00Z",
  expiresAt: "2026-10-18T12:15:00Z",
  dispatchedAt: "2026-10-18T12:00:00Z",
  completedAt: null,
  error: null,
};
const succeededTask = {
  ...dispatchedTask,
  status: "SUCCEEDED",
  completedAt: "2026-10-18T12:00:07Z",
};
const connection = {
  host: "sftp.example.internal",
  port: 2022,
  username: `agent-${agentId}`,
  publicHostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPinnedServerKey",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderEnrollment(currentSession = session) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AgentEnrollment assetId={assetId} session={currentSession} />
    </QueryClientProvider>,
  );
  return client;
}

describe("AgentEnrollment", () => {
  it("pre-registers, presents instructions, registers only the public key, and confirms the fingerprint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(pendingAgent, 201))
      .mockResolvedValueOnce(jsonResponse(pendingAgent))
      .mockResolvedValueOnce(jsonResponse(registeredAgent));
    vi.stubGlobal("fetch", fetchMock);
    renderEnrollment();

    fireEvent.click(screen.getByRole("button", { name: "Pre-registrar Agent" }));
    expect(await screen.findByText(new RegExp(`jaxon-agent initialize --agent-id ${agentId}`))).toBeDefined();
    const initialCard = await screen.findByRole("article", { name: "Estado del Agent" });
    expect(within(initialCard).getByText("PENDING")).toBeDefined();
    expect(within(initialCard).getAllByText("Sin contacto").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Clave pública OpenSSH Ed25519"), {
      target: { value: `${publicKey} local-comment` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar clave pública" }));

    expect(await screen.findByText(registeredAgent.publicKeyFingerprint)).toBeDefined();
    expect(screen.getByText("PENDING")).toBeDefined();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": session.csrfToken },
      body: JSON.stringify({ assetId }),
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "PUT",
      credentials: "include",
      headers: { "X-CSRF-Token": session.csrfToken },
      body: JSON.stringify({ publicKey: `${publicKey} local-comment` }),
    });
    expect(document.body.textContent).not.toContain("OPENSSH PRIVATE KEY");
    expect(screen.queryByLabelText(/clave privada/i)).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("validates Agent UUID and key format before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderEnrollment();

    fireEvent.change(screen.getByLabelText("UUID del Agent"), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar Agent" }));
    expect(screen.getByRole("alert").textContent).toContain("UUIDv4");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("activates only a pending Agent with a key and keeps connection data in memory", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(pendingAgent, 201))
      .mockResolvedValueOnce(jsonResponse(pendingAgent))
      .mockResolvedValueOnce(jsonResponse(registeredAgent))
      .mockResolvedValueOnce(jsonResponse(connection))
      .mockResolvedValueOnce(jsonResponse(activeAgent));
    vi.stubGlobal("fetch", fetchMock);
    renderEnrollment();

    fireEvent.click(screen.getByRole("button", { name: "Pre-registrar Agent" }));
    expect(screen.queryByRole("button", { name: "Activar Agent" })).toBeNull();
    fireEvent.change(await screen.findByLabelText("Clave pública OpenSSH Ed25519"), {
      target: { value: publicKey },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar clave pública" }));
    fireEvent.click(await screen.findByRole("button", { name: "Activar Agent" }));

    const result = await screen.findByRole("article", { name: "Conexión SFTP del Agent" });
    expect(within(result).getByText(connection.host)).toBeDefined();
    expect(within(result).getByText(connection.publicHostKey)).toBeDefined();
    expect(screen.getByText("ACTIVE")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Activar Agent" })).toBeNull();
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": session.csrfToken },
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.body.textContent).not.toContain(session.csrfToken);
  });

  it("does not retain a previous Agent card after a failed lookup", async () => {
    const missingAgentId = "2a27e32c-346b-4380-bb5b-9a8d2274974b";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(pendingAgent, 201))
      .mockResolvedValueOnce(jsonResponse(pendingAgent))
      .mockResolvedValueOnce(jsonResponse({ code: "AGENT_NOT_FOUND" }, 404, "application/problem+json"));
    vi.stubGlobal("fetch", fetchMock);
    renderEnrollment();

    fireEvent.click(screen.getByRole("button", { name: "Pre-registrar Agent" }));
    expect(await screen.findByRole("article", { name: "Estado del Agent" })).toBeDefined();
    fireEvent.change(screen.getByLabelText("UUID del Agent"), {
      target: { value: missingAgentId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Consultar Agent" }));

    expect((await screen.findByRole("alert")).textContent).toContain("No existe");
    expect(screen.queryByRole("article", { name: "Estado del Agent" })).toBeNull();
  });

  it("shows administrative and operational state with explicit UTC evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(onlineAgent)));
    renderEnrollment();

    fireEvent.change(screen.getByLabelText("UUID del Agent"), { target: { value: agentId } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar Agent" }));

    const card = await screen.findByRole("article", { name: "Estado del Agent" });
    expect(within(card).getByText("ACTIVE")).toBeDefined();
    expect(within(card).getAllByText("En línea").length).toBeGreaterThan(0);
    expect(within(card).getByText("2026-10-18 12:00:00Z UTC")).toBeDefined();
    expect(within(card).getByText("2026-10-18 11:59:57Z UTC")).toBeDefined();
  });

  it("rejects incomplete Agent responses instead of presenting a false state", async () => {
    const incomplete = Object.fromEntries(
      Object.entries(onlineAgent).filter(([key]) => key !== "operationalStatus"),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(incomplete)));
    renderEnrollment();

    fireEvent.change(screen.getByLabelText("UUID del Agent"), { target: { value: agentId } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar Agent" }));

    expect((await screen.findByRole("alert")).textContent).toContain("no está disponible");
    expect(screen.queryByRole("article", { name: "Estado del Agent" })).toBeNull();
  });

  it("segments Agent cache entries by authenticated user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(onlineAgent));
    vi.stubGlobal("fetch", fetchMock);
    const client = renderEnrollment();

    fireEvent.change(screen.getByLabelText("UUID del Agent"), { target: { value: agentId } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar Agent" }));
    await screen.findByRole("article", { name: "Estado del Agent" });

    expect(client.getQueryData(["users", session.userId, "agents", "agent", agentId]))
      .toEqual(onlineAgent);
    expect(client.getQueryData(["users", "another-user", "agents", "agent", agentId]))
      .toBeUndefined();
  });

  it("creates and explicitly refreshes one COLLECT_SNAPSHOT task with user-scoped cache", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(activeAgent))
      .mockResolvedValueOnce(jsonResponse(dispatchedTask, 201))
      .mockResolvedValueOnce(jsonResponse(succeededTask));
    vi.stubGlobal("fetch", fetchMock);
    const client = renderEnrollment();

    fireEvent.change(screen.getByLabelText("UUID del Agent"), { target: { value: agentId } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar Agent" }));
    await screen.findByRole("article", { name: "Estado del Agent" });
    fireEvent.click(screen.getByRole("button", { name: "Solicitar snapshot" }));

    const taskCard = await screen.findByRole("article", { name: "Estado de la tarea Agent" });
    expect(within(taskCard).getByText("DISPATCHED")).toBeDefined();
    expect(within(taskCard).getByText(taskId)).toBeDefined();
    expect((screen.getByRole("button", { name: "Solicitar snapshot" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": session.csrfToken },
      body: JSON.stringify({ taskType: "COLLECT_SNAPSHOT" }),
    });
    expect(client.getQueryData([
      "users", session.userId, "agents", "agent", agentId, "tasks", taskId,
    ])).toEqual(dispatchedTask);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar tarea" }));
    expect(await within(taskCard).findByText("SUCCEEDED")).toBeDefined();
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ credentials: "include" });
    expect(fetchMock.mock.calls[2]?.[0]).toContain(`/agents/${agentId}/tasks/${taskId}`);
    expect((screen.getByRole("button", { name: "Solicitar snapshot" }) as HTMLButtonElement).disabled)
      .toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("rejects an invalid task response instead of presenting a false terminal state", async () => {
    const invalid = { ...dispatchedTask, status: "SUCCEEDED", completedAt: null };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(activeAgent))
      .mockResolvedValueOnce(jsonResponse(invalid, 201)));
    renderEnrollment();

    fireEvent.change(screen.getByLabelText("UUID del Agent"), { target: { value: agentId } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar Agent" }));
    await screen.findByRole("article", { name: "Estado del Agent" });
    fireEvent.click(screen.getByRole("button", { name: "Solicitar snapshot" }));

    expect((await screen.findByRole("alert")).textContent).toContain("no está disponible");
    expect(screen.queryByRole("article", { name: "Estado de la tarea Agent" })).toBeNull();
  });

  it("presents an active-task conflict without losing the Agent state", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(activeAgent))
      .mockResolvedValueOnce(jsonResponse({
        code: "AGENT_TASK_CONFLICT",
        correlationId: session.userId,
      }, 409, "application/problem+json")));
    renderEnrollment();

    fireEvent.change(screen.getByLabelText("UUID del Agent"), { target: { value: agentId } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar Agent" }));
    const agentCard = await screen.findByRole("article", { name: "Estado del Agent" });
    fireEvent.click(screen.getByRole("button", { name: "Solicitar snapshot" }));

    expect((await screen.findByRole("alert")).textContent).toContain("tarea activa");
    expect(within(agentCard).getByText("ACTIVE")).toBeDefined();
  });

  it.each([
    [403, "no autoriza"],
    [409, "otro Agent"],
    [422, "Revisa"],
    [503, "no está disponible"],
  ])("presents safe API errors for status %s", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      code: "SAFE_ERROR",
      correlationId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
    }, status, "application/problem+json")));
    renderEnrollment();

    fireEvent.click(screen.getByRole("button", { name: "Pre-registrar Agent" }));

    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });
});

function jsonResponse(body: unknown, status = 200, contentType = "application/json") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}
