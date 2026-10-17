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

export type TechnicalState = {
  assetId: string;
  lastSeenAt: string | null;
  lastSnapshotAt: string | null;
  latestObservation: TechnicalObservation | null;
};

export type TechnicalObservation = {
  snapshotId: string;
  capturedAt: string;
  hostname: string;
  operatingSystem: {
    family: "WINDOWS" | "LINUX" | "MACOS" | "OTHER";
    name: string;
    version: string;
  };
  architecture: "X86_64" | "X86" | "ARM64" | "ARM32" | "OTHER";
  logicalCpuCount: number;
  memoryBytes: number;
  storageVolumes: Array<{
    name: string;
    totalBytes: number;
    availableBytes: number;
  }>;
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

async function readTechnicalState(response: Response): Promise<TechnicalState> {
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? await response.json() as { code: string; correlationId: string; detail?: string }
      : undefined;
    throw new ApiError(response.status, problem);
  }
  return response.json() as Promise<TechnicalState>;
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

export async function getAssetTechnicalState(assetId: string): Promise<TechnicalState> {
  return readTechnicalState(await fetch(
    `${apiUrl}/assets/${encodeURIComponent(assetId)}/technical-state`,
    { credentials: "include" },
  ));
}
