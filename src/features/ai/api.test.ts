import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiSourceContractError,
  createAiSource,
  getAiSource,
  indexAiSource,
  listAiSources,
  parseAiSource,
  parseAiSourcePage,
} from "./api";

const source = {
  sourceId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  name: "Operations handbook",
  mediaType: "text/plain",
  sizeBytes: 17,
  sha256: "a".repeat(64),
  status: "PENDING",
  version: 0,
  createdByUserId: "14fb9d5d-b66a-454c-9fea-8dbdcc1c6ac7",
  createdAt: "2026-10-31T12:00:00Z",
  updatedAt: "2026-10-31T12:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI source API", () => {
  it("accepts only closed source and page responses", () => {
    expect(parseAiSource(source)).toEqual(source);
    expect(parseAiSourcePage({
      items: [source], page: 0, size: 20, totalElements: 1, totalPages: 1,
    }).items).toEqual([source]);

    expect(() => parseAiSource({ ...source, storageKey: "private.txt" }))
      .toThrow(AiSourceContractError);
    for (const status of ["PENDING", "INDEXING", "READY", "FAILED", "DISABLED"] as const) {
      expect(parseAiSource({ ...source, status, version: 4 })).toMatchObject({ status, version: 4 });
    }
    expect(() => parseAiSource({ ...source, status: "UNKNOWN" })).toThrow(AiSourceContractError);
    expect(() => parseAiSource({ ...source, version: -1 })).toThrow(AiSourceContractError);
    expect(() => parseAiSource({ ...source, name: " unnormalized " })).toThrow(AiSourceContractError);
    expect(() => parseAiSource({ ...source, sha256: "A".repeat(64) })).toThrow(AiSourceContractError);
    expect(() => parseAiSource({ ...source, sizeBytes: 1_048_577 })).toThrow(AiSourceContractError);
    expect(() => parseAiSourcePage({
      items: [source], page: 0, size: 51, totalElements: 1, totalPages: 1,
    })).toThrow(AiSourceContractError);
  });

  it("uses a closed FormData body without setting multipart Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(source, 201));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["strict utf-8"], "source.txt", { type: "text/plain" });

    await expect(createAiSource("Operations handbook", file, "csrf-token")).resolves.toEqual(source);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/ai/sources");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": "csrf-token" },
    });
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect([...body.keys()]).toEqual(["name", "file"]);
    expect(body.get("name")).toBe("Operations handbook");
    expect(body.get("file")).toBe(file);
  });

  it("requests the paginated list and selected detail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ items: [source], page: 2, size: 20, totalElements: 41, totalPages: 3 }))
      .mockResolvedValueOnce(json(source));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAiSources(2)).resolves.toMatchObject({ page: 2 });
    await expect(getAiSource(source.sourceId)).resolves.toEqual(source);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1, "/api/v1/ai/sources?page=2&size=20", { credentials: "include" },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2, `/api/v1/ai/sources/${source.sourceId}`, { credentials: "include" },
    );
  });

  it("requests indexing with a closed version body and CSRF", async () => {
    const accepted = { ...source, status: "INDEXING", version: 1 } as const;
    const fetchMock = vi.fn().mockResolvedValue(json(accepted, 202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(indexAiSource(source.sourceId, 0, "csrf-token")).resolves.toEqual(accepted);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/ai/sources/${source.sourceId}/index`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
        },
        body: JSON.stringify({ expectedVersion: 0 }),
      },
    );
  });

  it("rejects a successful indexing response with a status other than 202", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...source, status: "INDEXING", version: 1 })));

    await expect(indexAiSource(source.sourceId, 0, "csrf-token")).rejects.toBeInstanceOf(AiSourceContractError);
  });

  it.each([
    [{ ...source, sourceId: "59844482-1d29-4d30-87fd-1bb67a22e050", status: "INDEXING", version: 1 }],
    [{ ...source, status: "READY", version: 1 }],
    [{ ...source, status: "INDEXING", version: 2 }],
  ])("rejects an incongruent accepted indexing body", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(body, 202)));

    await expect(indexAiSource(source.sourceId, 0, "csrf-token")).rejects.toBeInstanceOf(AiSourceContractError);
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
