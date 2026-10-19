import { ApiError } from "@/features/auth/api";

export type TicketType = "INCIDENT" | "SERVICE_REQUEST" | "QUESTION" | "OTHER";

export type Ticket = {
  ticketId: string;
  type: TicketType;
  summary: string;
  description: string;
  status: "OPEN";
  priority: "NORMAL";
  source: "WEB";
  requesterUserId: string;
  createdByUserId: string;
  assigneeUserId: null;
  assetId: string | null;
  createdAt: string;
  updatedAt: string;
  version: 0;
};

export type TicketCreate = {
  type: TicketType;
  summary: string;
  description: string;
  assetId?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class TicketContractError extends Error {
  constructor() {
    super("La respuesta del ticket no cumple el contrato esperado.");
  }
}

async function readTicket(response: Response, expectedRequesterUserId: string): Promise<Ticket> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return parseTicket(await response.json(), expectedRequesterUserId);
}

export function parseTicket(value: unknown, expectedRequesterUserId: string): Ticket {
  if (!isRecord(value)) throw new TicketContractError();
  const expected = new Set([
    "ticketId", "type", "summary", "description", "status", "priority", "source",
    "requesterUserId", "createdByUserId", "assigneeUserId", "assetId", "createdAt",
    "updatedAt", "version",
  ]);
  if (Object.keys(value).length !== expected.size
      || Object.keys(value).some((key) => !expected.has(key))
      || !isUuid(value.ticketId)
      || !isTicketType(value.type)
      || !isText(value.summary, 256)
      || !isText(value.description, 10_000)
      || value.status !== "OPEN"
      || value.priority !== "NORMAL"
      || value.source !== "WEB"
      || !isUuid(value.requesterUserId)
      || value.requesterUserId !== expectedRequesterUserId
      || value.createdByUserId !== value.requesterUserId
      || value.assigneeUserId !== null
      || (value.assetId !== null && !isUuid(value.assetId))
      || !isUtc(value.createdAt)
      || !isUtc(value.updatedAt)
      || value.updatedAt !== value.createdAt
      || value.version !== 0) {
    throw new TicketContractError();
  }
  return value as Ticket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function isUtc(value: unknown): value is string {
  return typeof value === "string" && UTC_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isTicketType(value: unknown): value is TicketType {
  return value === "INCIDENT" || value === "SERVICE_REQUEST" || value === "QUESTION" || value === "OTHER";
}

export async function createTicket(
  ticket: TicketCreate,
  csrfToken: string,
  requesterUserId: string,
): Promise<Ticket> {
  return readTicket(await fetch(`${apiUrl}/tickets`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      type: ticket.type,
      summary: ticket.summary,
      description: ticket.description,
      ...(ticket.assetId ? { assetId: ticket.assetId } : {}),
    }),
  }), requesterUserId);
}

export async function getTicket(ticketId: string, requesterUserId: string): Promise<Ticket> {
  return readTicket(await fetch(`${apiUrl}/tickets/${encodeURIComponent(ticketId)}`, {
    credentials: "include",
  }), requesterUserId);
}
