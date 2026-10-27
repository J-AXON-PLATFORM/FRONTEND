import type { Session } from "@/features/auth/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryJobWorkspace } from "./discovery-job-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const operator: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "it.operator",
  roles: ["IT_OPERATOR"],
  csrfToken: "csrf-token",
  expiresAt: "2026-10-26T00:00:00Z",
};
const scope = {
  scopeId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  name: "Office network",
  cidr: "192.0.2.0/24",
  status: "ACTIVE",
  createdByUserId: operator.userId,
  createdAt: "2026-10-25T12:00:00Z",
  updatedAt: "2026-10-25T12:00:00Z",
  version: 0,
};
const executor = {
  executorId: "95e086af-07d1-49b9-b570-2b9b52878770",
  name: "Office executor",
  scopeIds: [scope.scopeId],
  status: "ACTIVE",
  publicKeyRegistered: true,
  publicKeyFingerprint: "SHA256:vi4Mo/pzHrbpqbCCSjJz4KjU8NjWTGGjHSXfTYzA9aE",
  createdByUserId: operator.userId,
  createdAt: "2026-10-25T12:00:00Z",
  updatedAt: "2026-10-25T12:00:00Z",
  version: 1,
};
const job = {
  jobId: "ea9dc882-57ce-4b40-a552-969760f33196",
  executorId: executor.executorId,
  scopeId: scope.scopeId,
  profile: "BASIC",
  status: "DISPATCHED",
  createdAt: "2026-10-25T12:00:00Z",
  expiresAt: "2026-10-25T13:00:00Z",
  dispatchedAt: "2026-10-25T12:00:01Z",
  startedAt: null,
  completedAt: null,
  failureCode: null,
  summary: null,
  version: 1,
};
const succeededJob = {
  ...job,
  status: "SUCCEEDED",
  startedAt: "2026-10-25T12:01:00Z",
  completedAt: "2026-10-25T12:02:00Z",
  summary: { targetsConsidered: 256, targetsScanned: 256, observationsFound: 1 },
  version: 2,
};
const device = {
  discoveredDeviceId: "33cdd354-5b5d-42e1-9647-4420f407a97f",
  jobId: job.jobId,
  status: "UNREVIEWED",
  ipAddress: "192.0.2.10",
  macAddress: "02:00:5e:10:00:01",
  hostname: "host.example.internal",
  evidence: ["ARP", "TCP"],
  openTcpPorts: [22, 443],
  observedAt: "2026-10-25T12:02:00Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("DiscoveryJobWorkspace", () => {
  it("creates a BASIC job for an active executor and associated active scope", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/discovery/scopes")) return page([scope], 50);
      if (url.includes("/discovery/executors?page=")) return page([executor], 20);
      if (url.endsWith("/discovery/jobs") && init?.method === "POST") return json(job, 201);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    await screen.findByRole("option", { name: "Office executor" });
    fireEvent.change(screen.getByLabelText("Executor activo"), {
      target: { value: executor.executorId },
    });
    await screen.findByRole("option", { name: /Office network/ });
    fireEvent.change(screen.getByLabelText("Ámbito activo asociado"), {
      target: { value: scope.scopeId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear Discovery Job" }));

    expect(await screen.findByText("Job BASIC")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Estado del Discovery Job" }).textContent)
      .toContain("DISPATCHED · versión 1");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/discovery/jobs", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "X-CSRF-Token": operator.csrfToken }),
      body: JSON.stringify({ executorId: executor.executorId, scopeId: scope.scopeId }),
    }));
  });

  it("does not retry an unavailable job publication", async () => {
    const pending = { ...job, status: "PENDING", dispatchedAt: null, version: 0 };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/discovery/scopes")) return page([scope], 50);
      if (url.includes("/discovery/executors?page=")) return page([executor], 20);
      if (url.endsWith("/discovery/jobs") && init?.method === "POST") {
        return new Response(JSON.stringify({
          code: "DISCOVERY_JOB_PUBLICATION_UNAVAILABLE", correlationId: crypto.randomUUID(),
        }), {
          status: 503,
          headers: {
            "Content-Type": "application/problem+json",
            Location: `/api/v1/discovery/jobs/${job.jobId}`,
          },
        });
      }
      if (url.endsWith(`/discovery/jobs/${job.jobId}`)) return json(pending);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    await screen.findByRole("option", { name: "Office executor" });
    fireEvent.change(screen.getByLabelText("Executor activo"), {
      target: { value: executor.executorId },
    });
    await screen.findByRole("option", { name: /Office network/ });
    fireEvent.change(screen.getByLabelText("Ámbito activo asociado"), {
      target: { value: scope.scopeId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear Discovery Job" }));

    expect((await screen.findByRole("alert")).textContent).toContain("quedó pendiente");
    expect(await screen.findByRole("article", { name: "Estado del Discovery Job" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear Discovery Job" }).hasAttribute("disabled")).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("retrieves one job explicitly by UUID", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/discovery/scopes")) return page([scope], 50);
      if (url.includes("/discovery/executors?page=")) return page([executor], 20);
      if (url.endsWith(`/discovery/jobs/${job.jobId}`)) return json(job);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("UUID del job"), { target: { value: job.jobId } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar job" }));

    expect(await screen.findByRole("article", { name: "Estado del Discovery Job" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(job.jobId))).toHaveLength(1);
  });

  it("lists observed devices only for a successful job", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/discovery/scopes")) return page([scope], 50);
      if (url.includes("/discovery/executors?page=")) return page([executor], 20);
      if (url.endsWith(`/discovery/jobs/${job.jobId}`)) return json(succeededJob);
      if (url.includes(`/discovery-jobs/${job.jobId}/discovered-devices?page=0&size=20`)) {
        return page([device], 20);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("UUID del job"), { target: { value: job.jobId } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar job" }));

    expect(await screen.findByRole("heading", { name: "host.example.internal" })).toBeTruthy();
    const devices = screen.getByRole("region", { name: "Dispositivos descubiertos" });
    expect(devices.textContent).toContain("UNREVIEWED");
    expect(devices.textContent).toContain("192.0.2.10");
    expect(devices.textContent).toContain("22, 443");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("discovered-devices?page=0&size=20")))
      .toBe(true);
  });

  it("does not request data for users without IT_OPERATOR", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace({ ...operator, roles: ["SYSTEM_ADMIN"] });

    expect(screen.getByRole("heading", { name: "Sin permiso de operación" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function renderWorkspace(session = operator) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DiscoveryJobWorkspace session={session} />
    </QueryClientProvider>,
  );
}

function page(items: unknown[], size: number) {
  return json({ items, page: 0, size, totalElements: items.length, totalPages: items.length ? 1 : 0 });
}

function json(body: unknown, status = 200, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": contentType } });
}
