import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReportContractError,
  downloadReportCsv,
  listReport,
  parseReportPage,
  reportQueryString,
  utcInputToInstant,
  type ReportFilters,
} from "./api";

const asset = {
  assetId: "f4844482-1d29-4d30-87fd-1bb67a22e050",
  name: "Workstation",
  assetType: "DESKTOP",
  status: "ACTIVE",
  createdAt: "2026-11-27T12:00:00Z",
  updatedAt: "2026-11-27T12:30:00Z",
};
const agent = {
  agentId: "e4844482-1d29-4d30-87fd-1bb67a22e050",
  assetId: asset.assetId,
  status: "ACTIVE",
  operationalStatus: "ONLINE",
  lastSeenAt: "2026-11-27T12:10:00Z",
  lastSnapshotAt: null,
  createdAt: "2026-11-27T11:00:00Z",
  updatedAt: "2026-11-27T12:10:00Z",
};
const ticket = {
  ticketId: "d4844482-1d29-4d30-87fd-1bb67a22e050",
  type: "INCIDENT",
  summary: "Cannot print",
  status: "OPEN",
  priority: "NORMAL",
  source: "WEB",
  requesterUserId: "c4844482-1d29-4d30-87fd-1bb67a22e050",
  createdByUserId: "b4844482-1d29-4d30-87fd-1bb67a22e050",
  assigneeUserId: null,
  assetId: null,
  createdAt: "2026-11-27T10:00:00Z",
  updatedAt: "2026-11-27T10:00:00Z",
};

function page(items: unknown[], overrides: Record<string, unknown> = {}) {
  return { items, page: 0, size: 50, totalElements: items.length, totalPages: items.length ? 1 : 0, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Reporting API", () => {
  it("uses identical filters for JSON and CSV while excluding pagination from export", () => {
    const filters: ReportFilters = {
      report: "tickets",
      type: "INCIDENT",
      status: "OPEN",
      priority: "HIGH",
      requesterUserId: ticket.requesterUserId,
      assigneeUserId: "a4844482-1d29-4d30-87fd-1bb67a22e050",
      assetId: asset.assetId,
      createdFrom: "2026-11-01T00:00:00Z",
      createdTo: "2026-12-01T00:00:00Z",
      page: 3,
      size: 200,
    };
    const common = `type=INCIDENT&status=OPEN&priority=HIGH&requesterUserId=${ticket.requesterUserId}`
      + `&assigneeUserId=a4844482-1d29-4d30-87fd-1bb67a22e050&assetId=${asset.assetId}`
      + "&createdFrom=2026-11-01T00%3A00%3A00Z&createdTo=2026-12-01T00%3A00%3A00Z";
    expect(reportQueryString(filters)).toBe(`${common}&page=3&size=200`);
    expect(reportQueryString(filters, true)).toBe(common);
  });

  it.each([
    ["assets", asset],
    ["agents", agent],
    ["tickets", ticket],
  ] as const)("accepts a closed %s page", (report, row) => {
    expect(parseReportPage(page([row]), report, 0, 50).items).toEqual([row]);
  });

  it.each([
    ["extra page property", page([asset], { unknown: true })],
    ["wrong page", page([asset], { page: 1 })],
    ["wrong totals", page([asset], { totalPages: 2 })],
    ["extra row property", page([{ ...asset, version: 1 }])],
    ["missing row property", page([{ ...asset, updatedAt: undefined }])],
    ["invalid UUID", page([{ ...asset, assetId: "not-a-uuid" }])],
    ["unknown enum", page([{ ...asset, status: "DELETED" }])],
    ["non-UTC time", page([{ ...asset, createdAt: "2026-11-27T12:00:00+01:00" }])],
  ])("rejects %s", (_name, body) => {
    expect(() => parseReportPage(body, "assets", 0, 50)).toThrow(ReportContractError);
  });

  it("enforces descending creation time and identifier order", () => {
    const earlier = {
      ...asset,
      assetId: "04844482-1d29-4d30-87fd-1bb67a22e050",
      createdAt: "2026-11-27T11:00:00Z",
    };
    const tie = { ...asset, assetId: "04844482-1d29-4d30-87fd-1bb67a22e050" };
    expect(parseReportPage(page([asset, earlier]), "assets", 0, 50).items).toHaveLength(2);
    expect(() => parseReportPage(page([earlier, asset]), "assets", 0, 50)).toThrow(ReportContractError);
    expect(() => parseReportPage(page([tie, asset]), "assets", 0, 50)).toThrow(ReportContractError);
  });

  it("requests JSON with the session cookie and validates the page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(page([agent])), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listReport({
      report: "agents", status: "ACTIVE", operationalStatus: "ONLINE", page: 0, size: 50,
    })).resolves.toEqual(page([agent]));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/reports/agents?status=ACTIVE&operationalStatus=ONLINE&page=0&size=50",
      { credentials: "include" },
    );
  });

  it("downloads exact CSV bytes once and always revokes the object URL", async () => {
    const bytes = new Uint8Array([0x61, 0x2c, 0x62, 0x0d, 0x0a]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=UTF-8",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await downloadReportCsv({ report: "assets", status: "ACTIVE", page: 7, size: 200 });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/reports/assets/export?status=ACTIVE", {
      credentials: "include",
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");
  });

  it("rejects an exposed CSV filename that differs from the static contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bytes\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=UTF-8",
        "Content-Disposition": 'attachment; filename="unexpected.csv"',
      },
    })));
    await expect(downloadReportCsv({ report: "assets", page: 0, size: 50 }))
      .rejects.toThrow(ReportContractError);
  });

  it("differentiates RFC 9457 export limits without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "REPORT_EXPORT_LIMIT_EXCEEDED",
      correlationId: "a4844482-1d29-4d30-87fd-1bb67a22e050",
    }), { status: 422, headers: { "Content-Type": "application/problem+json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadReportCsv({ report: "tickets", page: 0, size: 50 })).rejects.toMatchObject({
      status: 422,
      problem: { code: "REPORT_EXPORT_LIMIT_EXCEEDED" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("converts only valid UTC form values", () => {
    expect(utcInputToInstant("2026-11-27T12:30")).toBe("2026-11-27T12:30:00Z");
    expect(utcInputToInstant("2026-02-30T12:30")).toBeNull();
    expect(utcInputToInstant("2026-11-27")).toBeNull();
  });
});
