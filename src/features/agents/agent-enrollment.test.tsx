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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderEnrollment() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AgentEnrollment assetId={assetId} session={session} />
    </QueryClientProvider>,
  );
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
