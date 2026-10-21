import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "./logout-button";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("LogoutButton", () => {
  it("clears all query state and redirects only after a 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderButton();
    queryClient.setQueryData(["sensitive"], "value");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(queryClient.getQueryData(["sensitive"])).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/logout", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": "csrf-token" },
    }));
  });

  it("keeps local state and does not redirect when logout fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "SERVICE_UNAVAILABLE",
      correlationId: "34844482-1d29-4d30-87fd-1bb67a22e050",
    }), { status: 503, headers: { "Content-Type": "application/problem+json" } })));
    const queryClient = renderButton();
    queryClient.setQueryData(["sensitive"], "value");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect((await screen.findByRole("alert")).textContent).toContain("cierre incompleto");
    expect(queryClient.getQueryData(["sensitive"])).toBe("value");
    expect(replace).not.toHaveBeenCalled();
  });
});

function renderButton() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LogoutButton csrfToken="csrf-token" />
    </QueryClientProvider>,
  );
  return queryClient;
}
