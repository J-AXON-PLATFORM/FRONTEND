export type Session = {
  userId: string;
  username: string;
  roles: string[];
  csrfToken: string;
  expiresAt: string;
};

type Problem = {
  code: string;
  correlationId: string;
  detail?: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem?: Problem,
  ) {
    super(problem?.detail ?? "No se pudo completar la solicitud.");
  }
}

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";

async function readResponse(response: Response): Promise<Session> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as Problem
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return response.json() as Promise<Session>;
}

export async function login(username: string, password: string): Promise<Session> {
  return readResponse(await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }));
}

export async function getCurrentSession(): Promise<Session> {
  return readResponse(await fetch(`${apiUrl}/auth/me`, {
    credentials: "include",
  }));
}
