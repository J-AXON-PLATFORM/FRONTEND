import type { Session } from "@/features/auth/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiRetrievalWorkspace } from "./ai-retrieval-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session: Session = {
  userId: "31de253e-dff5-4fbd-85c1-3cb637d319ac",
  username: "Bootstrap.Admin",
  roles: ["SYSTEM_ADMIN"],
  csrfToken: "csrf-token",
  expiresAt: "2026-11-21T20:00:00Z",
};

const result = {
  sourceId: "34844482-1d29-4d30-87fd-1bb67a22e050",
  sourceName: "Operations handbook",
  sourceSha256: "b".repeat(64),
  chunkId: "54844482-1d29-4d30-87fd-1bb67a22e050",
  ordinal: 2,
  startToken: 816,
  endToken: 1296,
  contentSha256: "c".repeat(64),
  content: "Reinicia el servicio con el procedimiento aprobado.",
  similarity: 0.87654,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AiRetrievalWorkspace", () => {
  it("is not rendered and does not request data for other roles", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace({ ...session, roles: ["IT_OPERATOR"] });

    expect(screen.queryByRole("heading", { name: "Recuperación de evidencia" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a blank query locally without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Consulta"), { target: { value: "  ​ " } });
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain("consulta con contenido");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the trimmed query and limit, then shows traceable evidence, not a generated answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ limit: 3, results: [result] }));
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Consulta"), { target: { value: "  reinicio seguro  " } });
    fireEvent.change(screen.getByLabelText("Máximo de fragmentos"), { target: { value: "3" } });
    submit();

    const list = await screen.findByRole("list", { name: "Fragmentos recuperados" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ query: "reinicio seguro", limit: 3 });
    const item = within(list).getByRole("article", { name: "Fragmento 1 de Operations handbook" });
    expect(item.textContent).toContain("similitud 0.8765");
    expect(item.textContent).toContain(result.content);
    expect(item.textContent).toContain(result.sourceId);
    expect(item.textContent).toContain(result.chunkId);
    expect(item.textContent).toContain("ordinal 2 · tokens 816–1296");
    expect(screen.getByText(/sin generación ni interpretación/)).toBeDefined();
  });

  it("shows an empty state without fabricating evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ limit: 5, results: [] })));
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Consulta"), { target: { value: "sin evidencia" } });
    submit();

    expect(await screen.findByText("No se encontró evidencia en fuentes listas para esta consulta.")).toBeDefined();
    expect(screen.queryByRole("list", { name: "Fragmentos recuperados" })).toBeNull();
  });

  it.each([
    [503, "embeddings no está disponible"],
    [422, "Revisa la consulta"],
    [403, "no autoriza"],
  ])("shows a closed error for status %s", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(status)));
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Consulta"), { target: { value: "red" } });
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });

  it("rejects a response that violates the contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ limit: 5, results: [{ ...result, path: "/x" }] })));
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Consulta"), { target: { value: "red" } });
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain("formato no válido");
  });

  it("segments the cache by user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ limit: 5, results: [result] }));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = renderWorkspace();

    fireEvent.change(screen.getByLabelText("Consulta"), { target: { value: "red" } });
    submit();
    await screen.findByRole("list", { name: "Fragmentos recuperados" });

    const keys = queryClient.getQueryCache().getAll().map((entry) => entry.queryKey);
    expect(keys).toContainEqual(["users", session.userId, "ai", "retrieval", { query: "red", limit: 5 }]);
  });

  it("redirects to login after a 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(401)));
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Consulta"), { target: { value: "red" } });
    submit();

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});

function renderWorkspace(user: Session = session) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AiRetrievalWorkspace session={user} />
    </QueryClientProvider>,
  );
  return queryClient;
}

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: "Recuperar fragmentos" }).closest("form")!);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function problem(status: number) {
  return new Response(JSON.stringify({
    code: "AI_RETRIEVAL_UNAVAILABLE",
    correlationId: "14fb9d5d-b66a-454c-9fea-8dbdcc1c6ac7",
  }), { status, headers: { "Content-Type": "application/problem+json" } });
}
