import type { Session } from "@/features/auth/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditWorkspace } from "./audit-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const auditor: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Auditor.One",
  roles: ["AUDITOR"],
  csrfToken: "csrf-token",
  expiresAt: "2026-11-26T20:00:00Z",
};
const event = {
  auditEventId: "f4844482-1d29-4d30-87fd-1bb67a22e050",
  sourceEventId: "24844482-1d29-4d30-87fd-1bb67a22e050",
  eventType: "AI_SOURCE_DISABLED",
  eventVersion: "1.0",
  producerModule: "AI",
  occurredAt: "2026-11-26T10:00:00Z",
  recordedAt: "2026-11-26T10:00:01Z",
  actorType: "HUMAN_USER",
  actorId: "41de253e-dff5-4fbd-85c1-3cb637d319ac",
  resourceType: "AI_SOURCE",
  resourceId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  resourceVersion: 3,
  result: "SUCCESS",
  correlationId: "14fb9d5d-b66a-454c-9fea-8dbdcc1c6ac7",
  metadata: { previousStatus: "<b>READY</b>", newStatus: "DISABLED" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function pageOf(items: unknown[], pageNumber = 0, size = 50, total = items.length) {
  return { items, page: pageNumber, size, totalElements: total, totalPages: Math.ceil(total / size) };
}

function renderWorkspace(session: Session = auditor, client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) {
  render(<QueryClientProvider client={client}><AuditWorkspace session={session} /></QueryClientProvider>);
  return client;
}

describe("AuditWorkspace", () => {
  it.each([["SYSTEM_ADMIN"], ["IT_OPERATOR"], ["SUPPORT_TECHNICIAN"], ["END_USER"]])(
    "renders nothing and does not query for %s without AUDITOR",
    (role) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      renderWorkspace({ ...auditor, roles: [role] });
      expect(screen.queryByRole("heading", { name: "Auditoría" })).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("lists events with escaped metadata and opaque identifiers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(pageOf([event]))));
    renderWorkspace();

    const card = await screen.findByRole("article", { name: `Evento AI_SOURCE_DISABLED ${event.auditEventId}` });
    expect(card.textContent).toContain(event.resourceId);
    expect(card.textContent).toContain(event.correlationId);
    expect(card.textContent).toContain("<b>READY</b>");
    expect(card.querySelector("b")).toBeNull();
    expect(screen.getByText(/1 evento\(s\)/)).toBeTruthy();
  });

  it("validates filters locally without querying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(pageOf([])));
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();
    await screen.findByText("No hay eventos de auditoría para estos filtros.");

    fireEvent.change(screen.getByLabelText("Correlation ID"), { target: { value: "not-a-uuid" } });
    fireEvent.submit(screen.getByRole("form", { name: "Filtros de auditoría" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Correlation ID debe ser un UUIDv4");

    fireEvent.change(screen.getByLabelText("Correlation ID"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Tipo de evento"), { target: { value: "lower" } });
    fireEvent.submit(screen.getByRole("form", { name: "Filtros de auditoría" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Tipo de evento");

    fireEvent.change(screen.getByLabelText("Tipo de evento"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Desde (UTC)"), { target: { value: "2026-11-26T12:00" } });
    fireEvent.change(screen.getByLabelText("Hasta (UTC, exclusivo)"), { target: { value: "2026-11-26T11:00" } });
    fireEvent.submit(screen.getByRole("form", { name: "Filtros de auditoría" }));
    expect((await screen.findByRole("alert")).textContent).toContain("posterior");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("applies filters as a closed query and paginates", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("page=1")) return Promise.resolve(json(pageOf([event], 1, 50, 51)));
      if (url.includes("correlationId=")) return Promise.resolve(json(pageOf([event], 0, 50, 51)));
      return Promise.resolve(json(pageOf([])));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();
    await screen.findByText("No hay eventos de auditoría para estos filtros.");

    fireEvent.change(screen.getByLabelText("Correlation ID"), { target: { value: event.correlationId.toUpperCase() } });
    fireEvent.change(screen.getByLabelText("Módulo"), { target: { value: "AI" } });
    fireEvent.change(screen.getByLabelText("Resultado"), { target: { value: "SUCCESS" } });
    fireEvent.change(screen.getByLabelText("Desde (UTC)"), { target: { value: "2026-11-26T09:00" } });
    fireEvent.submit(screen.getByRole("form", { name: "Filtros de auditoría" }));
    await screen.findByText(/Página 1 de 2/);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      `/api/v1/audit/events?from=2026-11-26T09%3A00%3A00Z&module=AI&result=SUCCESS&correlationId=${event.correlationId}&page=0&size=50`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText(/Página 2 de 2/);
    expect(String(fetchMock.mock.calls[2][0])).toContain("page=1&size=50");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Siguiente" }).disabled).toBe(true);
  });

  it.each([
    [403, "no autoriza"],
    [422, "Revisa los filtros"],
    [503, "no está disponible"],
  ])("shows an accessible error for %s", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "X", correlationId: event.correlationId,
    }), { status, headers: { "Content-Type": "application/problem+json" } })));
    renderWorkspace();
    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });

  it("rejects an invalid contract response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(pageOf([{ ...event, username: "admin" }]))));
    renderWorkspace();
    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
  });

  it("clears caches and redirects on an expired session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "AUTHENTICATION_REQUIRED", correlationId: event.correlationId,
    }), { status: 401, headers: { "Content-Type": "application/problem+json" } })));
    renderWorkspace();
    await screen.findByRole("alert");
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("segments the cache by user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(pageOf([event]))));
    const client = renderWorkspace();
    await screen.findByRole("article");
    expect(client.getQueryCache().getAll().map((query) => query.queryKey[1])).toEqual([auditor.userId]);
  });
});
