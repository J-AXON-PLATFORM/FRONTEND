import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/features/auth/api";
import { AssetWorkspace } from "./asset-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Inventory.Operator",
  roles: ["IT_OPERATOR"],
  csrfToken: "sensitive-session-value-kept-in-memory",
  expiresAt: "2026-10-11T23:00:00Z",
};

const asset = {
  assetId: "0b2b7ee9-017e-4d62-83e0-87056735e71e",
  name: "Workstation 042",
  assetType: "DESKTOP",
  status: "ACTIVE",
  createdAt: "2026-10-11T18:00:00Z",
  updatedAt: "2026-10-11T18:00:00Z",
  version: 0,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderWorkspace(currentSession = session) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AssetWorkspace session={currentSession} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("AssetWorkspace", () => {
  it("creates an asset with in-memory CSRF and re-queries its official record", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(asset), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(asset), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Workstation 042" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    const created = await screen.findByRole("article", { name: "Resultado de creación" });
    expect(within(created).getByRole("heading", { name: "Workstation 042" })).toBeDefined();
    const queried = await screen.findByRole("article", { name: "Consulta por ID" });
    expect(within(queried).getByText(asset.assetId)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/assets");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/v1/assets/${asset.assetId}`);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("shows the explicit permission boundary without exposing operations", () => {
    renderWorkspace({ ...session, roles: ["SYSTEM_ADMIN"] });

    expect(screen.getByRole("heading", { name: "Sin permiso de operación" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Registrar activo" })).toBeNull();
  });

  it("announces authorization failures safely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "ACCESS_DENIED",
      correlationId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
    }), { status: 403, headers: { "Content-Type": "application/problem+json" } })));
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Workstation 042" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    expect((await screen.findByRole("alert")).textContent).toContain("no autoriza");
  });

  it("validates lookup identifiers before making a request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("UUID del activo"), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));

    expect(screen.getByRole("alert").textContent).toContain("UUIDv4 válido");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
