import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiSourceContractError,
  createAiSource,
  getAiSource,
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
    expect(() => parseAiSource({ ...source, status: "READY" })).toThrow(AiSourceContractError);
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
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
