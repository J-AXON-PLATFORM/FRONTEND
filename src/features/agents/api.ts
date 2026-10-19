import { ApiError } from "@/features/auth/api";

export type Agent = {
  agentId: string;
  assetId: string;
  status: "PENDING" | "ACTIVE";
  operationalStatus: "UNKNOWN" | "ONLINE" | "OFFLINE";
  lastSeenAt: string | null;
  lastSnapshotAt: string | null;
  publicKeyRegistered: boolean;
  publicKeyFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type AgentConnection = {
  host: string;
  port: number;
  username: string;
  publicHostKey: string;
};

export type AgentTask = {
  taskId: string;
  agentId: string;
  taskType: "COLLECT_SNAPSHOT";
  status: "PENDING" | "DISPATCHED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "REJECTED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  error: { code: string; message: string } | null;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

export class AgentContractError extends Error {
  constructor() {
    super("La respuesta del Agent no cumple el contrato esperado.");
  }
}

export class AgentTaskContractError extends Error {
  constructor() {
    super("La respuesta de la tarea no cumple el contrato esperado.");
  }
}

async function readAgent(response: Response): Promise<Agent> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return parseAgent(await response.json());
}

function parseAgent(value: unknown): Agent {
  if (!isRecord(value)) throw new AgentContractError();
  const expected = new Set([
    "agentId", "assetId", "status", "operationalStatus", "lastSeenAt", "lastSnapshotAt",
    "publicKeyRegistered", "publicKeyFingerprint", "createdAt", "updatedAt", "version",
  ]);
  if (Object.keys(value).some((key) => !expected.has(key))
      || !isUuid(value.agentId)
      || !isUuid(value.assetId)
      || (value.status !== "PENDING" && value.status !== "ACTIVE")
      || !isOperationalStatus(value.operationalStatus)
      || !isNullableUtc(value.lastSeenAt)
      || !isNullableUtc(value.lastSnapshotAt)
      || typeof value.publicKeyRegistered !== "boolean"
      || !isNullableFingerprint(value.publicKeyFingerprint)
      || !isUtc(value.createdAt)
      || !isUtc(value.updatedAt)
      || !Number.isInteger(value.version)
      || (value.version as number) < 0) {
    throw new AgentContractError();
  }
  if ((value.publicKeyRegistered && value.publicKeyFingerprint === null)
      || (!value.publicKeyRegistered && value.publicKeyFingerprint !== null)
      || (value.operationalStatus === "UNKNOWN"
        && (value.lastSeenAt !== null || value.lastSnapshotAt !== null))
      || (value.operationalStatus !== "UNKNOWN"
        && (value.lastSeenAt === null || value.lastSnapshotAt === null))) {
    throw new AgentContractError();
  }
  return value as Agent;
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

function isNullableUtc(value: unknown): value is string | null {
  return value === null || isUtc(value);
}

function isNullableFingerprint(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && FINGERPRINT.test(value));
}

function isOperationalStatus(value: unknown): value is Agent["operationalStatus"] {
  return value === "UNKNOWN" || value === "ONLINE" || value === "OFFLINE";
}

async function readConnection(response: Response): Promise<AgentConnection> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return response.json() as Promise<AgentConnection>;
}

async function readTask(response: Response): Promise<AgentTask> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return parseTask(await response.json());
}

function parseTask(value: unknown): AgentTask {
  if (!isRecord(value)) throw new AgentTaskContractError();
  const expected = new Set([
    "taskId", "agentId", "taskType", "status", "createdAt", "expiresAt", "dispatchedAt",
    "completedAt", "error",
  ]);
  const statuses = new Set([
    "PENDING", "DISPATCHED", "RUNNING", "SUCCEEDED", "FAILED", "REJECTED", "EXPIRED",
  ]);
  if (Object.keys(value).length !== expected.size
      || Object.keys(value).some((key) => !expected.has(key))
      || !isUuid(value.taskId)
      || !isUuid(value.agentId)
      || value.taskType !== "COLLECT_SNAPSHOT"
      || typeof value.status !== "string"
      || !statuses.has(value.status)
      || !isUtc(value.createdAt)
      || !isUtc(value.expiresAt)
      || !isNullableUtc(value.dispatchedAt)
      || !isNullableUtc(value.completedAt)
      || !isTaskError(value.error)
      || Date.parse(value.expiresAt as string) - Date.parse(value.createdAt as string) !== 900_000) {
    throw new AgentTaskContractError();
  }
  const status = value.status as AgentTask["status"];
  const pending = status === "PENDING";
  const active = status === "DISPATCHED" || status === "RUNNING";
  const failed = status === "FAILED" || status === "REJECTED";
  if ((pending && value.dispatchedAt !== null)
      || (!pending && status !== "EXPIRED" && value.dispatchedAt === null)
      || ((pending || active) && value.completedAt !== null)
      || (!(pending || active) && value.completedAt === null)
      || (failed && value.error === null)
      || (!failed && value.error !== null)) {
    throw new AgentTaskContractError();
  }
  return value as AgentTask;
}

function isTaskError(value: unknown): value is AgentTask["error"] {
  if (value === null) return true;
  return isRecord(value)
    && Object.keys(value).length === 2
    && typeof value.code === "string"
    && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)
    && typeof value.message === "string"
    && value.message.length > 0
    && value.message.length <= 256;
}

export async function preRegisterAgent(assetId: string, csrfToken: string): Promise<Agent> {
  return readAgent(await fetch(`${apiUrl}/agents`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ assetId }),
  }));
}

export async function getAgent(agentId: string): Promise<Agent> {
  return readAgent(await fetch(`${apiUrl}/agents/${encodeURIComponent(agentId)}`, {
    credentials: "include",
  }));
}

export async function registerAgentPublicKey(
  agentId: string,
  publicKey: string,
  csrfToken: string,
): Promise<Agent> {
  return readAgent(await fetch(`${apiUrl}/agents/${encodeURIComponent(agentId)}/ssh-key`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ publicKey }),
  }));
}

export async function activateAgent(
  agentId: string,
  csrfToken: string,
): Promise<AgentConnection> {
  return readConnection(await fetch(`${apiUrl}/agents/${encodeURIComponent(agentId)}/activate`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
  }));
}

export async function createCollectSnapshotTask(
  agentId: string,
  csrfToken: string,
): Promise<AgentTask> {
  return readTask(await fetch(`${apiUrl}/agents/${encodeURIComponent(agentId)}/tasks`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ taskType: "COLLECT_SNAPSHOT" }),
  }));
}

export async function getAgentTask(agentId: string, taskId: string): Promise<AgentTask> {
  return readTask(await fetch(
    `${apiUrl}/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}`,
    { credentials: "include" },
  ));
}
