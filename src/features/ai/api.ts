import { ApiError } from "@/features/auth/api";

export type AiSource = {
  sourceId: string;
  name: string;
  mediaType: "text/plain";
  sizeBytes: number;
  sha256: string;
  status: "PENDING" | "INDEXING" | "READY" | "FAILED" | "DISABLED";
  version: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type AiSourcePage = {
  items: AiSource[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class AiSourceContractError extends Error {
  constructor() {
    super("La respuesta de AI no cumple el contrato esperado.");
  }
}

export async function createAiSource(
  name: string,
  file: File,
  csrfToken: string,
): Promise<AiSource> {
  const body = new FormData();
  body.append("name", name);
  body.append("file", file);
  return parseAiSource(await read(await fetch(`${apiUrl}/ai/sources`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
    body,
  })));
}

export async function listAiSources(page: number, size = 20): Promise<AiSourcePage> {
  return parseAiSourcePage(await read(await fetch(
    `${apiUrl}/ai/sources?page=${page}&size=${size}`,
    { credentials: "include" },
  )), page, size);
}

export async function getAiSource(sourceId: string): Promise<AiSource> {
  return parseAiSource(await read(await fetch(
    `${apiUrl}/ai/sources/${encodeURIComponent(sourceId)}`,
    { credentials: "include" },
  )));
}

export async function indexAiSource(
  sourceId: string,
  expectedVersion: number,
  csrfToken: string,
): Promise<AiSource> {
  const response = await fetch(
    `${apiUrl}/ai/sources/${encodeURIComponent(sourceId)}/index`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ expectedVersion }),
    },
  );
  if (response.status !== 202) {
    if (!response.ok) await read(response);
    throw new AiSourceContractError();
  }
  const accepted = parseAiSource(await read(response));
  if (accepted.sourceId.toLowerCase() !== sourceId.toLowerCase()
      || accepted.status !== "INDEXING"
      || accepted.version !== expectedVersion + 1) {
    throw new AiSourceContractError();
  }
  return accepted;
}

export function parseAiSource(value: unknown): AiSource {
  if (!isRecord(value)) throw new AiSourceContractError();
  const keys = new Set([
    "sourceId", "name", "mediaType", "sizeBytes", "sha256", "status", "version",
    "createdByUserId", "createdAt", "updatedAt",
  ]);
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || typeof value.sourceId !== "string" || !UUID_V4.test(value.sourceId)
      || typeof value.name !== "string" || normalizeAiSourceName(value.name) !== value.name
      || [...value.name].length < 1 || [...value.name].length > 256
      || value.mediaType !== "text/plain"
      || !Number.isSafeInteger(value.sizeBytes)
      || (value.sizeBytes as number) < 0 || (value.sizeBytes as number) > 1_048_576
      || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)
      || !isAiSourceStatus(value.status) || !isNonNegativeInteger(value.version)
      || typeof value.createdByUserId !== "string" || !UUID_V4.test(value.createdByUserId)
      || !isDateTime(value.createdAt) || !isDateTime(value.updatedAt)) {
    throw new AiSourceContractError();
  }
  return value as AiSource;
}

export function parseAiSourcePage(value: unknown, expectedPage?: number, expectedSize?: number): AiSourcePage {
  if (!isRecord(value)) throw new AiSourceContractError();
  const keys = new Set(["items", "page", "size", "totalElements", "totalPages"]);
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || !Array.isArray(value.items)
      || !value.items.every(safelyParsesSource)
      || !isNonNegativeInteger(value.page)
      || !Number.isSafeInteger(value.size) || (value.size as number) < 1 || (value.size as number) > 50
      || value.items.length > (value.size as number)
      || !isNonNegativeInteger(value.totalElements)
      || !isNonNegativeInteger(value.totalPages)
      || value.totalPages !== Math.ceil((value.totalElements as number) / (value.size as number))
      || (expectedPage !== undefined && value.page !== expectedPage)
      || (expectedSize !== undefined && value.size !== expectedSize)) {
    throw new AiSourceContractError();
  }
  return { ...value, items: value.items.map(parseAiSource) } as AiSourcePage;
}

export function normalizeAiSourceName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

async function read(response: Response): Promise<unknown> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return response.json();
}

function safelyParsesSource(value: unknown) {
  try {
    parseAiSource(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isAiSourceStatus(value: unknown): value is AiSource["status"] {
  return value === "PENDING" || value === "INDEXING" || value === "READY"
    || value === "FAILED" || value === "DISABLED";
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_DATE_TIME.test(value)) return false;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.slice(0, 8).split(":").map(Number);
  const monthDays = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays
    && hour <= 23 && minute <= 59 && second <= 59;
}
