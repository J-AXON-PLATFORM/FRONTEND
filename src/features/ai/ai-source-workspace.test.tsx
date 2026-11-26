import type { Session } from "@/features/auth/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSourceWorkspace } from "./ai-source-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Bootstrap.Admin",
  roles: ["SYSTEM_ADMIN"],
  csrfToken: "csrf-token",
  expiresAt: "2026-10-31T20:00:00Z",
};
const source = {
  sourceId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  name: "Operations handbook",
  mediaType: "text/plain",
  sizeBytes: 17,
  sha256: "a".repeat(64),
  status: "PENDING",
  version: 0,
  createdByUserId: session.userId,
  createdAt: "2026-10-31T12:00:00Z",
  updatedAt: "2026-10-31T12:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AiSourceWorkspace", () => {
  it("rejects non-UTF-8 locally without confirmation or upload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyPage());
    const confirm = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirm);
    renderWorkspace();
    await screen.findByText("No hay fuentes registradas.");

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "  Operations   handbook  " } });
    const fileInput = screen.getByLabelText("Archivo de texto") as HTMLInputElement;
    const invalid = new File([new Uint8Array([0xc3, 0x28])], "invalid.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [invalid] } });
    submitCreationForm();

    expect((await screen.findByRole("alert")).textContent).toContain("UTF-8 válido");
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fileInput.files?.[0]).toBe(invalid);
  });

  it("preserves the name and file after an API error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(emptyPage())
      .mockResolvedValueOnce(problem(503));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderWorkspace();
    await screen.findByText("No hay fuentes registradas.");

    const name = screen.getByLabelText("Nombre") as HTMLInputElement;
    const fileInput = screen.getByLabelText("Archivo de texto") as HTMLInputElement;
    const file = new File(["valid text"], "source.txt", { type: "text/plain" });
    fireEvent.change(name, { target: { value: "Operations handbook" } });
    fireEvent.change(fileInput, { target: { files: [file] } });
    submitCreationForm();

    expect((await screen.findByRole("alert")).textContent).toContain("no está disponible");
    expect(name.value).toBe("Operations handbook");
    expect(fileInput.files?.[0]).toBe(file);
  });

  it("confirms once, blocks duplicate submission, then refetches list and detail before clearing", async () => {
    let resolveCreation!: (response: Response) => void;
    const pendingCreation = new Promise<Response>((resolve) => { resolveCreation = resolve; });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return pendingCreation;
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) return json(source);
      if (url.includes("/ai/sources?page=0")) {
        const created = fetchMock.mock.calls.some(([, options]) => options?.method === "POST");
        return created ? json({ ...emptyPageBody(), items: [source], totalElements: 1, totalPages: 1 }) : emptyPage();
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirm);
    renderWorkspace();
    await screen.findByText("No hay fuentes registradas.");

    const name = screen.getByLabelText("Nombre") as HTMLInputElement;
    const fileInput = screen.getByLabelText("Archivo de texto") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  Operations   handbook  " } });
    fireEvent.change(fileInput, {
      target: { files: [new File(["valid source text"], "source.txt", { type: "text/plain" })] },
    });
    submitCreationForm();
    await screen.findByRole("button", { name: "Registrando fuente..." });
    fireEvent.submit(screen.getByRole("button", { name: "Registrando fuente..." }).closest("form")!);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);

    resolveCreation(json(source, 201));
    const detail = await screen.findByRole("article", { name: "Detalle de fuente documental" });
    expect(detail.textContent).toContain("Operations handbook");
    expect(confirm).toHaveBeenCalledOnce();
    expect(name.value).toBe("");
    expect(fileInput.value).toBe("");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/ai/sources?page=0&size=20"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/ai/sources/${source.sourceId}`))).toBe(true);
  });

  it("confirms indexing once, blocks duplicates, and refetches list and detail after 202", async () => {
    let resolveIndexing!: (response: Response) => void;
    let accepted = false;
    const pendingIndexing = new Promise<Response>((resolve) => { resolveIndexing = resolve; });
    const indexingSource = { ...source, status: "INDEXING", version: 1 } as const;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/ai/sources/${source.sourceId}/index`) && init?.method === "POST") {
        return pendingIndexing;
      }
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) {
        return Promise.resolve(json(accepted ? indexingSource : source));
      }
      if (url.includes("/ai/sources?page=0")) {
        const item = accepted ? indexingSource : source;
        return Promise.resolve(json({ ...emptyPageBody(), items: [item], totalElements: 1, totalPages: 1 }));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirm);
    renderWorkspace();

    await screen.findByText("Operations handbook");
    fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
    const indexButton = await screen.findByRole("button", { name: "Solicitar indexación" });
    fireEvent.click(indexButton);
    fireEvent.click(indexButton);
    await screen.findByRole("button", { name: "Solicitando indexación..." });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Operations handbook/ }).disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/index"))).toHaveLength(1);
    expect(confirm).toHaveBeenCalledOnce();

    accepted = true;
    resolveIndexing(json(indexingSource, 202));
    await screen.findByText("INDEXING · versión 1");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(`/ai/sources/${source.sourceId}`)).length)
      .toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/ai/sources?page=0")).length)
      .toBeGreaterThanOrEqual(2);
  });

  it.each([
    [409, "versión o el estado actual"],
    [503, "servicio local de indexación no está disponible"],
  ])("keeps the pending source actionable after indexing error %s", async (status, message) => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/index") && init?.method === "POST") return Promise.resolve(problem(status));
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) return Promise.resolve(json(source));
      return Promise.resolve(json({ ...emptyPageBody(), items: [source], totalElements: 1, totalPages: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderWorkspace();

    await screen.findByText("Operations handbook");
    fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Solicitar indexación" }));
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Solicitar indexación" }).disabled).toBe(false);
  });

  it("refreshes an indexing source explicitly without periodic polling", async () => {
    let refreshed = false;
    const indexingSource = { ...source, status: "INDEXING", version: 1 } as const;
    const readySource = { ...source, status: "READY", version: 2 } as const;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) {
        return Promise.resolve(json(refreshed ? readySource : indexingSource));
      }
      return Promise.resolve(json({
        ...emptyPageBody(),
        items: [refreshed ? readySource : indexingSource],
        totalElements: 1,
        totalPages: 1,
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    await screen.findByText("Operations handbook");
    fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
    await screen.findByText("INDEXING · versión 1");
    refreshed = true;
    fireEvent.click(screen.getByRole("button", { name: "Actualizar estado" }));

    await screen.findByText("READY · versión 2");
    expect(screen.getByRole("button", { name: /Operations handbook/ }).textContent).toContain("READY");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(`/ai/sources/${source.sourceId}`)))
      .toHaveLength(2);
  });

  it("does not show an indexing error on a different selected source", async () => {
    const secondSource = {
      ...source,
      sourceId: "59844482-1d29-4d30-87fd-1bb67a22e050",
      name: "Security handbook",
    };
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/index") && init?.method === "POST") return Promise.resolve(problem(503));
      if (url.endsWith(`/ai/sources/${secondSource.sourceId}`)) return Promise.resolve(json(secondSource));
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) return Promise.resolve(json(source));
      return Promise.resolve(json({
        ...emptyPageBody(), items: [source, secondSource], totalElements: 2, totalPages: 1,
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderWorkspace();

    await screen.findByText("Operations handbook");
    fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Solicitar indexación" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /Security handbook/ }));
    await screen.findByRole("heading", { name: "Security handbook" });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Solicitar indexación" })).toBeTruthy();
  });

  it.each(["PENDING", "INDEXING", "DISABLED"] as const)("does not offer disabling for %s sources", async (status) => {
    const current = { ...source, status, version: 2 };
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) return Promise.resolve(json(current));
      return Promise.resolve(json({ ...emptyPageBody(), items: [current], totalElements: 1, totalPages: 1 }));
    }));
    renderWorkspace();

    await screen.findByText("Operations handbook");
    fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
    await screen.findByText(`${status} · versión 2`);

    expect(screen.queryByRole("button", { name: "Deshabilitar" })).toBeNull();
    if (status === "DISABLED") {
      expect(screen.queryByRole("button", { name: "Solicitar indexación" })).toBeNull();
      expect(screen.getByText(/no admite indexación ni reactivación/)).toBeTruthy();
    }
  });

  it.each(["READY", "FAILED"] as const)(
    "confirms disabling a %s source once with the observed version and refetches list and detail",
    async (status) => {
      let resolveDisable!: (response: Response) => void;
      let disabledState = false;
      const pendingDisable = new Promise<Response>((resolve) => { resolveDisable = resolve; });
      const current = { ...source, status, version: 2 } as const;
      const disabled = { ...source, status: "DISABLED", version: 3 } as const;
      const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/disable") && init?.method === "POST") return pendingDisable;
        if (url.endsWith(`/ai/sources/${source.sourceId}`)) {
          return Promise.resolve(json(disabledState ? disabled : current));
        }
        if (url.includes("/ai/sources?page=0")) {
          return Promise.resolve(json({
            ...emptyPageBody(), items: [disabledState ? disabled : current], totalElements: 1, totalPages: 1,
          }));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      });
      const confirm = vi.fn(() => true);
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("confirm", confirm);
      renderWorkspace();

      await screen.findByText("Operations handbook");
      fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
      const disableButton = await screen.findByRole("button", { name: "Deshabilitar" });
      fireEvent.click(disableButton);
      fireEvent.click(disableButton);
      await screen.findByRole("button", { name: "Deshabilitando fuente..." });
      const posts = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/disable"));
      expect(posts).toHaveLength(1);
      expect(posts[0][1]?.body).toBe(JSON.stringify({ expectedVersion: 2 }));
      expect((posts[0][1]?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-token");
      expect(confirm).toHaveBeenCalledOnce();
      expect(screen.getByText(`${status} · versión 2`)).toBeTruthy();

      disabledState = true;
      resolveDisable(json(disabled));
      await screen.findByText("DISABLED · versión 3");
      expect(screen.queryByRole("button", { name: "Deshabilitar" })).toBeNull();
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(`/ai/sources/${source.sourceId}`)).length)
        .toBeGreaterThanOrEqual(2);
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/ai/sources?page=0")).length)
        .toBeGreaterThanOrEqual(2);
    },
  );

  it("does not send the request when the confirmation is cancelled", async () => {
    const current = { ...source, status: "READY", version: 2 } as const;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) return Promise.resolve(json(current));
      return Promise.resolve(json({ ...emptyPageBody(), items: [current], totalElements: 1, totalPages: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderWorkspace();

    await screen.findByText("Operations handbook");
    fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Deshabilitar" }));

    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/disable"))).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Deshabilitar" }).disabled).toBe(false);
  });

  it("shows an accessible conflict and refetches the official state without retrying", async () => {
    let conflicted = false;
    const current = { ...source, status: "READY", version: 2 } as const;
    const changed = { ...source, status: "READY", version: 4 } as const;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/disable") && init?.method === "POST") {
        conflicted = true;
        return Promise.resolve(problem(409));
      }
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) return Promise.resolve(json(conflicted ? changed : current));
      return Promise.resolve(json({
        ...emptyPageBody(), items: [conflicted ? changed : current], totalElements: 1, totalPages: 1,
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderWorkspace();

    await screen.findByText("Operations handbook");
    fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Deshabilitar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("ya no permite deshabilitar");
    await screen.findByText("READY · versión 4");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/disable"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/ai/sources?page=0")).length)
      .toBeGreaterThanOrEqual(2);
  });

  it("keeps the source actionable after a 503 without refetching or retrying", async () => {
    const current = { ...source, status: "FAILED", version: 2 } as const;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/disable") && init?.method === "POST") return Promise.resolve(problem(503));
      if (url.endsWith(`/ai/sources/${source.sourceId}`)) return Promise.resolve(json(current));
      return Promise.resolve(json({ ...emptyPageBody(), items: [current], totalElements: 1, totalPages: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderWorkspace();

    await screen.findByText("Operations handbook");
    fireEvent.click(screen.getByRole("button", { name: /Operations handbook/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Deshabilitar" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Deshabilitar" }).disabled).toBe(false);
    expect(screen.getByText("FAILED · versión 2")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/disable"))).toHaveLength(1);
  });
});

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AiSourceWorkspace session={session} />
    </QueryClientProvider>,
  );
}

function submitCreationForm() {
  fireEvent.submit(screen.getByRole("button", { name: "Registrar fuente" }).closest("form")!);
}

function emptyPageBody() {
  return { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
}

function emptyPage() {
  return json(emptyPageBody());
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function problem(status: number) {
  return new Response(JSON.stringify({
    code: "DOCUMENT_STORAGE_UNAVAILABLE",
    correlationId: "14fb9d5d-b66a-454c-9fea-8dbdcc1c6ac7",
  }), { status, headers: { "Content-Type": "application/problem+json" } });
}
