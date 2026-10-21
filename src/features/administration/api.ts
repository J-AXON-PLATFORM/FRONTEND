import { ApiError } from "@/features/auth/api";

export const HUMAN_ROLES = [
  "SYSTEM_ADMIN",
  "IT_OPERATOR",
  "SUPPORT_TECHNICIAN",
  "END_USER",
  "AUDITOR",
] as const;

export type HumanRole = typeof HUMAN_ROLES[number];

export type HumanUser = {
  userId: string;
  username: string;
  status: "ACTIVE";
  roles: HumanRole[];
  createdAt: string;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class HumanUserContractError extends Error {
  constructor() {
    super("La respuesta del usuario no cumple el contrato esperado.");
  }
}

export async function createHumanUser(
  username: string,
  password: string,
  roles: HumanRole[],
  csrfToken: string,
): Promise<HumanUser> {
  const response = await fetch(`${apiUrl}/users`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ username, password, roles }),
  });
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return parseHumanUser(await response.json());
}

export function parseHumanUser(value: unknown): HumanUser {
  if (!isRecord(value)) throw new HumanUserContractError();
  const expected = new Set(["userId", "username", "status", "roles", "createdAt"]);
  const roles = value.roles;
  if (Object.keys(value).length !== expected.size
      || Object.keys(value).some((key) => !expected.has(key))
      || typeof value.userId !== "string"
      || !UUID_V4.test(value.userId)
      || typeof value.username !== "string"
      || value.username.length < 1
      || value.username.length > 128
      || value.username !== value.username.trim()
      || value.status !== "ACTIVE"
      || !Array.isArray(roles)
      || roles.length < 1
      || roles.length > HUMAN_ROLES.length
      || !roles.every(isHumanRole)
      || new Set(roles).size !== roles.length
      || roles.join(",") !== [...roles].sort().join(",")
      || typeof value.createdAt !== "string"
      || !UTC_DATE_TIME.test(value.createdAt)
      || Number.isNaN(Date.parse(value.createdAt))) {
    throw new HumanUserContractError();
  }
  return value as HumanUser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHumanRole(value: unknown): value is HumanRole {
  return typeof value === "string" && HUMAN_ROLES.includes(value as HumanRole);
}
