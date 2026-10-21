import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/features/auth/api";
import { TechnicianTicketWorkspace } from "./technician-ticket-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  username: "Support.Technician",
  roles: ["SUPPORT_TECHNICIAN"],
  csrfToken: "technical-csrf-kept-in-memory",
  expiresAt: "2026-10-22T00:00:00Z",
};
const requesterId = "31de253e-dff5-4fbd-85c1-3cb637d319ac";
const ticket = {
  ticketId: "700678fa-57fe-4c76-84e0-feb63e708acd",
  type: "INCIDENT",
  summary: "Printer unavailable",
  description: "The reception printer is offline.",
  status: "OPEN",
  priority: "NORMAL",
  source: "WEB",
  requesterUserId: requesterId,
  createdByUserId: requesterId,
  assigneeUserId: null,
  assetId: null,
  createdAt: "2026-10-21T18:00:00Z",
  updatedAt: "2026-10-21T18:00:00Z",
  version: 0,
};
const listItem = {
  ticketId: ticket.ticketId,
  type: ticket.type,
  summary: ticket.summary,
  status: ticket.status,
  priority: ticket.priority,
  source: ticket.source,
  requesterUserId: ticket.requesterUserId,
  createdByUserId: ticket.createdByUserId,
  assigneeUserId: ticket.assigneeUserId,
  assetId: ticket.assetId,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  version: ticket.version,
};
const comment = {
  commentId: "780f497f-160f-42f5-aed3-5a99ac1d52bc",
  ticketId: ticket.ticketId,
  visibility: "PUBLIC",
  authorUserId: requesterId,
  body: "Requester supplied a public update.",
  createdAt: "2026-10-21T19:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function response(value: unknown, status = 200) {
  const contentType = status >= 400 ? "application/problem+json" : "application/json";
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": contentType } });
}

function page(items: unknown[], requestedPage = 0, size = 20, totalElements = items.length) {
  return {
    items,
    page: requestedPage,
    size,
    totalElements,
    totalPages: Math.ceil(totalElements / size),
  };
}

function renderWorkspace(currentSession = session) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TechnicianTicketWorkspace session={currentSession} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("TechnicianTicketWorkspace", () => {
  it("uses URL pagination and user-scoped queue cache entries", async () => {
    window.history.replaceState(null, "", "/?page=1&size=10");
    const fetchMock = vi.fn().mockResolvedValue(response(page([listItem], 1, 10, 11)));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderWorkspace();

    expect(await screen.findByText(ticket.summary)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/tickets/technician-queue?page=1&size=10"),
      { credentials: "include" },
    );
    expect(queryClient.getQueryData([
      "users", session.userId, "support", "technician", "tickets", { page: 1, size: 10 },
    ])).toMatchObject({ page: 1, size: 10 });

    fireEvent.change(screen.getByLabelText("Por página"), { target: { value: "50" } });
    expect(window.location.search).toBe("?page=0&size=50");
  });

  it("shows detail and PUBLIC conversation, then claims without optimistic state", async () => {
    let claimed = false;
    let resolveClaim: ((response: Response) => void) | undefined;
    const claimedTicket = {
      ...ticket,
      assigneeUserId: session.userId,
      updatedAt: "2026-10-21T20:00:00Z",
      version: 1,
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/tickets/${ticket.ticketId}/claim`) && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveClaim = (value) => {
            claimed = true;
            resolve(value);
          };
        });
      }
      if (url.includes(`/tickets/technician-queue/${ticket.ticketId}/comments?`)) return response(page([comment], 0, 50));
      if (url.endsWith(`/tickets/technician-queue/${ticket.ticketId}`)) return response(claimed ? claimedTicket : ticket);
      if (url.includes("/tickets/technician-queue?")) {
        return response(page([claimed ? { ...listItem, assigneeUserId: session.userId, version: 1 } : listItem]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderWorkspace();
    const invalidation = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(await screen.findByRole("button", { name: /Printer unavailable/ }));
    const detail = await screen.findByRole("article", { name: "Detalle técnico del ticket" });
    expect(within(detail).getByText(ticket.description)).toBeDefined();
    expect(await screen.findByText(comment.body)).toBeDefined();
    expect(screen.getByText(`Autor ${requesterId}`)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Asignarme ticket" }));
    expect(screen.queryByText("Asignado a ti", { selector: "dd" })).toBeNull();
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(
      (call) => String(call[0]).endsWith("/claim"),
    )).toBe(true));
    const post = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/claim"));
    expect(post?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    });
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({ expectedVersion: 0 });
    resolveClaim?.(response(claimedTicket));

    expect(await screen.findByText("Ticket asignado a tu sesión.")).toBeDefined();
    expect(await screen.findByText("Asignado a ti", { selector: "dd" })).toBeDefined();
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: ["users", session.userId, "support", "technician", "tickets", { page: 0, size: 20 }],
      exact: true,
    });
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: ["users", session.userId, "support", "technician", "ticket", ticket.ticketId],
      exact: true,
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("fails closed for a ticket assigned to another technician", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(page([{
      ...listItem,
      assigneeUserId: "6b083bf9-035e-4074-a5df-45c904051b40",
      version: 1,
    }]))));
    renderWorkspace();

    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
    expect(screen.queryByText(ticket.summary)).toBeNull();
  });

  it("does not render or fetch without SUPPORT_TECHNICIAN", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderWorkspace({ ...session, roles: ["IT_OPERATOR"] });

    expect(screen.queryByRole("heading", { name: "Bandeja técnica" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
