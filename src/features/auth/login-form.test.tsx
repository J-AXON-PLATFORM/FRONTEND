import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LoginForm />
    </QueryClientProvider>,
  );
}

describe("LoginForm", () => {
  it("labels fields and keeps a successful session only in memory", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
      username: "Bootstrap.Admin",
      roles: ["IT_OPERATOR", "SYSTEM_ADMIN"],
      csrfToken: "sensitive-session-value-kept-in-memory",
      expiresAt: "2026-10-11T00:00:00Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderForm();

    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "Bootstrap.Admin" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "valid passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(storageWrite).not.toHaveBeenCalled();
    storageWrite.mockRestore();
  });

  it("announces rate limiting without exposing server details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "RATE_LIMIT_EXCEEDED",
      correlationId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
    }), { status: 429, headers: { "Content-Type": "application/problem+json" } })));
    renderForm();

    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "someone" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "wrong passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Demasiados intentos");
  });

  it("distinguishes service failures from invalid credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "SERVICE_UNAVAILABLE",
      correlationId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
    }), { status: 503, headers: { "Content-Type": "application/problem+json" } })));
    renderForm();

    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "someone" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "valid passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect((await screen.findByRole("alert")).textContent).toContain("servicio no está disponible");
  });
});
