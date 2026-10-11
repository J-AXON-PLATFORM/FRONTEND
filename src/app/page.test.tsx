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
});
