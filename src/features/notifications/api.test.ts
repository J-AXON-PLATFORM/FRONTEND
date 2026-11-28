import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationContractError,
  listNotifications,
  markNotificationRead,
  notificationQueryString,
  parseNotification,
  parseNotificationPage,
} from "./api";

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

function page(items: unknown[], overrides: Record<string, unknown> = {}) {
  return { items, page: 0, size: 20, totalElements: items.length, totalPages: items.length ? 1 : 0, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Notifications API", () => {
  it("builds only the closed list parameters", () => {
    expect(notificationQueryString({ status: "UNREAD", page: 2, size: 50 }))
      .toBe("status=UNREAD&page=2&size=50");
    expect(notificationQueryString({ page: 0, size: 20 })).toBe("page=0&size=20");
  });

  it("accepts exact unread and read states", () => {
    expect(parseNotification(unread)).toEqual(unread);
    const read = { ...unread, status: "READ", version: 1, readAt: "2026-12-02T12:01:00Z" };
    expect(parseNotification(read)).toEqual(read);
  });

  it.each([
    ["extra property", { ...unread, recipientUserId: unread.resourceId }],
    ["unknown type", { ...unread, type: "OTHER" }],
    ["unknown resource", { ...unread, resourceType: "ASSET" }],
    ["invalid UUID", { ...unread, notificationId: "not-a-uuid" }],
    ["invalid UTC timestamp", { ...unread, createdAt: "2026-12-02T12:00:00+01:00" }],
    ["unread with version one", { ...unread, version: 1 }],
    ["unread with read timestamp", { ...unread, readAt: "2026-12-02T12:01:00Z" }],
    ["read without timestamp", { ...unread, status: "READ", version: 1 }],
  ])("rejects %s", (_name, body) => {
    expect(() => parseNotification(body)).toThrow(NotificationContractError);
  });

  it("validates exact pagination, totals, uniqueness and descending order", () => {
    const earlier = {
      ...unread,
      notificationId: "04844482-1d29-4d30-87fd-1bb67a22e050",
      createdAt: "2026-12-02T11:00:00Z",
    };
    expect(parseNotificationPage(page([unread, earlier]), 0, 20).items).toHaveLength(2);
    expect(() => parseNotificationPage(page([earlier, unread]), 0, 20))
      .toThrow(NotificationContractError);
    expect(() => parseNotificationPage(page([unread, unread]), 0, 20))
      .toThrow(NotificationContractError);
    expect(() => parseNotificationPage(page([unread], { totalPages: 2 }), 0, 20))
      .toThrow(NotificationContractError);
    expect(() => parseNotificationPage({ ...page([unread]), extra: true }, 0, 20))
      .toThrow(NotificationContractError);
  });

  it("lists own notifications with credentials and validates the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(page([unread])), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listNotifications({ status: "UNREAD", page: 0, size: 20 }))
      .resolves.toEqual(page([unread]));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/notifications?status=UNREAD&page=0&size=20",
      { credentials: "include" },
    );
  });

  it("marks read with exact version and in-memory CSRF", async () => {
    const read = { ...unread, status: "READ", version: 1, readAt: "2026-12-02T12:01:00Z" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(read), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(markNotificationRead(unread.notificationId, 0, "csrf-token")).resolves.toEqual(read);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/notifications/${unread.notificationId}/read`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" },
        body: JSON.stringify({ expectedVersion: 0 }),
      },
    );
  });

  it("preserves RFC 9457 conflicts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "NOTIFICATION_VERSION_CONFLICT",
      correlationId: unread.resourceId,
    }), { status: 409, headers: { "Content-Type": "application/problem+json" } })));
    await expect(markNotificationRead(unread.notificationId, 0, "csrf-token"))
      .rejects.toMatchObject({ status: 409, problem: { code: "NOTIFICATION_VERSION_CONFLICT" } });
  });
});
