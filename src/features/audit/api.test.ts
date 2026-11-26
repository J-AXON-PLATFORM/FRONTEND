import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuditContractError,
  auditQueryString,
  listAuditEvents,
  parseAuditEventPage,
  utcInputToInstant,
} from "./api";

const auditEvent = {
  auditEventId: "f4844482-1d29-4d30-87fd-1bb67a22e050",
  sourceEventId: "24844482-1d29-4d30-87fd-1bb67a22e050",
  eventType: "AI_SOURCE_DISABLED",
  eventVersion: "1.0",
  producerModule: "AI",
  occurredAt: "2026-11-26T10:00:00.123456Z",
  recordedAt: "2026-11-26T10:00:01Z",
  actorType: "HUMAN_USER",
  actorId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  resourceType: "AI_SOURCE",
  resourceId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  resourceVersion: 3,
  result: "SUCCESS",
  correlationId: "14fb9d5d-b66a-454c-9fea-8dbdcc1c6ac7",
  metadata: { newStatus: "DISABLED", previousStatus: "READY" },
};

function page(items: unknown[], overrides: Record<string, unknown> = {}) {
  return { items, page: 0, size: 50, totalElements: items.length, totalPages: items.length ? 1 : 0, ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audit API", () => {
  it("builds a closed query string with only provided filters", () => {
    expect(auditQueryString({ page: 0, size: 50 })).toBe("page=0&size=50");
    expect(auditQueryString({
      page: 2, size: 200, module: "AI", correlationId: auditEvent.correlationId, from: "2026-11-26T10:00:00Z",
      eventType: "",
    })).toBe(`from=2026-11-26T10%3A00%3A00Z&module=AI&correlationId=${auditEvent.correlationId}&page=2&size=200`);
  });

  it("requests events with the session cookie and accepts a closed page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(page([auditEvent])), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAuditEvents({ page: 0, size: 50, module: "AI" })).resolves.toEqual(page([auditEvent]));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/audit/events?module=AI&page=0&size=50", { credentials: "include" });
  });

  it("propagates problem responses as API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "ACCESS_DENIED", correlationId: auditEvent.correlationId,
    }), { status: 403, headers: { "Content-Type": "application/problem+json" } })));

    await expect(listAuditEvents({ page: 0, size: 50 })).rejects.toMatchObject({ status: 403 });
  });

  it("orders by occurrence then identifier descending", () => {
    const later = { ...auditEvent, auditEventId: "a4844482-1d29-4d30-87fd-1bb67a22e050",
      occurredAt: "2026-11-26T11:00:00Z" };
    const tie = { ...auditEvent, auditEventId: "04844482-1d29-4d30-87fd-1bb67a22e050" };
    expect(parseAuditEventPage(page([later, auditEvent, tie]), 0, 50).items).toHaveLength(3);
    expect(() => parseAuditEventPage(page([auditEvent, later]), 0, 50)).toThrow(AuditContractError);
    expect(() => parseAuditEventPage(page([tie, auditEvent]), 0, 50)).toThrow(AuditContractError);
    expect(() => parseAuditEventPage(page([auditEvent, auditEvent]), 0, 50)).toThrow(AuditContractError);
  });

  it.each([
    ["extra page key", page([auditEvent], { extra: true })],
    ["page mismatch", page([auditEvent], { page: 1 })],
    ["size mismatch", page([auditEvent], { size: 20 })],
    ["inconsistent totals", page([auditEvent], { totalPages: 2 })],
    ["extra event key", page([{ ...auditEvent, username: "admin" }])],
    ["missing event key", page([{ ...auditEvent, correlationId: undefined }])],
    ["invalid uuid", page([{ ...auditEvent, resourceId: "34844482-1d29-1d30-87fd-1bb67a22e050" }])],
    ["lowercase code", page([{ ...auditEvent, eventType: "ai_source_disabled" }])],
    ["unknown module", page([{ ...auditEvent, producerModule: "BILLING" }])],
    ["unknown result", page([{ ...auditEvent, result: "OK" }])],
    ["local time", page([{ ...auditEvent, occurredAt: "2026-11-26T10:00:00+01:00" }])],
    ["negative version", page([{ ...auditEvent, resourceVersion: -1 }])],
    ["non-string metadata", page([{ ...auditEvent, metadata: { previousStatus: 1 } }])],
    ["array metadata", page([{ ...auditEvent, metadata: [] }])],
  ])("rejects %s", (_name, body) => {
    expect(() => parseAuditEventPage(body, 0, 50)).toThrow(AuditContractError);
  });

  it("accepts null actor and version where the contract allows them", () => {
    const nullable = { ...auditEvent, actorId: null, resourceVersion: null };
    expect(parseAuditEventPage(page([nullable]), 0, 50).items[0]).toEqual(nullable);
  });

  it("converts UTC input values to RFC 3339 instants", () => {
    expect(utcInputToInstant("2026-11-26T10:30")).toBe("2026-11-26T10:30:00Z");
    expect(utcInputToInstant("2026-11-26T10:30:15")).toBe("2026-11-26T10:30:15Z");
    expect(utcInputToInstant("2026-02-30T10:30")).toBeNull();
    expect(utcInputToInstant("2026-11-26")).toBeNull();
    expect(utcInputToInstant("")).toBeNull();
  });
});
