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

export type TechnicalStateUpdatedEvent = {
  eventId: string;
  eventType: "ASSET_TECHNICAL_STATE_UPDATED";
  occurredAt: string;
  assetId: string;
  correlationId: string;
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

export function openTechnicalStateEvents(assetId: string): EventSource {
  return new EventSource(
    `${apiUrl}/assets/${encodeURIComponent(assetId)}/technical-state/events`,
    { withCredentials: true },
  );
}

export function parseTechnicalStateUpdatedEvent(data: string): TechnicalStateUpdatedEvent | undefined {
  try {
    const candidate = JSON.parse(data) as Record<string, unknown>;
    const keys = Object.keys(candidate).sort();
    if (
      keys.join(",") !== "assetId,correlationId,eventId,eventType,occurredAt"
      || candidate.eventType !== "ASSET_TECHNICAL_STATE_UPDATED"
      || !isUuidV4(candidate.eventId)
      || !isUuidV4(candidate.assetId)
      || !isUuidV4(candidate.correlationId)
      || typeof candidate.occurredAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(candidate.occurredAt)
      || Number.isNaN(Date.parse(candidate.occurredAt))
    ) {
      return undefined;
    }
    return candidate as TechnicalStateUpdatedEvent;
  } catch {
    return undefined;
  }
}

function isUuidV4(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
