import { ApiError } from "@/features/auth/api";

export const AUDIT_MODULES = [
  "INVENTORY", "DISCOVERY", "COLLECTOR", "SUPPORT", "AI", "IDENTITY", "AUTOMATION", "AUDIT_REPORTING",
] as const;
export const AUDIT_RESULTS = ["SUCCESS", "DENIED", "FAILED"] as const;
export const AUDIT_ACTOR_TYPES = ["HUMAN_USER", "SYSTEM", "AGENT", "DISCOVERY_EXECUTOR", "AUTOMATION"] as const;
export const AUDIT_DEFAULT_SIZE = 50;
export const AUDIT_MAX_SIZE = 200;

export type AuditModule = typeof AUDIT_MODULES[number];
export type AuditResult = typeof AUDIT_RESULTS[number];

export type AuditEvent = {
  auditEventId: string;
  sourceEventId: string;
  eventType: string;
  eventVersion: string;
  producerModule: AuditModule;
  occurredAt: string;
  recordedAt: string;
  actorType: typeof AUDIT_ACTOR_TYPES[number];
  actorId: string | null;
  resourceType: string;
  resourceId: string;
  resourceVersion: number | null;
  result: AuditResult;
  correlationId: string;
  metadata: Record<string, string>;
};

export type AuditEventPage = {
  items: AuditEvent[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type AuditFilters = {
  from?: string;
  to?: string;
  module?: AuditModule;
  eventType?: string;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  result?: AuditResult;
  correlationId?: string;
  page: number;
  size: number;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const AUDIT_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const FILTER_KEYS = [
  "from", "to", "module", "eventType", "actorId", "resourceType", "resourceId", "result", "correlationId",
] as const;
const EVENT_KEYS = [
  "auditEventId", "sourceEventId", "eventType", "eventVersion", "producerModule", "occurredAt", "recordedAt",
  "actorType", "actorId", "resourceType", "resourceId", "resourceVersion", "result", "correlationId", "metadata",
];

export class AuditContractError extends Error {
  constructor() {
    super("La respuesta de auditoría no cumple el contrato esperado.");
  }
}

export function auditQueryString(filters: AuditFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined && value !== "") params.append(key, value);
  }
  params.append("page", String(filters.page));
  params.append("size", String(filters.size));
  return params.toString();
}

export async function listAuditEvents(filters: AuditFilters): Promise<AuditEventPage> {
  const response = await fetch(`${apiUrl}/audit/events?${auditQueryString(filters)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  if (response.status !== 200) throw new AuditContractError();
  return parseAuditEventPage(await response.json(), filters.page, filters.size);
}

export function parseAuditEventPage(value: unknown, expectedPage: number, expectedSize: number): AuditEventPage {
  if (!isRecord(value)) throw new AuditContractError();
  const keys = ["items", "page", "size", "totalElements", "totalPages"];
  if (Object.keys(value).length !== keys.length
      || Object.keys(value).some((key) => !keys.includes(key))
      || value.page !== expectedPage || value.size !== expectedSize
      || !Array.isArray(value.items)
      || value.items.length > expectedSize
      || !isNonNegativeInteger(value.totalElements)
      || !isNonNegativeInteger(value.totalPages)
      || value.totalPages !== Math.ceil((value.totalElements as number) / expectedSize)
      || value.items.length > (value.totalElements as number)) {
    throw new AuditContractError();
  }
  const items = value.items.map(parseAuditEvent);
  if (new Set(items.map((item) => item.auditEventId)).size !== items.length) throw new AuditContractError();
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    const previousTime = Date.parse(previous.occurredAt);
    const currentTime = Date.parse(current.occurredAt);
    if (previousTime < currentTime
        || (previousTime === currentTime
          && previous.auditEventId.toLowerCase() <= current.auditEventId.toLowerCase())) {
      throw new AuditContractError();
    }
  }
  return { items, page: expectedPage, size: expectedSize, totalElements: value.totalElements as number,
    totalPages: value.totalPages as number };
}

export function parseAuditEvent(value: unknown): AuditEvent {
  if (!isRecord(value)
      || Object.keys(value).length !== EVENT_KEYS.length
      || Object.keys(value).some((key) => !EVENT_KEYS.includes(key))
      || !isUuid(value.auditEventId) || !isUuid(value.sourceEventId)
      || !isCode(value.eventType)
      || typeof value.eventVersion !== "string" || !/^\d+\.\d+$/.test(value.eventVersion)
      || !(AUDIT_MODULES as readonly unknown[]).includes(value.producerModule)
      || !isDateTime(value.occurredAt) || !isDateTime(value.recordedAt)
      || !(AUDIT_ACTOR_TYPES as readonly unknown[]).includes(value.actorType)
      || !(value.actorId === null || isUuid(value.actorId))
      || !isCode(value.resourceType) || !isUuid(value.resourceId)
      || !(value.resourceVersion === null || isNonNegativeInteger(value.resourceVersion))
      || !(AUDIT_RESULTS as readonly unknown[]).includes(value.result)
      || !isUuid(value.correlationId)
      || !isMetadata(value.metadata)) {
    throw new AuditContractError();
  }
  return value as AuditEvent;
}

export function utcInputToInstant(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const instant = `${value.length === 16 ? `${value}:00` : value}Z`;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== instant.slice(0, 19)) return null;
  return instant;
}

function isMetadata(value: unknown): value is Record<string, string> {
  return isRecord(value)
    && Object.keys(value).length <= 16
    && Object.entries(value).every(([key, item]) => /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)
      && typeof item === "string" && item.length <= 256);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function isCode(value: unknown): value is string {
  return typeof value === "string" && AUDIT_CODE.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && UTC_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}
