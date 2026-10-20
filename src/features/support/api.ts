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

export type TicketListItem = {
  ticketId: string;
  type: TicketType;
  summary: string;
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

export type TicketPage = {
  items: TicketListItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type TicketComment = {
  commentId: string;
  ticketId: string;
  visibility: "PUBLIC";
  authorUserId: string;
  body: string;
  createdAt: string;
};

export type TicketCommentPage = {
  items: TicketComment[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
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

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return response.json();
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

function parseTicketListItem(value: unknown, expectedRequesterUserId: string): TicketListItem {
  if (!isRecord(value)) throw new TicketContractError();
  const expected = new Set([
    "ticketId", "type", "summary", "status", "priority", "source", "requesterUserId",
    "createdByUserId", "assigneeUserId", "assetId", "createdAt", "updatedAt", "version",
  ]);
  if (Object.keys(value).length !== expected.size
      || Object.keys(value).some((key) => !expected.has(key))
      || !isUuid(value.ticketId)
      || !isTicketType(value.type)
      || !isText(value.summary, 256)
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
  return value as TicketListItem;
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

export async function listTickets(page: number, size: number, requesterUserId: string): Promise<TicketPage> {
  const value = await readJson(await fetch(`${apiUrl}/tickets?page=${page}&size=${size}`, {
    credentials: "include",
  }));
  return parseTicketPage(value, page, size, requesterUserId);
}

export async function listTicketComments(
  ticketId: string,
  page: number,
  size: number,
  requesterUserId: string,
): Promise<TicketCommentPage> {
  const value = await readJson(await fetch(
    `${apiUrl}/tickets/${encodeURIComponent(ticketId)}/comments?page=${page}&size=${size}`,
    { credentials: "include" },
  ));
  return parseTicketCommentPage(value, ticketId, page, size, requesterUserId);
}

export async function addTicketComment(
  ticketId: string,
  body: string,
  csrfToken: string,
  requesterUserId: string,
): Promise<TicketComment> {
  const value = await readJson(await fetch(`${apiUrl}/tickets/${encodeURIComponent(ticketId)}/comments`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ body }),
  }));
  return parseTicketComment(value, ticketId, requesterUserId);
}

export function parseTicketPage(
  value: unknown,
  expectedPage: number,
  expectedSize: number,
  expectedRequesterUserId: string,
): TicketPage {
  if (!isPage(value, expectedPage, expectedSize, 50)
      || !value.items.every((item) => isRecord(item))) {
    throw new TicketContractError();
  }
  const items = value.items.map((item) => parseTicketListItem(item, expectedRequesterUserId));
  if (!validPageContents(value, items.length, expectedPage, expectedSize)) {
    throw new TicketContractError();
  }
  return { ...value, items } as TicketPage;
}

export function parseTicketCommentPage(
  value: unknown,
  expectedTicketId: string,
  expectedPage: number,
  expectedSize: number,
  expectedRequesterUserId: string,
): TicketCommentPage {
  if (!isPage(value, expectedPage, expectedSize, 100)
      || !value.items.every((item) => isRecord(item))) {
    throw new TicketContractError();
  }
  const items = value.items.map((item) => parseTicketComment(
    item, expectedTicketId, expectedRequesterUserId,
  ));
  if (!validPageContents(value, items.length, expectedPage, expectedSize)) {
    throw new TicketContractError();
  }
  return { ...value, items } as TicketCommentPage;
}

function validPageContents(
  value: { totalElements: number; totalPages: number },
  itemCount: number,
  page: number,
  size: number,
) {
  const totalPages = Math.ceil(value.totalElements / size);
  if (value.totalPages !== totalPages) return false;
  const expectedItems = page >= totalPages
    ? 0
    : Math.min(size, value.totalElements - page * size);
  return itemCount === expectedItems;
}

function parseTicketComment(
  value: unknown,
  expectedTicketId: string,
  expectedRequesterUserId: string,
): TicketComment {
  if (!isRecord(value)) throw new TicketContractError();
  const expected = new Set([
    "commentId", "ticketId", "visibility", "authorUserId", "body", "createdAt",
  ]);
  if (Object.keys(value).length !== expected.size
      || Object.keys(value).some((key) => !expected.has(key))
      || !isUuid(value.commentId)
      || value.ticketId !== expectedTicketId
      || value.visibility !== "PUBLIC"
      || value.authorUserId !== expectedRequesterUserId
      || !isText(value.body, 10_000)
      || !isUtc(value.createdAt)) {
    throw new TicketContractError();
  }
  return value as TicketComment;
}

function isPage(
  value: unknown,
  expectedPage: number,
  expectedSize: number,
  maximumSize: number,
): value is Record<string, unknown> & {
  items: unknown[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
} {
  if (!isRecord(value)) return false;
  const expected = new Set(["items", "page", "size", "totalElements", "totalPages"]);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key))
    && Array.isArray(value.items)
    && value.page === expectedPage
    && Number.isInteger(value.page)
    && value.page >= 0
    && value.size === expectedSize
    && Number.isInteger(value.size)
    && value.size >= 1
    && value.size <= maximumSize
    && typeof value.totalElements === "number"
    && Number.isInteger(value.totalElements)
    && value.totalElements >= 0
    && typeof value.totalPages === "number"
    && Number.isInteger(value.totalPages)
    && value.totalPages >= 0;
}
