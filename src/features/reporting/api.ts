import { ApiError } from "@/features/auth/api";

export const REPORT_TYPES = ["assets", "agents", "tickets"] as const;
export const REPORT_SIZES = [25, 50, 100, 200] as const;
export const ASSET_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const AGENT_STATUSES = ["PENDING", "ACTIVE"] as const;
export const OPERATIONAL_STATUSES = ["UNKNOWN", "ONLINE", "OFFLINE"] as const;
export const TICKET_TYPES = ["INCIDENT", "SERVICE_REQUEST", "QUESTION", "OTHER"] as const;
export const TICKET_STATUSES = [
  "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED",
] as const;
export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const REPORT_DEFAULT_SIZE = 50;

export type ReportType = typeof REPORT_TYPES[number];

export type ReportFilters = {
  report: ReportType;
  status?: string;
  assetType?: string;
  operationalStatus?: string;
  assetId?: string;
  type?: string;
  priority?: string;
  requesterUserId?: string;
  assigneeUserId?: string;
  createdFrom?: string;
  createdTo?: string;
  page: number;
  size: number;
};

export type AssetReportRow = {
  assetId: string;
  name: string;
  assetType: string;
  status: typeof ASSET_STATUSES[number];
  createdAt: string;
  updatedAt: string;
};

export type AgentReportRow = {
  agentId: string;
  assetId: string;
  status: typeof AGENT_STATUSES[number];
  operationalStatus: typeof OPERATIONAL_STATUSES[number];
  lastSeenAt: string | null;
  lastSnapshotAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TicketReportRow = {
  ticketId: string;
  type: typeof TICKET_TYPES[number];
  summary: string;
  status: typeof TICKET_STATUSES[number];
  priority: typeof TICKET_PRIORITIES[number];
  source: "WEB";
  requesterUserId: string;
  createdByUserId: string;
  assigneeUserId: string | null;
  assetId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportRow = AssetReportRow | AgentReportRow | TicketReportRow;

export type ReportPage = {
  items: ReportRow[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ASSET_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const PAGE_KEYS = ["items", "page", "size", "totalElements", "totalPages"];
const ROW_KEYS = {
  assets: ["assetId", "name", "assetType", "status", "createdAt", "updatedAt"],
  agents: [
    "agentId", "assetId", "status", "operationalStatus", "lastSeenAt", "lastSnapshotAt", "createdAt", "updatedAt",
  ],
  tickets: [
    "ticketId", "type", "summary", "status", "priority", "source", "requesterUserId", "createdByUserId",
    "assigneeUserId", "assetId", "createdAt", "updatedAt",
  ],
} as const;
const FILENAMES: Record<ReportType, string> = {
  assets: "assets-report.csv",
  agents: "agents-report.csv",
  tickets: "tickets-report.csv",
};

export class ReportContractError extends Error {
  constructor(message = "La respuesta de Reporting no cumple el contrato esperado.") {
    super(message);
  }
}

export function reportQueryString(filters: ReportFilters, exportCsv = false): string {
  const params = new URLSearchParams();
  const append = (name: string, value: string | undefined) => {
    if (value !== undefined && value !== "") params.append(name, value);
  };
  if (filters.report === "assets") {
    append("status", filters.status);
    append("assetType", filters.assetType);
  } else if (filters.report === "agents") {
    append("status", filters.status);
    append("operationalStatus", filters.operationalStatus);
    append("assetId", filters.assetId);
  } else {
    append("type", filters.type);
    append("status", filters.status);
    append("priority", filters.priority);
    append("requesterUserId", filters.requesterUserId);
    append("assigneeUserId", filters.assigneeUserId);
    append("assetId", filters.assetId);
  }
  append("createdFrom", filters.createdFrom);
  append("createdTo", filters.createdTo);
  if (!exportCsv) {
    params.append("page", String(filters.page));
    params.append("size", String(filters.size));
  }
  return params.toString();
}

export async function listReport(filters: ReportFilters): Promise<ReportPage> {
  const response = await fetch(`${apiUrl}/reports/${filters.report}?${reportQueryString(filters)}`, {
    credentials: "include",
  });
  if (!response.ok) throw await reportApiError(response);
  if (response.status !== 200
      || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new ReportContractError();
  }
  return parseReportPage(await response.json(), filters.report, filters.page, filters.size);
}

export async function downloadReportCsv(filters: ReportFilters): Promise<void> {
  const query = reportQueryString(filters, true);
  const response = await fetch(`${apiUrl}/reports/${filters.report}/export${query ? `?${query}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) throw await reportApiError(response);
  const filename = FILENAMES[filters.report];
  const contentType = response.headers.get("content-type")?.replace(/\s/g, "").toLowerCase();
  const disposition = response.headers.get("content-disposition");
  if (response.status !== 200
      || contentType !== "text/csv;charset=utf-8"
      || (disposition !== null && disposition !== `attachment; filename="${filename}"`)) {
    throw new ReportContractError("La exportación no cumple el contrato CSV esperado.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function parseReportPage(
  value: unknown,
  report: ReportType,
  expectedPage: number,
  expectedSize: number,
): ReportPage {
  if (!isExactRecord(value, PAGE_KEYS)
      || value.page !== expectedPage
      || value.size !== expectedSize
      || !Array.isArray(value.items)
      || value.items.length > expectedSize
      || !isNonNegativeInteger(value.totalElements)
      || !isNonNegativeInteger(value.totalPages)
      || value.totalPages !== Math.ceil((value.totalElements as number) / expectedSize)
      || value.items.length > (value.totalElements as number)) {
    throw new ReportContractError();
  }
  const items = value.items.map((item) => parseReportRow(item, report));
  const id = report === "assets" ? "assetId" : report === "agents" ? "agentId" : "ticketId";
  const ids = items.map((item) => String(item[id as keyof ReportRow]).toLowerCase());
  if (new Set(ids).size !== ids.length) throw new ReportContractError();
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    const previousTime = Date.parse(previous.createdAt);
    const currentTime = Date.parse(current.createdAt);
    const previousId = String(previous[id as keyof ReportRow]).toLowerCase();
    const currentId = String(current[id as keyof ReportRow]).toLowerCase();
    if (previousTime < currentTime || (previousTime === currentTime && previousId <= currentId)) {
      throw new ReportContractError();
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

export function parseReportRow(value: unknown, report: ReportType): ReportRow {
  if (!isExactRecord(value, [...ROW_KEYS[report]])) throw new ReportContractError();
  if (report === "assets") {
    if (!isUuid(value.assetId)
        || !isBoundedText(value.name, 1, 256)
        || !isAssetType(value.assetType)
        || !isOneOf(value.status, ASSET_STATUSES)
        || !isDateTime(value.createdAt)
        || !isDateTime(value.updatedAt)) {
      throw new ReportContractError();
    }
    return value as AssetReportRow;
  }
  if (report === "agents") {
    if (!isUuid(value.agentId)
        || !isUuid(value.assetId)
        || !isOneOf(value.status, AGENT_STATUSES)
        || !isOneOf(value.operationalStatus, OPERATIONAL_STATUSES)
        || !isNullableDateTime(value.lastSeenAt)
        || !isNullableDateTime(value.lastSnapshotAt)
        || !isDateTime(value.createdAt)
        || !isDateTime(value.updatedAt)) {
      throw new ReportContractError();
    }
    return value as AgentReportRow;
  }
  if (!isUuid(value.ticketId)
      || !isOneOf(value.type, TICKET_TYPES)
      || !isBoundedText(value.summary, 1, 256)
      || !isOneOf(value.status, TICKET_STATUSES)
      || !isOneOf(value.priority, TICKET_PRIORITIES)
      || value.source !== "WEB"
      || !isUuid(value.requesterUserId)
      || !isUuid(value.createdByUserId)
      || !(value.assigneeUserId === null || isUuid(value.assigneeUserId))
      || !(value.assetId === null || isUuid(value.assetId))
      || !isDateTime(value.createdAt)
      || !isDateTime(value.updatedAt)) {
    throw new ReportContractError();
  }
  return value as TicketReportRow;
}

export function utcInputToInstant(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const instant = `${value.length === 16 ? `${value}:00` : value}Z`;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== instant.slice(0, 19)) return null;
  return instant;
}

export function instantToUtcInput(value: string | undefined): string {
  return value?.slice(0, 19) ?? "";
}

async function reportApiError(response: Response): Promise<ApiError> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/problem+json")) {
    return new ApiError(response.status);
  }
  const value: unknown = await response.json();
  if (!isRecord(value)
      || typeof value.code !== "string"
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(value.code)
      || !isUuid(value.correlationId)
      || !(value.detail === undefined || typeof value.detail === "string")) {
    return new ApiError(response.status);
  }
  return new ApiError(response.status, {
    code: value.code,
    correlationId: value.correlationId,
    ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
  });
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function isAssetType(value: unknown): value is string {
  return typeof value === "string" && ASSET_TYPE.test(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && UTC_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isDateTime(value);
}

function isBoundedText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
