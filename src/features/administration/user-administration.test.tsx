import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/features/auth/api";
import { UserAdministration } from "./user-administration";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Bootstrap.Admin",
  roles: ["SYSTEM_ADMIN"],
  csrfToken: "csrf-token",
  expiresAt: "2026-10-21T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("UserAdministration", () => {
  it("requires an explicit role selection", () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "support.user" } });
    fireEvent.change(screen.getByLabelText("Contraseña inicial"), { target: { value: "Long test passphrase 42!" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(screen.getByRole("alert").textContent).toContain("Selecciona al menos un rol");
  });

  it("creates a user with selected roles and clears the password", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      userId: "34844482-1d29-4d30-87fd-1bb67a22e050",
      username: "support.user",
      status: "ACTIVE",
      roles: ["SUPPORT_TECHNICIAN"],
      createdAt: "2026-10-20T12:00:00Z",
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "support.user" } });
    const password = screen.getByLabelText("Contraseña inicial") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "Long test passphrase 42!" } });
    fireEvent.click(screen.getByLabelText(/Atención técnica/));
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect((await screen.findByRole("article", { name: "Usuario creado" })).textContent).toContain("support.user");
    expect(password.value).toBe("");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      body: JSON.stringify({
        username: "support.user",
        password: "Long test passphrase 42!",
        roles: ["SUPPORT_TECHNICIAN"],
      }),
    }));
  });
});

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UserAdministration session={session} />
    </QueryClientProvider>,
  );
}
