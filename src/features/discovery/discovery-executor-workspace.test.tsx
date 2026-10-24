import type { Session } from "@/features/auth/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryExecutorWorkspace } from "./discovery-executor-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const administrator: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Bootstrap.Admin",
  roles: ["SYSTEM_ADMIN"],
  csrfToken: "csrf-token",
  expiresAt: "2026-10-25T00:00:00Z",
};
const scope = {
  scopeId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  name: "Office network",
  cidr: "192.0.2.0/24",
  status: "ACTIVE",
  createdByUserId: administrator.userId,
  createdAt: "2026-10-24T12:00:00Z",
  updatedAt: "2026-10-24T12:00:00Z",
  version: 0,
};
const executor = {
  executorId: "95e086af-07d1-49b9-b570-2b9b52878770",
  name: "Office executor",
  scopeIds: [scope.scopeId],
  status: "PENDING",
  publicKeyRegistered: false,
  publicKeyFingerprint: null,
  createdByUserId: administrator.userId,
  createdAt: "2026-10-24T13:00:00Z",
  updatedAt: "2026-10-24T13:00:00Z",
  version: 0,
};
const secondExecutor = {
  ...executor,
  executorId: "57d47a94-f4e7-413e-9a9e-85fa205756b6",
  name: "Branch executor",
};
const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKg2VaOybk2P/sGQKcJkL7QWqLpzaxLfOjfPCsqSy5aL";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("DiscoveryExecutorWorkspace", () => {
  it("pre-registers an executor and registers only its public key", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/discovery/scopes")) {
        return json({ items: [scope], page: 0, size: 50, totalElements: 1, totalPages: 1 });
      }
      if (url.endsWith("/discovery/executors") && init?.method === "POST") return json(executor, 201);
      if (url.endsWith(`/discovery/executors/${executor.executorId}/ssh-key`) && init?.method === "PUT") {
        return json({
          ...executor,
          publicKeyRegistered: true,
          publicKeyFingerprint: "SHA256:vi4Mo/pzHrbpqbCCSjJz4KjU8NjWTGGjHSXfTYzA9aE",
          updatedAt: "2026-10-24T13:10:00Z",
        });
      }
      if (url.includes("/discovery/executors?page=")) {
        return json({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    const scopeOption = await screen.findByRole("checkbox", { name: /Office network/ });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Office executor" } });
    fireEvent.click(scopeOption);
    fireEvent.click(screen.getByRole("button", { name: "Pre-registrar executor" }));

    expect(await screen.findByText(/jaxon-discovery-executor initialize/)).toBeTruthy();
    const keyInput = screen.getByLabelText("Clave pública Ed25519") as HTMLTextAreaElement;
    fireEvent.change(keyInput, { target: { value: publicKey } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar clave pública" }));

    expect(await screen.findByText("SHA256:vi4Mo/pzHrbpqbCCSjJz4KjU8NjWTGGjHSXfTYzA9aE")).toBeTruthy();
    expect(screen.queryByLabelText("Clave pública Ed25519")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/discovery/executors", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      body: JSON.stringify({ name: "Office executor", scopeIds: [scope.scopeId] }),
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/discovery/executors/${executor.executorId}/ssh-key`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ publicKey }),
      }),
    );
  });

  it("requires a scope locally and fetches detail when a listed executor is selected", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/discovery/scopes")) {
        return json({ items: [scope], page: 0, size: 50, totalElements: 1, totalPages: 1 });
      }
      if (url.includes("/discovery/executors?page=")) {
        return json({ items: [executor, secondExecutor], page: 0, size: 20, totalElements: 2, totalPages: 1 });
      }
      if (url.endsWith(`/discovery/executors/${executor.executorId}`)) return json(executor);
      if (url.endsWith(`/discovery/executors/${secondExecutor.executorId}`)) return json(secondExecutor);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Preserved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Pre-registrar executor" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Selecciona al menos un ámbito activo.");
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Preserved name");

    fireEvent.click(screen.getByRole("button", { name: /Office executor/ }));
    expect(await screen.findByText(/jaxon-discovery-executor initialize/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Clave pública Ed25519"), { target: { value: publicKey } });
    fireEvent.click(screen.getByRole("button", { name: /Branch executor/ }));
    await screen.findByRole("heading", { name: "Branch executor" });
    expect((screen.getByLabelText("Clave pública Ed25519") as HTMLTextAreaElement).value).toBe("");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/discovery/executors/${executor.executorId}`,
      { credentials: "include" },
    );
  });

  it("removes a selected scope when it is no longer active", async () => {
    let postRequested = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      postRequested ||= init?.method === "POST";
      const url = String(input);
      if (url.includes("/discovery/scopes")) {
        return json({ items: [scope], page: 0, size: 50, totalElements: 1, totalPages: 1 });
      }
      if (url.includes("/discovery/executors?page=")) {
        return json({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderWorkspace();

    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Safe executor" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Office network/ }));
    queryClient.setQueryData(
      ["discovery", "executor-scope-options", administrator.userId, "SYSTEM_ADMIN"],
      [
        { ...scope, status: "DISABLED" },
        {
          ...scope,
          scopeId: "82da9336-373e-4f51-8e51-e2e68fb7c716",
          name: "Branch network",
          cidr: "198.51.100.0/24",
        },
      ],
    );
    await vi.waitFor(() => expect(screen.queryByRole("checkbox", { name: /Office network/ })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Pre-registrar executor" }));

    expect((await screen.findByRole("alert")).textContent).toContain("La selección cambió");
    expect(postRequested).toBe(false);
  });
});

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DiscoveryExecutorWorkspace session={administrator} />
    </QueryClientProvider>,
  );
  return queryClient;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
