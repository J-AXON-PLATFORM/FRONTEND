import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/features/auth/api";
import { NotificationWorkspace } from "./notification-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "d4844482-1d29-4d30-87fd-1bb67a22e050",
  username: "Requester",
  roles: ["END_USER"],
  csrfToken: "csrf-token-kept-in-memory",
  expiresAt: "2026-12-02T20:00:00Z",
};
const unread = {
  notificationId: "f4844482-1d29-4d30-87fd-1bb67a22e050",
  type: "TICKET_WAITING_FOR_REQUESTER",
  resourceType: "TICKET",
  resourceId: "e4844482-1d29-4d30-87fd-1bb67a22e050",
  status: "UNREAD",
  version: 0,
  createdAt: "2026-12-02T12:00:00Z",
  readAt: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotificationWorkspace session={session} />
    </QueryClientProvider>,
  );
  return client;
}

describe("NotificationWorkspace", () => {
  it("lists notifications once without polling and filters only by explicit action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [unread], page: 0, size: 20, totalElements: 1, totalPages: 1,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    expect(await screen.findByRole("heading", { name: "El ticket espera tu respuesta" })).toBeDefined();
    expect(screen.getByText(unread.resourceId)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "UNREAD" } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain("status=UNREAD&page=0&size=20");
  });

  it("marks an unread notification with CSRF and refetches the active page", async () => {
    const read = { ...unread, status: "READ", version: 1, readAt: "2026-12-02T12:01:00Z" };
    let listCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify(read), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      listCount += 1;
      return new Response(JSON.stringify({
        items: [listCount === 1 ? unread : read],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "Marcar como leída" }));
    await screen.findByText("Leída");
    expect(screen.queryByRole("button", { name: "Marcar como leída" })).toBeNull();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[1]).toMatchObject({
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
      body: JSON.stringify({ expectedVersion: 0 }),
    });
    expect(document.body.textContent).not.toContain(session.csrfToken);
    expect(listCount).toBe(2);
  });

  it("keeps version conflicts visible without an automatic mutation retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [unread], page: 0, size: 20, totalElements: 1, totalPages: 1,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: "NOTIFICATION_VERSION_CONFLICT",
        correlationId: unread.resourceId,
      }), { status: 409, headers: { "Content-Type": "application/problem+json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "Marcar como leída" }));
    expect((await screen.findByRole("alert")).textContent).toContain("La notificación cambió");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears user-scoped cache and redirects on authentication failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "AUTHENTICATION_REQUIRED",
      correlationId: unread.resourceId,
    }), { status: 401, headers: { "Content-Type": "application/problem+json" } })));
    const client = renderWorkspace();
    client.setQueryData(["users", session.userId, "secret"], "sensitive");

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(client.getQueryData(["users", session.userId, "secret"])).toBeUndefined();
  });
});
