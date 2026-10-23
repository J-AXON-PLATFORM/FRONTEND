import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/features/auth/api";
import {
  parseTechnicianConversationPage,
  TicketContractError,
  updateTicketPriority,
  updateTicketStatus,
} from "./api";
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
      if (url.includes(`/tickets/technician-queue/${ticket.ticketId}/conversation?`)) {
        return response(page([comment], 0, 50));
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
    expect(screen.queryByLabelText("Visibilidad")).toBeNull();

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
    expect((await screen.findByLabelText("Visibilidad") as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Añadir a la conversación" }) as HTMLButtonElement).disabled)
      .toBe(true);
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

  it("renders the closed combined schema and rejects unknown or extra fields", () => {
    const internal = {
      ...comment,
      commentId: "a1af4e11-415b-4650-adf1-41d4101a8bc0",
      visibility: "INTERNAL",
      authorUserId: session.userId,
      body: "Internal diagnosis",
    };
    expect(parseTechnicianConversationPage(
      page([comment, internal], 0, 50), ticket.ticketId, 0, 50, session.userId,
    ).items.map((item) => item.visibility)).toEqual(["PUBLIC", "INTERNAL"]);
    expect(() => parseTechnicianConversationPage(
      page([{ ...internal, visibility: "SECRET" }], 0, 50), ticket.ticketId, 0, 50, session.userId,
    )).toThrow(TicketContractError);
    expect(() => parseTechnicianConversationPage(
      page([{ ...internal, leaked: true }], 0, 50), ticket.ticketId, 0, 50, session.userId,
    )).toThrow(TicketContractError);
  });

  it("posts explicit visibility without retry or optimistic state and preserves input on failure", async () => {
    const assignedTicket = { ...ticket, assigneeUserId: session.userId, version: 1 };
    const internal = {
      ...comment,
      commentId: "a1af4e11-415b-4650-adf1-41d4101a8bc0",
      visibility: "INTERNAL",
      authorUserId: session.userId,
      body: "Internal diagnosis",
    };
    let conversationItems: unknown[] = [comment, internal];
    let postCount = 0;
    let resolveSuccessfulPost: ((value: Response) => void) | undefined;
    const created = {
      ...comment,
      commentId: "f4dbbf94-a037-45a5-b70b-66ebd32c7d86",
      authorUserId: session.userId,
      body: "Technical public update",
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/tickets/technician-queue/${ticket.ticketId}/conversation`)
          && init?.method === "POST") {
        postCount += 1;
        if (postCount === 1) {
          return response({ code: "SERVICE_UNAVAILABLE", correlationId: crypto.randomUUID() }, 503);
        }
        return new Promise<Response>((resolve) => {
          resolveSuccessfulPost = (value) => {
            conversationItems = [...conversationItems, created];
            resolve(value);
          };
        });
      }
      if (url.includes(`/tickets/technician-queue/${ticket.ticketId}/conversation?`)) {
        return response(page(conversationItems, 0, 50));
      }
      if (url.endsWith(`/tickets/technician-queue/${ticket.ticketId}`)) return response(assignedTicket);
      if (url.includes("/tickets/technician-queue?")) {
        return response(page([{ ...listItem, assigneeUserId: session.userId, version: 1 }]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderWorkspace();
    const invalidation = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(await screen.findByRole("button", { name: /Printer unavailable/ }));
    expect(await screen.findByLabelText("Visibilidad: público")).toBeDefined();
    expect(await screen.findByLabelText("Visibilidad: interno")).toBeDefined();
    const visibility = screen.getByLabelText("Visibilidad") as HTMLSelectElement;
    const body = screen.getByLabelText("Comentario técnico") as HTMLTextAreaElement;
    const submit = screen.getByRole("button", { name: "Añadir a la conversación" });
    expect(visibility.value).toBe("");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(visibility, { target: { value: "PUBLIC" } });
    fireEvent.change(body, { target: { value: "  Technical public update  " } });
    fireEvent.click(submit);
    expect((await screen.findByRole("alert")).textContent).toContain("no está disponible");
    expect(postCount).toBe(1);
    expect(visibility.value).toBe("PUBLIC");
    expect(body.value).toBe("  Technical public update  ");
    expect(screen.queryByText("Technical public update", { selector: "p" })).toBeNull();

    fireEvent.click(submit);
    await vi.waitFor(() => expect(postCount).toBe(2));
    expect(screen.queryByText("Technical public update", { selector: "p" })).toBeNull();
    const post = fetchMock.mock.calls.filter((call) => (
      String(call[0]).endsWith("/conversation") && call[1]?.method === "POST"
    )).at(-1);
    expect(post?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    });
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      visibility: "PUBLIC",
      body: "Technical public update",
    });
    resolveSuccessfulPost?.(response(created, 201));

    expect(await screen.findByText("Technical public update", { selector: "p" })).toBeDefined();
    expect(visibility.value).toBe("");
    expect(body.value).toBe("");
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: ["users", session.userId, "support", "technician", "ticket", ticket.ticketId, "conversation"],
    });
    expect(fetchMock.mock.calls.filter((call) => (
      String(call[0]).endsWith("/conversation") && call[1]?.method === "POST"
    ))).toHaveLength(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("changes priority and the non-terminal lifecycle without retry or optimistic state", async () => {
    let currentTicket = { ...ticket, assigneeUserId: session.userId, version: 1 };
    let resolvePriority: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/tickets/${ticket.ticketId}/priority`) && init?.method === "PUT") {
        return new Promise<Response>((resolve) => {
          resolvePriority = (value) => resolve(value);
        });
      }
      if (url.endsWith(`/tickets/${ticket.ticketId}/status`) && init?.method === "PUT") {
        currentTicket = {
          ...currentTicket,
          status: "IN_PROGRESS",
          updatedAt: "2026-10-21T20:02:00Z",
          version: 3,
        };
        return response(currentTicket);
      }
      if (url.includes(`/tickets/technician-queue/${ticket.ticketId}/conversation?`)) {
        return response(page([], 0, 50));
      }
      if (url.endsWith(`/tickets/technician-queue/${ticket.ticketId}`)) return response(currentTicket);
      if (url.includes("/tickets/technician-queue?")) {
        const currentListItem = { ...listItem, ...currentTicket } as Partial<typeof currentTicket>;
        delete currentListItem.description;
        return response(page([currentListItem]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /Printer unavailable/ }));
    const priority = await screen.findByLabelText("Prioridad") as HTMLSelectElement;
    expect(priority.value).toBe("NORMAL");
    fireEvent.change(priority, { target: { value: "HIGH" } });
    expect(priority.value).toBe("NORMAL");
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(
      (call) => String(call[0]).endsWith("/priority"),
    )).toBe(true));
    const priorityPut = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/priority"));
    expect(priorityPut?.[1]).toMatchObject({
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    });
    expect(JSON.parse(priorityPut?.[1]?.body as string)).toEqual({ priority: "HIGH", expectedVersion: 1 });

    currentTicket = {
      ...currentTicket,
      priority: "HIGH",
      updatedAt: "2026-10-21T20:01:00Z",
      version: 2,
    };
    resolvePriority?.(response(currentTicket));
    await vi.waitFor(() => expect(priority.value).toBe("HIGH"));

    fireEvent.click(screen.getByRole("button", { name: "Iniciar atención" }));
    await vi.waitFor(() => expect(screen.getByText("IN_PROGRESS")).toBeDefined());
    const statusPut = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/status"));
    expect(JSON.parse(statusPut?.[1]?.body as string)).toEqual({ status: "IN_PROGRESS", expectedVersion: 2 });
    expect(screen.getByRole("button", { name: "Esperar respuesta del requester" })).toBeDefined();
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/priority"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/status"))).toHaveLength(1);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("enforces ticket identity and exact effective or no-op response versions", async () => {
    const assignedTicket = { ...ticket, assigneeUserId: session.userId, priority: "HIGH", version: 2 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ...assignedTicket, ticketId: "55783c94-caee-445f-a157-18bb2dfcaf36" }))
      .mockResolvedValueOnce(response({ ...assignedTicket, ticketId: ticket.ticketId, version: 1 }))
      .mockResolvedValueOnce(response({ ...assignedTicket, priority: "NORMAL", version: 1 }))
      .mockResolvedValueOnce(response({ ...assignedTicket, priority: "NORMAL", status: "OPEN", version: 1 }))
      .mockResolvedValueOnce(response({ ...assignedTicket, priority: "NORMAL", version: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateTicketPriority(
      ticket.ticketId, "NORMAL", "HIGH", 1, session.csrfToken, session.userId,
    )).rejects.toBeInstanceOf(TicketContractError);
    await expect(updateTicketPriority(
      ticket.ticketId, "NORMAL", "HIGH", 1, session.csrfToken, session.userId,
    )).rejects.toBeInstanceOf(TicketContractError);
    await expect(updateTicketPriority(
      ticket.ticketId, "NORMAL", "NORMAL", 1, session.csrfToken, session.userId,
    )).resolves.toMatchObject({ priority: "NORMAL", version: 1 });
    await expect(updateTicketStatus(
      ticket.ticketId, "OPEN", "OPEN", 1, session.csrfToken, session.userId,
    )).resolves.toMatchObject({ status: "OPEN", version: 1 });
    await expect(updateTicketPriority(
      ticket.ticketId, "NORMAL", "NORMAL", 1, session.csrfToken, session.userId,
    )).rejects.toBeInstanceOf(TicketContractError);
  });

  it("refetches the ticket and queue after a stale triage conflict", async () => {
    let currentTicket = { ...ticket, assigneeUserId: session.userId, version: 1 };
    let detailRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/tickets/${ticket.ticketId}/priority`) && init?.method === "PUT") {
        currentTicket = { ...currentTicket, priority: "HIGH", version: 2 };
        return response({ code: "TICKET_MUTATION_CONFLICT", correlationId: crypto.randomUUID() }, 409);
      }
      if (url.includes(`/tickets/technician-queue/${ticket.ticketId}/conversation?`)) {
        return response(page([], 0, 50));
      }
      if (url.endsWith(`/tickets/technician-queue/${ticket.ticketId}`)) {
        detailRequests += 1;
        return response(currentTicket);
      }
      if (url.includes("/tickets/technician-queue?")) {
        const currentListItem = { ...listItem, ...currentTicket } as Partial<typeof currentTicket>;
        delete currentListItem.description;
        return response(page([currentListItem]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /Printer unavailable/ }));
    fireEvent.change(await screen.findByLabelText("Prioridad"), { target: { value: "HIGH" } });

    expect((await screen.findByRole("alert")).textContent).toContain("El detalle se actualizó");
    await vi.waitFor(() => expect(detailRequests).toBeGreaterThanOrEqual(2));
    expect((screen.getByLabelText("Prioridad") as HTMLSelectElement).value).toBe("HIGH");
    expect(screen.getByText("2", { selector: "dd" })).toBeDefined();
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/priority"))).toHaveLength(1);
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
