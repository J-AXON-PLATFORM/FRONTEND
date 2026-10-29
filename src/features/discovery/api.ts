import { ApiError } from "@/features/auth/api";

export type AuthorizedScopeStatus = "ACTIVE" | "DISABLED";

export type AuthorizedScope = {
  scopeId: string;
  name: string;
  cidr: string;
  status: AuthorizedScopeStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type AuthorizedScopePage = {
  items: AuthorizedScope[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type DiscoveryExecutor = {
  executorId: string;
  name: string;
  scopeIds: string[];
  status: "PENDING" | "ACTIVE";
  publicKeyRegistered: boolean;
  publicKeyFingerprint: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  version: 0 | 1;
};

export type DiscoveryExecutorConnection = {
  host: string;
  port: number;
  username: string;
  hostKey: string;
  hostKeyFingerprint: string;
};

export type DiscoveryExecutorPage = {
  items: DiscoveryExecutor[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type DiscoveryJobStatus =
  | "PENDING" | "DISPATCHED" | "RUNNING" | "SUCCEEDED"
  | "FAILED" | "EXPIRED" | "CANCELLED";

export type DiscoveryJob = {
  jobId: string;
  executorId: string;
  scopeId: string;
  profile: "BASIC";
  status: DiscoveryJobStatus;
  createdAt: string;
  expiresAt: string;
  dispatchedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failureCode: DiscoveryFailureCode | null;
  summary: DiscoveryResultSummary | null;
  version: number;
};

export type DiscoveryFailureCode =
  | "JOB_EXPIRED" | "SCOPE_TOO_LARGE" | "UNSUPPORTED_PLATFORM"
  | "EXECUTION_INTERRUPTED" | "EXECUTION_ERROR";

export type DiscoveryResultSummary = {
  targetsConsidered: number;
  targetsScanned: number;
  observationsFound: number;
};

export type DiscoveredDevice = {
  discoveredDeviceId: string;
  jobId: string;
  status: "UNREVIEWED" | "IGNORED" | "INCORPORATED";
  assetId: string | null;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  evidence: Array<"ARP" | "ICMP" | "TCP">;
  openTcpPorts: Array<22 | 53 | 80 | 443 | 445 | 3389>;
  observedAt: string;
  version: 0 | 1;
  reviewedAt: string | null;
};

export type DiscoveredDevicePage = {
  items: DiscoveredDevice[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class AuthorizedScopeContractError extends Error {
  constructor() {
    super("La respuesta de Discovery no cumple el contrato esperado.");
  }
}

export class DiscoveryExecutorContractError extends Error {
  constructor() {
    super("La respuesta del Discovery Executor no cumple el contrato esperado.");
  }
}

export class DiscoveryJobContractError extends Error {
  constructor() {
    super("La respuesta del Discovery Job no cumple el contrato esperado.");
  }
}

export class DiscoveredDeviceContractError extends Error {
  constructor() {
    super("La respuesta de dispositivos descubiertos no cumple el contrato esperado.");
  }
}

export async function listAuthorizedScopes(page: number, size = 20): Promise<AuthorizedScopePage> {
  return parseAuthorizedScopePage(await read(await fetch(
    `${apiUrl}/discovery/scopes?page=${page}&size=${size}`,
    { credentials: "include" },
  )));
}

export async function listAllAuthorizedScopes(): Promise<AuthorizedScope[]> {
  const first = await listAuthorizedScopes(0, 50);
  const remaining = await Promise.all(Array.from(
    { length: Math.max(0, first.totalPages - 1) },
    (_, index) => listAuthorizedScopes(index + 1, 50),
  ));
  return [first, ...remaining].flatMap((page) => page.items);
}

export async function listDiscoveryExecutors(page: number): Promise<DiscoveryExecutorPage> {
  return parseDiscoveryExecutorPage(await read(await fetch(
    `${apiUrl}/discovery/executors?page=${page}&size=20`,
    { credentials: "include" },
  )));
}

export async function listAllDiscoveryExecutors(): Promise<DiscoveryExecutor[]> {
  const first = await listDiscoveryExecutors(0);
  const remaining = await Promise.all(Array.from(
    { length: Math.max(0, first.totalPages - 1) },
    (_, index) => listDiscoveryExecutors(index + 1),
  ));
  return [first, ...remaining].flatMap((page) => page.items);
}

export async function createDiscoveryJob(
  executorId: string,
  scopeId: string,
  csrfToken: string,
): Promise<DiscoveryJob> {
  return parseDiscoveryJob(await read(await fetch(`${apiUrl}/discovery/jobs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ executorId, scopeId }),
  })));
}

export async function getDiscoveryJob(jobId: string): Promise<DiscoveryJob> {
  return parseDiscoveryJob(await read(await fetch(
    `${apiUrl}/discovery/jobs/${encodeURIComponent(jobId)}`,
    { credentials: "include" },
  )));
}

export async function listDiscoveredDevices(
  jobId: string,
  page: number,
  size = 20,
): Promise<DiscoveredDevicePage> {
  return parseDiscoveredDevicePage(await read(await fetch(
    `${apiUrl}/discovery-jobs/${encodeURIComponent(jobId)}/discovered-devices?page=${page}&size=${size}`,
    { credentials: "include" },
  )), jobId);
}

export async function ignoreDiscoveredDevice(
  jobId: string,
  discoveredDeviceId: string,
  expectedVersion: number,
  csrfToken: string,
): Promise<DiscoveredDevice> {
  return parseDiscoveredDevice(await read(await fetch(
    `${apiUrl}/discovery-jobs/${encodeURIComponent(jobId)}/discovered-devices/${encodeURIComponent(discoveredDeviceId)}/ignore`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ expectedVersion }),
    },
  )), jobId);
}

export async function incorporateDiscoveredDevice(
  jobId: string,
  discoveredDeviceId: string,
  assetId: string,
  expectedVersion: number,
  csrfToken: string,
): Promise<DiscoveredDevice> {
  return parseDiscoveredDevice(await read(await fetch(
    `${apiUrl}/discovery-jobs/${encodeURIComponent(jobId)}/discovered-devices/${encodeURIComponent(discoveredDeviceId)}/incorporate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ assetId, expectedVersion }),
    },
  )), jobId);
}

export async function createDiscoveryExecutor(
  name: string,
  scopeIds: string[],
  csrfToken: string,
): Promise<DiscoveryExecutor> {
  return parseDiscoveryExecutor(await read(await fetch(`${apiUrl}/discovery/executors`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ name, scopeIds }),
  })));
}

export async function getDiscoveryExecutor(executorId: string): Promise<DiscoveryExecutor> {
  return parseDiscoveryExecutor(await read(await fetch(
    `${apiUrl}/discovery/executors/${encodeURIComponent(executorId)}`,
    { credentials: "include" },
  )));
}

export async function registerDiscoveryExecutorPublicKey(
  executorId: string,
  publicKey: string,
  csrfToken: string,
): Promise<DiscoveryExecutor> {
  return parseDiscoveryExecutor(await read(await fetch(
    `${apiUrl}/discovery/executors/${encodeURIComponent(executorId)}/ssh-key`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ publicKey }),
    },
  )));
}

export async function activateDiscoveryExecutor(
  executorId: string,
  csrfToken: string,
): Promise<DiscoveryExecutorConnection> {
  return parseDiscoveryExecutorConnection(await read(await fetch(
    `${apiUrl}/discovery/executors/${encodeURIComponent(executorId)}/activate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    },
  )), executorId);
}

export async function createAuthorizedScope(
  name: string,
  cidr: string,
  csrfToken: string,
): Promise<AuthorizedScope> {
  return parseAuthorizedScope(await read(await fetch(`${apiUrl}/discovery/scopes`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ name, cidr }),
  })));
}

export async function updateAuthorizedScopeStatus(
  scopeId: string,
  status: AuthorizedScopeStatus,
  expectedVersion: number,
  csrfToken: string,
): Promise<AuthorizedScope> {
  return parseAuthorizedScope(await read(await fetch(
    `${apiUrl}/discovery/scopes/${scopeId}/status`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ status, expectedVersion }),
    },
  )));
}

export function parseAuthorizedScope(value: unknown): AuthorizedScope {
  if (!isRecord(value)) throw new AuthorizedScopeContractError();
  const keys = new Set([
    "scopeId", "name", "cidr", "status", "createdByUserId", "createdAt", "updatedAt", "version",
  ]);
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || typeof value.scopeId !== "string"
      || !UUID_V4.test(value.scopeId)
      || typeof value.name !== "string"
      || [...value.name].length < 1
      || [...value.name].length > 200
      || value.name !== value.name.trim()
      || typeof value.cidr !== "string"
      || !isCanonicalCidr(value.cidr)
      || (value.status !== "ACTIVE" && value.status !== "DISABLED")
      || typeof value.createdByUserId !== "string"
      || !UUID_V4.test(value.createdByUserId)
      || !isDateTime(value.createdAt)
      || !isDateTime(value.updatedAt)
      || !Number.isSafeInteger(value.version)
      || (value.version as number) < 0) {
    throw new AuthorizedScopeContractError();
  }
  return value as AuthorizedScope;
}

export function parseAuthorizedScopePage(value: unknown): AuthorizedScopePage {
  if (!isRecord(value)) throw new AuthorizedScopeContractError();
  const keys = new Set(["items", "page", "size", "totalElements", "totalPages"]);
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || !Array.isArray(value.items)
      || !value.items.every((item) => safelyParsesScope(item))
      || !isNonNegativeInteger(value.page)
      || !Number.isSafeInteger(value.size)
      || (value.size as number) < 1
      || (value.size as number) > 50
      || !isNonNegativeInteger(value.totalElements)
      || !isNonNegativeInteger(value.totalPages)) {
    throw new AuthorizedScopeContractError();
  }
  return { ...value, items: value.items.map(parseAuthorizedScope) } as AuthorizedScopePage;
}

export function parseDiscoveryExecutor(value: unknown): DiscoveryExecutor {
  if (!isRecord(value)) throw new DiscoveryExecutorContractError();
  const keys = new Set([
    "executorId", "name", "scopeIds", "status", "publicKeyRegistered",
    "publicKeyFingerprint", "createdByUserId", "createdAt", "updatedAt", "version",
  ]);
  const scopeIds = value.scopeIds;
  const fingerprintValid = value.publicKeyFingerprint === null
    || (typeof value.publicKeyFingerprint === "string"
      && /^SHA256:[A-Za-z0-9+/]{43}$/.test(value.publicKeyFingerprint));
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || typeof value.executorId !== "string"
      || !UUID_V4.test(value.executorId)
      || typeof value.name !== "string"
      || [...value.name].length < 1
      || [...value.name].length > 200
      || value.name !== value.name.trim()
      || !Array.isArray(scopeIds)
      || scopeIds.length < 1
      || scopeIds.length > 50
      || !scopeIds.every((scopeId) => typeof scopeId === "string" && UUID_V4.test(scopeId))
      || new Set(scopeIds).size !== scopeIds.length
      || (value.status !== "PENDING" && value.status !== "ACTIVE")
      || typeof value.publicKeyRegistered !== "boolean"
      || !fingerprintValid
      || value.publicKeyRegistered !== (value.publicKeyFingerprint !== null)
      || typeof value.createdByUserId !== "string"
      || !UUID_V4.test(value.createdByUserId)
      || !isDateTime(value.createdAt)
      || !isDateTime(value.updatedAt)
      || (value.status === "PENDING" && value.version !== 0)
      || (value.status === "ACTIVE" && (
        value.version !== 1
        || value.publicKeyRegistered !== true
        || value.publicKeyFingerprint === null
      ))) {
    throw new DiscoveryExecutorContractError();
  }
  return value as DiscoveryExecutor;
}

export function parseDiscoveryExecutorConnection(
  value: unknown,
  executorId: string,
): DiscoveryExecutorConnection {
  if (!isRecord(value)) throw new DiscoveryExecutorContractError();
  const keys = new Set(["host", "port", "username", "hostKey", "hostKeyFingerprint"]);
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || typeof value.host !== "string"
      || value.host.length < 1
      || value.host.length > 253
      || value.host !== value.host.trim()
      || [...value.host].some((character) => character.charCodeAt(0) < 33 || character.charCodeAt(0) === 127)
      || !Number.isSafeInteger(value.port)
      || (value.port as number) < 1
      || (value.port as number) > 65535
      || typeof value.username !== "string"
      || value.username !== `discovery-executor-${executorId}`
      || typeof value.hostKey !== "string"
      || !/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(value.hostKey)
      || typeof value.hostKeyFingerprint !== "string"
      || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(value.hostKeyFingerprint)) {
    throw new DiscoveryExecutorContractError();
  }
  return value as DiscoveryExecutorConnection;
}

export function parseDiscoveryExecutorPage(value: unknown): DiscoveryExecutorPage {
  if (!isRecord(value)) throw new DiscoveryExecutorContractError();
  const keys = new Set(["items", "page", "size", "totalElements", "totalPages"]);
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || !Array.isArray(value.items)
      || !value.items.every((item) => safelyParsesExecutor(item))
      || !isNonNegativeInteger(value.page)
      || !Number.isSafeInteger(value.size)
      || (value.size as number) < 1
      || (value.size as number) > 50
      || !isNonNegativeInteger(value.totalElements)
      || !isNonNegativeInteger(value.totalPages)) {
    throw new DiscoveryExecutorContractError();
  }
  return { ...value, items: value.items.map(parseDiscoveryExecutor) } as DiscoveryExecutorPage;
}

export function parseDiscoveryJob(value: unknown): DiscoveryJob {
  if (!isRecord(value)) throw new DiscoveryJobContractError();
  const keys = new Set([
    "jobId", "executorId", "scopeId", "profile", "status",
    "createdAt", "expiresAt", "dispatchedAt", "startedAt", "completedAt",
    "failureCode", "summary", "version",
  ]);
  const statuses = new Set<unknown>([
    "PENDING", "DISPATCHED", "RUNNING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED",
  ]);
  const createdAt = typeof value.createdAt === "string" ? Date.parse(value.createdAt) : Number.NaN;
  const expiresAt = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : Number.NaN;
  const dispatchedAt = typeof value.dispatchedAt === "string" ? Date.parse(value.dispatchedAt) : Number.NaN;
  const startedAt = typeof value.startedAt === "string" ? Date.parse(value.startedAt) : Number.NaN;
  const completedAt = typeof value.completedAt === "string" ? Date.parse(value.completedAt) : Number.NaN;
  const dispatched = value.dispatchedAt === null || isDateTime(value.dispatchedAt);
  const started = value.startedAt === null || isDateTime(value.startedAt);
  const completed = value.completedAt === null || isDateTime(value.completedAt);
  const resultFieldsEmpty = value.startedAt === null && value.completedAt === null
    && value.failureCode === null && value.summary === null;
  const resultFieldsComplete = value.startedAt !== null && value.completedAt !== null
    && parseDiscoveryResultSummary(value.summary);
  const failures = new Set<unknown>([
    "JOB_EXPIRED", "SCOPE_TOO_LARGE", "UNSUPPORTED_PLATFORM", "EXECUTION_INTERRUPTED", "EXECUTION_ERROR",
  ]);
  const failureValid = value.failureCode === null || failures.has(value.failureCode);
  const summaryValid = value.summary === null || parseDiscoveryResultSummary(value.summary);
  const stateValid = (value.status === "PENDING" && value.dispatchedAt === null
      && resultFieldsEmpty && value.version === 0)
    || (value.status === "DISPATCHED" && value.dispatchedAt !== null
      && resultFieldsEmpty && value.version === 1)
    || (value.status === "EXPIRED" && (
      ((value.version === 1 && value.dispatchedAt === null)
        || (value.version === 2 && value.dispatchedAt !== null)) && resultFieldsEmpty
    ))
    || (value.status === "SUCCEEDED" && value.dispatchedAt !== null && value.failureCode === null
      && resultFieldsComplete && value.version === 2)
    || (value.status === "FAILED" && value.dispatchedAt !== null && failures.has(value.failureCode)
      && resultFieldsComplete && value.version === 2)
    || (["RUNNING", "CANCELLED"].includes(String(value.status))
      && value.dispatchedAt !== null && Number.isSafeInteger(value.version) && (value.version as number) >= 2);
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || typeof value.jobId !== "string" || !UUID_V4.test(value.jobId)
      || typeof value.executorId !== "string" || !UUID_V4.test(value.executorId)
      || typeof value.scopeId !== "string" || !UUID_V4.test(value.scopeId)
      || value.profile !== "BASIC"
      || !statuses.has(value.status)
      || !isDateTime(value.createdAt)
      || !isDateTime(value.expiresAt)
       || expiresAt - createdAt !== 60 * 60 * 1000
       || !dispatched
       || !started
       || !completed
       || !failureValid
       || !summaryValid
       || (value.dispatchedAt !== null && (dispatchedAt < createdAt || dispatchedAt >= expiresAt))
       || (value.startedAt !== null && value.dispatchedAt !== null && startedAt < dispatchedAt)
       || (value.completedAt !== null && value.startedAt !== null && completedAt < startedAt)
       || (value.completedAt !== null && completedAt > expiresAt)
       || !stateValid) {
    throw new DiscoveryJobContractError();
  }
  return value as DiscoveryJob;
}

export function parseDiscoveredDevice(value: unknown, expectedJobId?: string): DiscoveredDevice {
  if (!isRecord(value)) throw new DiscoveredDeviceContractError();
  const keys = new Set([
    "discoveredDeviceId", "jobId", "status", "ipAddress", "macAddress", "hostname",
    "evidence", "openTcpPorts", "observedAt", "version", "reviewedAt", "assetId",
  ]);
  const evidence = value.evidence;
  const ports = value.openTcpPorts;
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || typeof value.discoveredDeviceId !== "string" || !UUID_V4.test(value.discoveredDeviceId)
      || typeof value.jobId !== "string" || !UUID_V4.test(value.jobId)
      || (expectedJobId !== undefined && value.jobId !== expectedJobId)
      || (value.status !== "UNREVIEWED" && value.status !== "IGNORED" && value.status !== "INCORPORATED")
      || typeof value.ipAddress !== "string" || !isIpAddress(value.ipAddress)
      || (value.macAddress !== null && (
        typeof value.macAddress !== "string" || !/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(value.macAddress)
      ))
      || (value.hostname !== null && (
        typeof value.hostname !== "string" || value.hostname.length < 1 || value.hostname.length > 253
      ))
      || !Array.isArray(evidence) || evidence.length < 1 || evidence.length > 3
      || !evidence.every((item) => item === "ARP" || item === "ICMP" || item === "TCP")
      || new Set(evidence).size !== evidence.length
      || !Array.isArray(ports) || ports.length > 6
      || !ports.every((port) => typeof port === "number" && [22, 53, 80, 443, 445, 3389].includes(port))
      || new Set(ports).size !== ports.length
      || !isDateTime(value.observedAt)
      || (value.status === "UNREVIEWED" && (
        value.version !== 0 || value.reviewedAt !== null || value.assetId !== null
      ))
      || (value.status === "IGNORED" && (
        value.version !== 1 || !isDateTime(value.reviewedAt) || value.assetId !== null
      ))
      || (value.status === "INCORPORATED" && (
        value.version !== 1 || !isDateTime(value.reviewedAt)
        || typeof value.assetId !== "string" || !UUID_V4.test(value.assetId)
      ))) {
    throw new DiscoveredDeviceContractError();
  }
  return value as DiscoveredDevice;
}

export function parseDiscoveredDevicePage(value: unknown, expectedJobId?: string): DiscoveredDevicePage {
  if (!isRecord(value)) throw new DiscoveredDeviceContractError();
  const keys = new Set(["items", "page", "size", "totalElements", "totalPages"]);
  if (Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || !Array.isArray(value.items)
      || value.items.length > 50
      || !value.items.every((item) => safelyParsesDevice(item, expectedJobId))
      || !isNonNegativeInteger(value.page)
      || !Number.isSafeInteger(value.size) || (value.size as number) < 1 || (value.size as number) > 50
      || value.items.length > (value.size as number)
      || !isNonNegativeInteger(value.totalElements)
      || !isNonNegativeInteger(value.totalPages)) {
    throw new DiscoveredDeviceContractError();
  }
  return {
    ...value,
    items: value.items.map((item) => parseDiscoveredDevice(item, expectedJobId)),
  } as DiscoveredDevicePage;
}

async function read(response: Response): Promise<unknown> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem, response.headers.get("location") ?? undefined);
  }
  return response.json();
}

function safelyParsesScope(value: unknown) {
  try {
    parseAuthorizedScope(value);
    return true;
  } catch {
    return false;
  }
}

function safelyParsesExecutor(value: unknown) {
  try {
    parseDiscoveryExecutor(value);
    return true;
  } catch {
    return false;
  }
}

function safelyParsesDevice(value: unknown, expectedJobId?: string) {
  try {
    parseDiscoveredDevice(value, expectedJobId);
    return true;
  } catch {
    return false;
  }
}

function parseDiscoveryResultSummary(value: unknown): value is DiscoveryResultSummary {
  if (!isRecord(value)) return false;
  const keys = new Set(["targetsConsidered", "targetsScanned", "observationsFound"]);
  return Object.keys(value).length === keys.size
    && Object.keys(value).every((key) => keys.has(key))
    && Number.isInteger(value.targetsConsidered) && (value.targetsConsidered as number) >= 0
    && (value.targetsConsidered as number) <= 340282366920938463463374607431768211456
    && isNonNegativeInteger(value.targetsScanned) && (value.targetsScanned as number) <= 4096
    && isNonNegativeInteger(value.observationsFound) && (value.observationsFound as number) <= 4096;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_DATE_TIME.exec(value);
  if (!match) return false;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.slice(0, 8).split(":").map(Number);
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth(year, month)
    && hour <= 23
    && minute <= 59
    && second <= 59;
}

function isIpAddress(value: string): boolean {
  const octets = value.split(".");
  if (octets.length === 4) {
    return octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
  }
  if (!/^[0-9a-f:]+$/i.test(value)) return false;
  const compressed = value.split("::");
  if (compressed.length > 2) return false;
  const left = compressed[0] ? compressed[0].split(":") : [];
  const right = compressed.length === 2 && compressed[1] ? compressed[1].split(":") : [];
  if (![...left, ...right].every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return false;
  return compressed.length === 1
    ? left.length === 8
    : left.length + right.length < 8;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isCanonicalCidr(value: string): boolean {
  const [address, prefixText, extra] = value.split("/");
  if (extra !== undefined || !address || !/^(0|[1-9]\d*)$/.test(prefixText ?? "")) return false;
  const prefix = Number(prefixText);
  if (address.includes(".")) {
    const octets = address.split("/")[0].split(".");
    if (octets.length !== 4 || prefix > 32 || octets.some((octet) => (
      !/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255
    ))) return false;
    return hasNoHostBits(octets.map(Number), prefix, 8);
  }

  if (prefix > 128 || !/^[0-9a-f:]+$/.test(address)) return false;
  const compressed = address.split("::");
  if (compressed.length > 2) return false;
  const left = compressed[0] ? compressed[0].split(":") : [];
  const right = compressed.length === 2 && compressed[1] ? compressed[1].split(":") : [];
  const validGroup = (group: string) => /^(0|[1-9a-f][0-9a-f]{0,3})$/.test(group);
  if (![...left, ...right].every(validGroup)) return false;
  const omitted = 8 - left.length - right.length;
  if ((compressed.length === 1 && omitted !== 0) || (compressed.length === 2 && omitted < 2)) return false;
  const groups = [...left.map(hex), ...Array(omitted).fill(0), ...right.map(hex)];
  return groups.length === 8
    && hasNoHostBits(groups, prefix, 16)
    && `${formatIpv6(groups)}/${prefix}` === value;
}

function hasNoHostBits(parts: number[], prefix: number, bitsPerPart: number): boolean {
  return parts.every((part, index) => {
    const retained = Math.max(0, Math.min(bitsPerPart, prefix - index * bitsPerPart));
    const hostMask = retained === bitsPerPart ? 0 : (1 << (bitsPerPart - retained)) - 1;
    return (part & hostMask) === 0;
  });
}

function hex(value: string): number {
  return Number.parseInt(value, 16);
}

function formatIpv6(groups: number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== 0) {
      start++;
      continue;
    }
    let end = start;
    while (groups[end] === 0) end++;
    if (end - start > bestLength && end - start >= 2) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  if (bestStart < 0) return groups.map((group) => group.toString(16)).join(":");
  const left = groups.slice(0, bestStart).map((group) => group.toString(16)).join(":");
  const right = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(":");
  return `${left}::${right}`;
}
