import { ApiError } from "@/features/auth/api";

export type TicketType = "INCIDENT" | "SERVICE_REQUEST" | "QUESTION" | "OTHER";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_FOR_REQUESTER" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TicketCommentVisibility = "PUBLIC" | "INTERNAL";

export type Ticket = {
  ticketId: string;
  type: TicketType;
  summary: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: "WEB";
  requesterUserId: string;
  createdByUserId: string;
  assigneeUserId: string | null;
  assetId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type TicketListItem = {
  ticketId: string;
  type: TicketType;
  summary: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: "WEB";
  requesterUserId: string;
  createdByUserId: string;
  assigneeUserId: string | null;
  assetId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
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

export type TechnicianTicketComment = Omit<TicketComment, "visibility"> & {
  visibility: TicketCommentVisibility;
};

export type TechnicianTicketCommentPage = Omit<TicketCommentPage, "items"> & {
  items: TechnicianTicketComment[];
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
      || !isTicketStatus(value.status)
      || !isTicketPriority(value.priority)
      || value.source !== "WEB"
      || !isUuid(value.requesterUserId)
      || value.requesterUserId !== expectedRequesterUserId
      || value.createdByUserId !== value.requesterUserId
      || (value.assigneeUserId !== null && !isUuid(value.assigneeUserId))
      || (value.assetId !== null && !isUuid(value.assetId))
      || !isUtc(value.createdAt)
      || !isUtc(value.updatedAt)
      || Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)
      || !isVersion(value.version)) {
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
      || !isTicketStatus(value.status)
      || !isTicketPriority(value.priority)
      || value.source !== "WEB"
      || !isUuid(value.requesterUserId)
      || value.requesterUserId !== expectedRequesterUserId
      || value.createdByUserId !== value.requesterUserId
      || (value.assigneeUserId !== null && !isUuid(value.assigneeUserId))
      || (value.assetId !== null && !isUuid(value.assetId))
      || !isUtc(value.createdAt)
      || !isUtc(value.updatedAt)
      || Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)
      || !isVersion(value.version)) {
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

function isTicketStatus(value: unknown): value is TicketStatus {
  return value === "OPEN" || value === "IN_PROGRESS" || value === "WAITING_FOR_REQUESTER"
    || value === "RESOLVED" || value === "CLOSED";
}

function isTicketPriority(value: unknown): value is TicketPriority {
  return value === "LOW" || value === "NORMAL" || value === "HIGH" || value === "URGENT";
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

export async function listTechnicianQueue(
  page: number,
  size: number,
  technicianUserId: string,
): Promise<TicketPage> {
  const value = await readJson(await fetch(`${apiUrl}/tickets/technician-queue?page=${page}&size=${size}`, {
    credentials: "include",
  }));
  return parseTechnicianTicketPage(value, page, size, technicianUserId);
}

export async function getTechnicianTicket(ticketId: string, technicianUserId: string): Promise<Ticket> {
  const value = await readJson(await fetch(`${apiUrl}/tickets/technician-queue/${encodeURIComponent(ticketId)}`, {
    credentials: "include",
  }));
  return parseTechnicianTicket(value, technicianUserId);
}

export async function listTechnicianTicketComments(
  ticketId: string,
  page: number,
  size: number,
  technicianUserId: string,
): Promise<TicketCommentPage> {
  const value = await readJson(await fetch(
    `${apiUrl}/tickets/technician-queue/${encodeURIComponent(ticketId)}/comments?page=${page}&size=${size}`,
    { credentials: "include" },
  ));
  return parseTechnicianCommentPage(value, ticketId, page, size, technicianUserId);
}

export async function listTechnicianTicketConversation(
  ticketId: string,
  page: number,
  size: number,
  technicianUserId: string,
): Promise<TechnicianTicketCommentPage> {
  const value = await readJson(await fetch(
    `${apiUrl}/tickets/technician-queue/${encodeURIComponent(ticketId)}/conversation?page=${page}&size=${size}`,
    { credentials: "include" },
  ));
  return parseTechnicianConversationPage(value, ticketId, page, size, technicianUserId);
}

export async function addTechnicianTicketComment(
  ticketId: string,
  visibility: TicketCommentVisibility,
  body: string,
  csrfToken: string,
  technicianUserId: string,
): Promise<TechnicianTicketComment> {
  const value = await readJson(await fetch(
    `${apiUrl}/tickets/technician-queue/${encodeURIComponent(ticketId)}/conversation`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ visibility, body }),
    },
  ));
  const comment = parseTechnicianComment(value, ticketId);
  if (comment.authorUserId !== technicianUserId || comment.visibility !== visibility) {
    throw new TicketContractError();
  }
  return comment;
}

export async function claimTicket(
  ticketId: string,
  expectedVersion: number,
  csrfToken: string,
  technicianUserId: string,
): Promise<Ticket> {
  const value = await readJson(await fetch(`${apiUrl}/tickets/${encodeURIComponent(ticketId)}/claim`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ expectedVersion }),
  }));
  const ticket = parseTechnicianTicket(value, technicianUserId);
  if (ticket.assigneeUserId !== technicianUserId || ticket.version < expectedVersion) {
    throw new TicketContractError();
  }
  return ticket;
}

export async function updateTicketPriority(
  ticketId: string,
  currentPriority: TicketPriority,
  priority: TicketPriority,
  expectedVersion: number,
  csrfToken: string,
  technicianUserId: string,
): Promise<Ticket> {
  const value = await readJson(await fetch(`${apiUrl}/tickets/${encodeURIComponent(ticketId)}/priority`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ priority, expectedVersion }),
  }));
  const ticket = parseTechnicianTicket(value, technicianUserId);
  const expectedResponseVersion = expectedVersion + Number(priority !== currentPriority);
  if (ticket.ticketId !== ticketId
      || ticket.assigneeUserId !== technicianUserId
      || ticket.priority !== priority
      || ticket.version !== expectedResponseVersion) {
    throw new TicketContractError();
  }
  return ticket;
}

export async function updateTicketStatus(
  ticketId: string,
  currentStatus: TicketStatus,
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_REQUESTER",
  expectedVersion: number,
  csrfToken: string,
  technicianUserId: string,
): Promise<Ticket> {
  const value = await readJson(await fetch(`${apiUrl}/tickets/${encodeURIComponent(ticketId)}/status`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ status, expectedVersion }),
  }));
  const ticket = parseTechnicianTicket(value, technicianUserId);
  const expectedResponseVersion = expectedVersion + Number(status !== currentStatus);
  if (ticket.ticketId !== ticketId
      || ticket.assigneeUserId !== technicianUserId
      || ticket.status !== status
      || ticket.version !== expectedResponseVersion) {
    throw new TicketContractError();
  }
  return ticket;
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
  if (!isUuid(expectedRequesterUserId)
      || !isPage(value, expectedPage, expectedSize, 100)
      || !value.items.every((item) => isRecord(item))) {
    throw new TicketContractError();
  }
  const items = value.items.map((item) => parsePublicComment(item, expectedTicketId));
  if (!validPageContents(value, items.length, expectedPage, expectedSize)) {
    throw new TicketContractError();
  }
  return { ...value, items } as TicketCommentPage;
}

export function parseTechnicianTicketPage(
  value: unknown,
  expectedPage: number,
  expectedSize: number,
  technicianUserId: string,
): TicketPage {
  if (!isPage(value, expectedPage, expectedSize, 50)
      || !value.items.every((item) => isRecord(item))) {
    throw new TicketContractError();
  }
  const items = value.items.map((item) => parseTechnicianListItem(item, technicianUserId));
  if (!validPageContents(value, items.length, expectedPage, expectedSize)) {
    throw new TicketContractError();
  }
  return { ...value, items } as TicketPage;
}

export function parseTechnicianTicket(value: unknown, technicianUserId: string): Ticket {
  const ticket = parseGeneralTicket(value);
  if (ticket.status === "CLOSED"
      || (ticket.assigneeUserId !== null && ticket.assigneeUserId !== technicianUserId)) {
    throw new TicketContractError();
  }
  return ticket;
}

function parseTechnicianListItem(value: unknown, technicianUserId: string): TicketListItem {
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
      || !isTicketStatus(value.status)
      || value.status === "CLOSED"
      || !isTicketPriority(value.priority)
      || value.source !== "WEB"
      || !isUuid(value.requesterUserId)
      || value.createdByUserId !== value.requesterUserId
      || (value.assigneeUserId !== null && value.assigneeUserId !== technicianUserId)
      || (value.assetId !== null && !isUuid(value.assetId))
      || !isUtc(value.createdAt)
      || !isUtc(value.updatedAt)
      || Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)
      || !isVersion(value.version)) {
    throw new TicketContractError();
  }
  return value as TicketListItem;
}

function parseGeneralTicket(value: unknown): Ticket {
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
      || !isTicketStatus(value.status)
      || !isTicketPriority(value.priority)
      || value.source !== "WEB"
      || !isUuid(value.requesterUserId)
      || value.createdByUserId !== value.requesterUserId
      || (value.assigneeUserId !== null && !isUuid(value.assigneeUserId))
      || (value.assetId !== null && !isUuid(value.assetId))
      || !isUtc(value.createdAt)
      || !isUtc(value.updatedAt)
      || Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)
      || !isVersion(value.version)) {
    throw new TicketContractError();
  }
  return value as Ticket;
}

function parseTechnicianCommentPage(
  value: unknown,
  expectedTicketId: string,
  expectedPage: number,
  expectedSize: number,
  technicianUserId: string,
): TicketCommentPage {
  if (!isUuid(technicianUserId)
      || !isPage(value, expectedPage, expectedSize, 100)
      || !value.items.every((item) => isRecord(item))) {
    throw new TicketContractError();
  }
  const items = value.items.map((item) => parsePublicComment(item, expectedTicketId));
  if (!validPageContents(value, items.length, expectedPage, expectedSize)) {
    throw new TicketContractError();
  }
  return { ...value, items } as TicketCommentPage;
}

export function parseTechnicianConversationPage(
  value: unknown,
  expectedTicketId: string,
  expectedPage: number,
  expectedSize: number,
  technicianUserId: string,
): TechnicianTicketCommentPage {
  if (!isUuid(technicianUserId)
      || !isPage(value, expectedPage, expectedSize, 100)
      || !value.items.every((item) => isRecord(item))) {
    throw new TicketContractError();
  }
  const items = value.items.map((item) => parseTechnicianComment(item, expectedTicketId));
  if (!validPageContents(value, items.length, expectedPage, expectedSize)) {
    throw new TicketContractError();
  }
  return { ...value, items } as TechnicianTicketCommentPage;
}

function parsePublicComment(value: unknown, expectedTicketId: string): TicketComment {
  if (!isRecord(value)) throw new TicketContractError();
  const expected = new Set([
    "commentId", "ticketId", "visibility", "authorUserId", "body", "createdAt",
  ]);
  if (Object.keys(value).length !== expected.size
      || Object.keys(value).some((key) => !expected.has(key))
      || !isUuid(value.commentId)
      || value.ticketId !== expectedTicketId
      || value.visibility !== "PUBLIC"
      || !isUuid(value.authorUserId)
      || !isText(value.body, 10_000)
      || !isUtc(value.createdAt)) {
    throw new TicketContractError();
  }
  return value as TicketComment;
}

function parseTechnicianComment(value: unknown, expectedTicketId: string): TechnicianTicketComment {
  if (!isRecord(value)) throw new TicketContractError();
  const expected = new Set([
    "commentId", "ticketId", "visibility", "authorUserId", "body", "createdAt",
  ]);
  if (Object.keys(value).length !== expected.size
      || Object.keys(value).some((key) => !expected.has(key))
      || !isUuid(value.commentId)
      || value.ticketId !== expectedTicketId
      || (value.visibility !== "PUBLIC" && value.visibility !== "INTERNAL")
      || !isUuid(value.authorUserId)
      || !isText(value.body, 10_000)
      || !isUtc(value.createdAt)) {
    throw new TicketContractError();
  }
  return value as TechnicianTicketComment;
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
