import type { Session } from "@/features/auth/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportingWorkspace } from "./reporting-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Operator.One",
  roles: ["IT_OPERATOR"],
  csrfToken: "csrf-token",
  expiresAt: "2026-11-27T20:00:00Z",
};
const asset = {
  assetId: "f4844482-1d29-4d30-87fd-1bb67a22e050",
  name: "<b>Workstation</b>",
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
  lastSeenAt: null,
  lastSnapshotAt: null,
  createdAt: "2026-11-27T11:00:00Z",
  updatedAt: "2026-11-27T12:00:00Z",
};

function page(items: unknown[], pageNumber = 0, size = 50, total = items.length) {
  return { items, page: pageNumber, size, totalElements: total, totalPages: Math.ceil(total / size) };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": status === 200 ? "application/json" : "application/problem+json" },
  });
}

function renderWorkspace(current: Session = session) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReportingWorkspace session={current} />
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("ReportingWorkspace", () => {
  it("applies the exact role union without implicit SYSTEM_ADMIN access", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(page([])));
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace({ ...session, roles: ["SYSTEM_ADMIN"] });
    expect(screen.queryByRole("heading", { name: "Reportes" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    cleanup();
    renderWorkspace({ ...session, roles: ["SUPPORT_TECHNICIAN", "IT_OPERATOR"] });
    expect(await screen.findByRole("heading", { name: "Reportes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tickets" })).toBeTruthy();
  });

  it("restores a shareable URL, segments cache by user, and renders escaped values", async () => {
    window.history.replaceState(null, "", "/?report=agents&reportStatus=ACTIVE&reportPage=0&reportSize=50");
    const fetchMock = vi.fn().mockResolvedValue(json(page([agent])));
    vi.stubGlobal("fetch", fetchMock);
    const client = renderWorkspace();

    expect(await screen.findByText(agent.agentId)).toBeTruthy();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/reports/agents?status=ACTIVE&page=0&size=50");
    expect(client.getQueryCache().getAll()[0].queryKey.slice(0, 4)).toEqual([
      "users", session.userId, "reporting", "agents",
    ]);
    expect(window.location.search).toContain("report=agents");
    expect(window.location.search).toContain("reportStatus=ACTIVE");
  });

  it("validates filters locally and publishes applied filters and pagination in the URL", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("page=1")) return Promise.resolve(json(page([asset], 1, 50, 51)));
      if (url.includes("status=ACTIVE")) return Promise.resolve(json(page([asset], 0, 50, 51)));
      return Promise.resolve(json(page([])));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();
    await screen.findByText("No hay filas para estos filtros.");

    fireEvent.change(screen.getByLabelText("Tipo de activo"), { target: { value: "lowercase" } });
    fireEvent.submit(screen.getByRole("form", { name: "Filtros del reporte de Assets" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Tipo de activo");
    expect(fetchMock).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText("Tipo de activo"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "ACTIVE" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await screen.findByText(/Página 1 de 2/);
    expect(window.location.search).toContain("reportStatus=ACTIVE");
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/v1/reports/assets?status=ACTIVE&page=0&size=50");

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText(/Página 2 de 2/);
    expect(window.location.search).toContain("reportPage=1");
  });

  it("blocks duplicate CSV actions and revokes the object URL", async () => {
    let resolveExport!: (response: Response) => void;
    const exportResponse = new Promise<Response>((resolve) => {
      resolveExport = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request) => (
      String(input).includes("/export") ? exportResponse : Promise.resolve(json(page([asset])))
    ));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWorkspace();
    await screen.findByText("<b>Workstation</b>");
    expect(document.querySelector("b")).toBeNull();

    const download = screen.getByRole("button", { name: "Descargar CSV" });
    fireEvent.click(download);
    await vi.waitFor(() => expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes("/export")),
    ).toHaveLength(1));
    fireEvent.click(download);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/export"))).toHaveLength(1);
    resolveExport(new Response("bytes\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=UTF-8",
        "Content-Disposition": 'attachment; filename="assets-report.csv"',
      },
    }));
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:report"));
  });

  it.each([
    [422, "REPORT_EXPORT_LIMIT_EXCEEDED", "supera 10.000 filas"],
    [503, "REPORT_UNAVAILABLE", "no está disponible"],
  ])("shows differentiated export problem %s", async (status, code, message) => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => (
      String(input).includes("/export")
        ? Promise.resolve(json({ code, correlationId: asset.assetId }, status))
        : Promise.resolve(json(page([])))
    )));
    renderWorkspace();
    await screen.findByText("No hay filas para estos filtros.");
    fireEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(message);
    expect(alert.textContent).toContain(asset.assetId);
  });

  it("clears sensitive caches and redirects after an expired session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      code: "AUTHENTICATION_REQUIRED", correlationId: asset.assetId,
    }, 401)));
    const client = renderWorkspace();
    client.setQueryData(["sensitive"], "value");
    await screen.findByRole("alert");
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(client.getQueryData(["sensitive"])).toBeUndefined();
  });
});
