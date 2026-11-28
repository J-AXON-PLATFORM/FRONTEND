import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("HomePage", () => {
  it("shows the recovered identity and explicit roles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
      username: "Bootstrap.Admin",
      roles: ["IT_OPERATOR", "SYSTEM_ADMIN"],
      csrfToken: "sensitive-session-value-kept-in-memory",
      expiresAt: "2026-10-11T00:00:00Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Bootstrap.Admin" })).toBeDefined();
    expect(screen.getByText("IT OPERATOR")).toBeDefined();
    expect(screen.getByText("SYSTEM ADMIN")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Notificaciones" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Discovery Executors" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Discovery Jobs" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Fuentes documentales" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Recuperación de evidencia" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Reportes" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Assets" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Agents" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Tickets" })).toBeNull();
  });

  it("clears cached state and redirects when the session is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "AUTHENTICATION_REQUIRED",
      correlationId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
    }), { status: 401, headers: { "Content-Type": "application/problem+json" } })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["sensitive", "example"], "must-be-cleared");

    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(queryClient.getQueryData(["sensitive", "example"])).toBeUndefined();
  });

  it("does not expose administration, inventory, agents, or requester support to support-only sessions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/auth/me")) {
        return new Response(JSON.stringify({
          userId: "34844482-1d29-4d30-87fd-1bb67a22e050",
          username: "Support.Only",
          roles: ["SUPPORT_TECHNICIAN"],
          csrfToken: "sensitive-session-value-kept-in-memory",
          expiresAt: "2026-10-21T00:00:00Z",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        items: [], page: 0, size: 20, totalElements: 0, totalPages: 0,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Support.Only" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Notificaciones" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Usuarios humanos" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Activos" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Tickets" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Discovery Jobs" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Fuentes documentales" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recuperación de evidencia" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Bandeja técnica" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Reportes" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tickets" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Assets" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeDefined();
  });

  it("shows Discovery Jobs but not executor administration to operator-only sessions", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/auth/me")) {
        return new Response(JSON.stringify({
          userId: "34844482-1d29-4d30-87fd-1bb67a22e050",
          username: "Inventory.Operator",
          roles: ["IT_OPERATOR"],
          csrfToken: "sensitive-session-value-kept-in-memory",
          expiresAt: "2026-10-25T00:00:00Z",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        items: [], page: 0, size: 20, totalElements: 0, totalPages: 0,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Inventory.Operator" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Ámbitos autorizados" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Discovery Executors" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Fuentes documentales" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recuperación de evidencia" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Discovery Jobs" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Reportes" })).toBeDefined();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/discovery/executors"))).toBe(true);
  });
});
