import type { Session } from "@/features/auth/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorizedScopeWorkspace } from "./authorized-scope-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const administrator: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Bootstrap.Admin",
  roles: ["SYSTEM_ADMIN", "IT_OPERATOR"],
  csrfToken: "csrf-token",
  expiresAt: "2026-10-24T00:00:00Z",
};
const scope = {
  scopeId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  name: "Office network",
  cidr: "192.0.2.0/24",
  status: "ACTIVE",
  createdByUserId: administrator.userId,
  createdAt: "2026-10-23T12:00:00Z",
  updatedAt: "2026-10-23T12:00:00Z",
  version: 0,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AuthorizedScopeWorkspace", () => {
  it("shows operators a read-only active-scope list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      items: [scope], page: 0, size: 20, totalElements: 1, totalPages: 1,
    })));

    renderWorkspace({ ...administrator, roles: ["IT_OPERATOR"] });

    expect(await screen.findByText("Office network")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Crear ámbito" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deshabilitar" })).toBeNull();
  });

  it("preserves administrative form values when creation fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }))
      .mockResolvedValueOnce(json({ code: "VALIDATION_FAILED", correlationId: crypto.randomUUID() }, 422, "application/problem+json"));
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace(administrator);
    await screen.findByText("No hay ámbitos visibles.");

    const name = screen.getByLabelText("Nombre del ámbito") as HTMLInputElement;
    const cidr = screen.getByLabelText("Red CIDR canónica") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Branch network" } });
    fireEvent.change(cidr, { target: { value: "192.0.2.1/24" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear ámbito" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Revisa el nombre");
    expect(name.value).toBe("Branch network");
    expect(cidr.value).toBe("192.0.2.1/24");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/discovery/scopes", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
    }));
  });
});

function renderWorkspace(session: Session) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthorizedScopeWorkspace session={session} />
    </QueryClientProvider>,
  );
}

function json(body: unknown, status = 200, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": contentType } });
}
