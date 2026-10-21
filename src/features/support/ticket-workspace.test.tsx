import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/features/auth/api";
import type { TicketListItem } from "./api";
import { TicketWorkspace } from "./ticket-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Support.Operator",
  roles: ["IT_OPERATOR"],
  csrfToken: "sensitive-session-value-kept-in-memory",
  expiresAt: "2026-10-19T23:00:00Z",
};
const assetId = "0b2b7ee9-017e-4d62-83e0-87056735e71e";
const ticket = {
  ticketId: "700678fa-57fe-4c76-84e0-feb63e708acd",
  type: "INCIDENT",
  summary: "Printer unavailable",
  description: "The reception printer is offline.",
  status: "OPEN",
  priority: "NORMAL",
  source: "WEB",
  requesterUserId: session.userId,
  createdByUserId: session.userId,
  assigneeUserId: null,
  assetId,
  createdAt: "2026-10-19T18:00:00Z",
  updatedAt: "2026-10-19T18:00:00Z",
  version: 0,
};
const ticketListItem: TicketListItem = {
  ticketId: ticket.ticketId,
  type: "INCIDENT",
  summary: ticket.summary,
  status: "OPEN",
  priority: "NORMAL",
  source: "WEB",
  requesterUserId: ticket.requesterUserId,
  createdByUserId: ticket.createdByUserId,
  assigneeUserId: null,
  assetId: ticket.assetId,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  version: 0,
};
const comment = {
  commentId: "780f497f-160f-42f5-aed3-5a99ac1d52bc",
  ticketId: ticket.ticketId,
  visibility: "PUBLIC",
  authorUserId: session.userId,
  body: "The printer is available again.",
  createdAt: "2026-10-19T19:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function page(items: unknown[], size: number) {
  return { items, page: 0, size, totalElements: items.length, totalPages: items.length ? 1 : 0 };
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function mockApi(ticketItems: unknown[] = [], commentItems: unknown[] = []) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(`/tickets/${ticket.ticketId}/comments`) && init?.method === "POST") {
      return response(comment, 201);
    }
    if (url.includes(`/tickets/${ticket.ticketId}/comments?`)) return response(page(commentItems, 50));
    if (url.endsWith(`/tickets/${ticket.ticketId}`)) return response(ticket);
    if (url.includes("/tickets?page=")) return response(page(ticketItems, 20));
    if (url.endsWith("/tickets") && init?.method === "POST") return response(ticket, 201);
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderWorkspace(currentSession = session) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TicketWorkspace session={currentSession} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("TicketWorkspace", () => {
  it("moves through ticket pages without mixing user-scoped cache entries", async () => {
    const allTickets = Array.from({ length: 21 }, (_, index) => ({
      ...ticketListItem,
      ticketId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      summary: `Ticket page item ${index + 1}`,
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/tickets?page=0")) {
        return response({ items: allTickets.slice(0, 20), page: 0, size: 20, totalElements: 21, totalPages: 2 });
      }
      if (url.includes("/tickets?page=1")) {
        return response({ items: allTickets.slice(20), page: 1, size: 20, totalElements: 21, totalPages: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderWorkspace();
    await screen.findByText("Ticket page item 1");

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(await screen.findByText("Ticket page item 21")).toBeDefined();
    expect(screen.queryByText("Ticket page item 1")).toBeNull();
    expect(queryClient.getQueryData([
      "users", session.userId, "support", "tickets", { page: 1, size: 20 },
    ])).toMatchObject({ page: 1, totalPages: 2 });
  });

  it("lists, selects, and presents an owned ticket with its public conversation", async () => {
    const fetchMock = mockApi([ticketListItem], [comment]);
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderWorkspace();

    const listItem = await screen.findByRole("button", { name: /Printer unavailable/ });
    expect(screen.queryByText(ticket.description)).toBeNull();
    fireEvent.click(listItem);

    const selected = await screen.findByRole("article", { name: "Consulta del ticket por ID" });
    expect(within(selected).getByRole("heading", { name: ticket.summary })).toBeDefined();
    expect(within(selected).getByText(ticket.description)).toBeDefined();
    expect(await screen.findByText(comment.body)).toBeDefined();
    expect(queryClient.getQueryData([
      "users", session.userId, "support", "tickets", { page: 0, size: 20 },
    ])).toMatchObject({ items: [ticketListItem] });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith(`/tickets/${ticket.ticketId}`))).toBe(true);
    expect(queryClient.getQueryData([
      "users", session.userId, "support", "ticket", ticket.ticketId, "comments",
      { page: 0, size: 50 },
    ])).toMatchObject({ items: [comment] });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("creates an associated ticket with in-memory CSRF and refreshes the owned list", async () => {
    const fetchMock = mockApi();
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();
    await screen.findByText("Todavía no tienes tickets.");

    fireEvent.change(screen.getByLabelText("Resumen"), { target: { value: ticket.summary } });
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: ticket.description } });
    fireEvent.change(screen.getByLabelText("Activo asociado por UUID (opcional)"), { target: { value: assetId } });
    fireEvent.click(screen.getByRole("button", { name: "Crear ticket" }));

    const created = await screen.findByRole("article", { name: "Resultado de creación del ticket" });
    expect(within(created).getByRole("heading", { name: ticket.summary })).toBeDefined();
    expect(await screen.findByRole("article", { name: "Consulta del ticket por ID" })).toBeDefined();
    const post = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/tickets")
      && call[1]?.method === "POST");
    expect(post?.[1]).toMatchObject({
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
    });
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      type: "INCIDENT",
      summary: ticket.summary,
      description: ticket.description,
      assetId,
    });
  });

  it("posts a comment without optimistic state and refetches the exact conversation page", async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    let posted = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(`/tickets/${ticket.ticketId}/comments`) && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolvePost = (value) => {
            posted = true;
            resolve(value);
          };
        });
      }
      if (url.includes(`/tickets/${ticket.ticketId}/comments?`)) {
        return response(page(posted ? [comment] : [], 50));
      }
      if (url.endsWith(`/tickets/${ticket.ticketId}`)) return response(ticket);
      if (url.includes("/tickets?page=")) return response(page([ticketListItem], 20));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: /Printer unavailable/ }));
    await screen.findByText("Aún no hay comentarios públicos.");

    fireEvent.change(screen.getByLabelText("Añadir comentario público"), {
      target: { value: `  ${comment.body}  ` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publicar comentario" }));
    expect(screen.queryByText(comment.body, { selector: ".comment-list p" })).toBeNull();
    resolvePost?.(response(comment, 201));

    expect(await screen.findByText(comment.body)).toBeDefined();
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect(post?.[1]).toMatchObject({
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
    });
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({ body: comment.body });
  });

  it("validates optional asset and lookup identifiers before requesting", async () => {
    const fetchMock = mockApi();
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();
    await screen.findByText("Todavía no tienes tickets.");

    fireEvent.change(screen.getByLabelText("Resumen"), { target: { value: ticket.summary } });
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: ticket.description } });
    fireEvent.change(screen.getByLabelText("Activo asociado por UUID (opcional)"), { target: { value: "invalid" } });
    expect((screen.getByRole("button", { name: "Crear ticket" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("UUID del ticket"), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar ticket" }));
    expect(screen.getAllByRole("alert").at(-1)?.textContent).toContain("UUIDv4 válido");
    expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes("not-a-uuid"))).toBe(true);
  });

  it("fails closed when a list item contains description", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(page([{
      ...ticketListItem,
      description: ticket.description,
    }], 20))));
    renderWorkspace();

    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
    expect(screen.queryByText(ticket.summary)).toBeNull();
  });

  it("fails closed for another unexpected list item field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(page([{
      ...ticketListItem,
      internalNotes: [],
    }], 20))));
    renderWorkspace();

    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
    expect(screen.queryByText(ticket.summary)).toBeNull();
  });

  it("fails closed for foreign ticket ownership", async () => {
    const foreign = {
      ...ticketListItem,
      requesterUserId: "3495af6f-a455-4310-86f8-79a12be536d5",
      createdByUserId: "3495af6f-a455-4310-86f8-79a12be536d5",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(page([foreign], 20))));
    renderWorkspace();

    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
    expect(screen.queryByText(ticket.summary)).toBeNull();
  });

  it("shows a PUBLIC comment written by the assigned technician", async () => {
    vi.stubGlobal("fetch", mockApi([ticketListItem], [{
      ...comment,
      authorUserId: "3495af6f-a455-4310-86f8-79a12be536d5",
      body: "The assigned technician scheduled the repair.",
    }]));
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: /Printer unavailable/ }));

    expect(await screen.findByText("The assigned technician scheduled the repair.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fails closed when the requester conversation contains INTERNAL visibility", async () => {
    vi.stubGlobal("fetch", mockApi([ticketListItem], [{
      ...comment,
      visibility: "INTERNAL",
      body: "Technician-only diagnosis.",
    }]));
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: /Printer unavailable/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
    expect(screen.queryByText("Technician-only diagnosis.")).toBeNull();
  });

  it("does not expose Support operations without IT_OPERATOR", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderWorkspace({ ...session, roles: ["SYSTEM_ADMIN"] });
    expect(screen.queryByRole("heading", { name: "Tickets" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Crear ticket" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
