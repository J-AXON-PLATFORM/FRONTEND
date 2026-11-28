import { ApiError } from "@/features/auth/api";

export const NOTIFICATION_STATUSES = ["UNREAD", "READ"] as const;
export const NOTIFICATION_SIZES = [20, 50] as const;
export const NOTIFICATION_DEFAULT_SIZE = 20;

export type NotificationStatus = typeof NOTIFICATION_STATUSES[number];

export type Notification = {
  notificationId: string;
  type: "TICKET_WAITING_FOR_REQUESTER";
  resourceType: "TICKET";
  resourceId: string;
  status: NotificationStatus;
  version: number;
  createdAt: string;
  readAt: string | null;
};

export type NotificationPage = {
  items: Notification[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type NotificationFilters = {
  status?: NotificationStatus;
  page: number;
  size: number;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const NOTIFICATION_KEYS = [
  "notificationId", "type", "resourceType", "resourceId",
  "status", "version", "createdAt", "readAt",
];

export class NotificationContractError extends Error {
  constructor() {
    super("La respuesta de notificaciones no cumple el contrato esperado.");
  }
}

export function notificationQueryString(filters: NotificationFilters): string {
  const parameters = new URLSearchParams();
  if (filters.status) parameters.set("status", filters.status);
  parameters.set("page", String(filters.page));
  parameters.set("size", String(filters.size));
  return parameters.toString();
}

export async function listNotifications(filters: NotificationFilters): Promise<NotificationPage> {
  const response = await fetch(`${apiUrl}/notifications?${notificationQueryString(filters)}`, {
    credentials: "include",
  });
  if (!response.ok) throw await notificationApiError(response);
  if (response.status !== 200) throw new NotificationContractError();
  return parseNotificationPage(await response.json(), filters.page, filters.size);
}

export async function markNotificationRead(
  notificationId: string,
  expectedVersion: number,
  csrfToken: string,
): Promise<Notification> {
  const response = await fetch(`${apiUrl}/notifications/${notificationId}/read`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ expectedVersion }),
  });
  if (!response.ok) throw await notificationApiError(response);
  if (response.status !== 200) throw new NotificationContractError();
  return parseNotification(await response.json());
}

export function parseNotificationPage(
  value: unknown,
  expectedPage: number,
  expectedSize: number,
): NotificationPage {
  if (!isRecord(value)) throw new NotificationContractError();
  const keys = ["items", "page", "size", "totalElements", "totalPages"];
  if (Object.keys(value).length !== keys.length
      || Object.keys(value).some((key) => !keys.includes(key))
      || value.page !== expectedPage
      || value.size !== expectedSize
      || !Array.isArray(value.items)
      || value.items.length > expectedSize
      || !isNonNegativeInteger(value.totalElements)
      || !isNonNegativeInteger(value.totalPages)
      || value.totalPages !== Math.ceil((value.totalElements as number) / expectedSize)
      || value.items.length > (value.totalElements as number)) {
    throw new NotificationContractError();
  }
  const items = value.items.map(parseNotification);
  if (new Set(items.map((item) => item.notificationId)).size !== items.length) {
    throw new NotificationContractError();
  }
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    const previousTime = Date.parse(previous.createdAt);
    const currentTime = Date.parse(current.createdAt);
    if (previousTime < currentTime
        || (previousTime === currentTime
          && previous.notificationId.toLowerCase() <= current.notificationId.toLowerCase())) {
      throw new NotificationContractError();
    }
  }
  return {
    items,
    page: expectedPage,
    size: expectedSize,
    totalElements: value.totalElements as number,
    totalPages: value.totalPages as number,
  };
}

export function parseNotification(value: unknown): Notification {
  if (!isRecord(value)
      || Object.keys(value).length !== NOTIFICATION_KEYS.length
      || Object.keys(value).some((key) => !NOTIFICATION_KEYS.includes(key))
      || !isUuid(value.notificationId)
      || value.type !== "TICKET_WAITING_FOR_REQUESTER"
      || value.resourceType !== "TICKET"
      || !isUuid(value.resourceId)
      || !(NOTIFICATION_STATUSES as readonly unknown[]).includes(value.status)
      || !isNonNegativeInteger(value.version)
      || !isDateTime(value.createdAt)
      || !(value.readAt === null || isDateTime(value.readAt))) {
    throw new NotificationContractError();
  }
  if ((value.status === "UNREAD" && (value.version !== 0 || value.readAt !== null))
      || (value.status === "READ" && (value.version !== 1 || value.readAt === null))) {
    throw new NotificationContractError();
  }
  return value as Notification;
}

async function notificationApiError(response: Response): Promise<ApiError> {
  const problem = response.headers.get("content-type")?.includes("application/problem+json")
    ? await response.json() as { code: string; correlationId: string; detail?: string }
    : undefined;
  return new ApiError(response.status, problem);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && UTC_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}
