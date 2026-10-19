import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/features/auth/api";
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

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
  it("creates an associated ticket with in-memory CSRF and re-queries its own record", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(ticket), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ticket), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderWorkspace();

    fireEvent.change(screen.getByLabelText("Resumen"), { target: { value: ticket.summary } });
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: ticket.description } });
    fireEvent.change(screen.getByLabelText("Activo asociado por UUID (opcional)"), { target: { value: assetId } });
    fireEvent.click(screen.getByRole("button", { name: "Crear ticket" }));

    const created = await screen.findByRole("article", { name: "Resultado de creación del ticket" });
    expect(within(created).getByRole("heading", { name: ticket.summary })).toBeDefined();
    const queried = await screen.findByRole("article", { name: "Consulta del ticket por ID" });
    expect(within(queried).getByText(ticket.ticketId)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/tickets");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      type: "INCIDENT",
      summary: ticket.summary,
      description: ticket.description,
      assetId,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/v1/tickets/${ticket.ticketId}`);
    expect(queryClient.getQueryData([
      "users", session.userId, "support", "ticket", ticket.ticketId,
    ])).toEqual(ticket);
    expect(queryClient.getQueryData([
      "users", "700678fa-57fe-4c76-84e0-feb63e708acd", "support", "ticket", ticket.ticketId,
    ])).toBeUndefined();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("validates optional asset and lookup identifiers before requesting", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Resumen"), { target: { value: ticket.summary } });
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: ticket.description } });
    fireEvent.change(screen.getByLabelText("Activo asociado por UUID (opcional)"), { target: { value: "invalid" } });
    expect((screen.getByRole("button", { name: "Crear ticket" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("UUIDv4 de activo válido");

    fireEvent.change(screen.getByLabelText("UUID del ticket"), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar ticket" }));
    expect(screen.getAllByRole("alert").at(-1)?.textContent).toContain("UUIDv4 válido");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unexpected response fields instead of presenting partial state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...ticket,
      internalNote: "must not be accepted",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("UUID del ticket"), { target: { value: ticket.ticketId } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar ticket" }));

    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
    expect(screen.queryByRole("article", { name: "Consulta del ticket por ID" })).toBeNull();
  });

  it("rejects a ticket that does not belong to the authenticated user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...ticket,
      requesterUserId: "3495af6f-a455-4310-86f8-79a12be536d5",
      createdByUserId: "3495af6f-a455-4310-86f8-79a12be536d5",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("UUID del ticket"), { target: { value: ticket.ticketId } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar ticket" }));

    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
    expect(screen.queryByRole("article", { name: "Consulta del ticket por ID" })).toBeNull();
  });

  it("does not expose Support operations without IT_OPERATOR", () => {
    renderWorkspace({ ...session, roles: ["SYSTEM_ADMIN"] });
    expect(screen.queryByRole("heading", { name: "Tickets" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Crear ticket" })).toBeNull();
  });
});
