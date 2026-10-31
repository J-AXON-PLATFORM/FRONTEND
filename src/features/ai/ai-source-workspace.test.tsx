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
