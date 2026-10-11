import { ApiError } from "@/features/auth/api";

export type AssetStatus = "ACTIVE" | "INACTIVE";

export type AssetType =
  | "DESKTOP"
  | "LAPTOP"
  | "SERVER"
  | "NETWORK_DEVICE"
  | "PRINTER"
  | "OTHER";

export type Asset = {
  assetId: string;
  name: string;
  assetType: AssetType;
  status: AssetStatus;
  assetTag?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  responsibleUserId?: string | null;
  locationLabel?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type AssetCreateInput = {
  name: string;
  assetType: AssetType;
  status: AssetStatus;
};

const apiUrl = process.env.NEXT_PUBLIC_JAXON_API_URL ?? "/api/v1";

async function readAsset(response: Response): Promise<Asset> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return response.json() as Promise<Asset>;
}

export async function createAsset(input: AssetCreateInput, csrfToken: string): Promise<Asset> {
  return readAsset(await fetch(`${apiUrl}/assets`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(input),
  }));
}

export async function getAsset(assetId: string): Promise<Asset> {
  return readAsset(await fetch(`${apiUrl}/assets/${encodeURIComponent(assetId)}`, {
    credentials: "include",
  }));
}
