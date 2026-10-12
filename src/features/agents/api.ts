import { ApiError } from "@/features/auth/api";

export type Agent = {
  agentId: string;
  assetId: string;
  status: "PENDING";
  publicKeyRegistered: boolean;
  publicKeyFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";

async function readAgent(response: Response): Promise<Agent> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return response.json() as Promise<Agent>;
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
