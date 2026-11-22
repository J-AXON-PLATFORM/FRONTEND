"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  AI_RETRIEVAL_DEFAULT_LIMIT,
  AI_RETRIEVAL_MAX_LIMIT,
  AI_RETRIEVAL_MAX_QUERY,
  AiSourceContractError,
  retrieveAiChunks,
  trimAiRetrievalQuery,
  type AiRetrievalResult,
} from "./api";

type Submitted = { query: string; limit: number };

function retrievalKey(userId: string, submitted: Submitted | null) {
  return ["users", userId, "ai", "retrieval", submitted] as const;
}

const LIMITS = Array.from({ length: AI_RETRIEVAL_MAX_LIMIT }, (_, index) => index + 1);

export function AiRetrievalWorkspace({ session }: Readonly<{ session: Session }>) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(AI_RETRIEVAL_DEFAULT_LIMIT);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const allowed = session.roles.includes("SYSTEM_ADMIN");

  const retrieval = useQuery({
    queryKey: retrievalKey(session.userId, submitted),
    queryFn: () => retrieveAiChunks(submitted!.query, submitted!.limit, session.csrfToken),
    enabled: allowed && submitted !== null,
    retry: false,
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const authenticationError = retrieval.error instanceof ApiError && retrieval.error.status === 401;
  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  if (!allowed) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (retrieval.isFetching) return;
    const normalized = trimAiRetrievalQuery(query);
    if (!normalized) {
      setValidationError("Escribe una consulta con contenido.");
      return;
    }
    if ([...query].length > AI_RETRIEVAL_MAX_QUERY) {
      setValidationError(`La consulta no puede superar ${AI_RETRIEVAL_MAX_QUERY} caracteres.`);
      return;
    }
    setValidationError(null);
    const next = { query: normalized, limit };
    if (submitted && submitted.query === next.query && submitted.limit === next.limit) {
      void retrieval.refetch();
      return;
    }
    setSubmitted(next);
  }

  const busy = retrieval.isFetching;

  return (
    <section className="ai-retrieval-workspace" aria-labelledby="ai-retrieval-title">
      <header className="workspace-heading ai-heading">
        <div>
          <p className="sequence">AI / recuperación de evidencia</p>
          <h2 id="ai-retrieval-title">Recuperación de evidencia</h2>
        </div>
        <p>
          Busca fragmentos literales en fuentes indexadas y listas. Los resultados son evidencia recuperada,
          no respuestas generadas por IA.
        </p>
      </header>

      <form className="ai-retrieval-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="ai-retrieval-query">Consulta</label>
          <textarea
            id="ai-retrieval-query"
            rows={3}
            maxLength={AI_RETRIEVAL_MAX_QUERY}
            value={query}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setValidationError(null);
            }}
          />
          <small>Hasta {AI_RETRIEVAL_MAX_QUERY} caracteres. No se guarda la consulta.</small>
        </div>
        <div className="field">
          <label htmlFor="ai-retrieval-limit">Máximo de fragmentos</label>
          <select
            id="ai-retrieval-limit"
            value={limit}
            disabled={busy}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            {LIMITS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        {validationError && <p className="form-error" role="alert">{validationError}</p>}
        <button type="submit" disabled={busy}>{busy ? "Recuperando fragmentos..." : "Recuperar fragmentos"}</button>
      </form>

      <div className="ai-retrieval-results" aria-live="polite">
        {busy && <p className="administration-empty">Recuperando fragmentos...</p>}
        {!busy && retrieval.isError && (
          <p className="form-error" role="alert">{retrievalError(retrieval.error)}</p>
        )}
        {!busy && retrieval.isSuccess && retrieval.data.results.length === 0 && (
          <p className="administration-empty">No se encontró evidencia en fuentes listas para esta consulta.</p>
        )}
        {!busy && retrieval.isSuccess && retrieval.data.results.length > 0 && (
          <>
            <p className="ai-retrieval-disclaimer">
              {retrieval.data.results.length} fragmento(s) recuperado(s) por similitud. Texto literal de las fuentes,
              sin generación ni interpretación.
            </p>
            <ol aria-label="Fragmentos recuperados">
              {retrieval.data.results.map((result, index) => (
                <RetrievedChunk key={result.chunkId} rank={index + 1} result={result} />
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

function RetrievedChunk({ rank, result }: Readonly<{ rank: number; result: AiRetrievalResult }>) {
  return (
    <li>
      <article aria-label={`Fragmento ${rank} de ${result.sourceName}`}>
        <header>
          <span className="sequence">#{rank} · similitud {result.similarity.toFixed(4)}</span>
          <h3>{result.sourceName}</h3>
        </header>
        <blockquote>{result.content}</blockquote>
        <dl>
          <div><dt>Source ID</dt><dd>{result.sourceId}</dd></div>
          <div><dt>SHA-256 fuente</dt><dd>{result.sourceSha256}</dd></div>
          <div><dt>Fragmento</dt><dd>ordinal {result.ordinal} · tokens {result.startToken}–{result.endToken}</dd></div>
          <div><dt>Chunk ID</dt><dd>{result.chunkId}</dd></div>
          <div><dt>SHA-256 fragmento</dt><dd>{result.contentSha256}</dd></div>
        </dl>
      </article>
    </li>
  );
}

function retrievalError(error: Error | null) {
  if (error instanceof AiSourceContractError) {
    return "El servicio devolvió fragmentos con un formato no válido.";
  }
  if (!(error instanceof ApiError)) return "No fue posible recuperar fragmentos.";
  if (error.status === 401) return "La sesión ya no es válida.";
  if (error.status === 403) return "La sesión no autoriza esta operación.";
  if (error.status === 400 || error.status === 422) return "Revisa la consulta y el máximo de fragmentos.";
  if (error.status === 503) return "El servicio local de embeddings no está disponible.";
  return "No fue posible recuperar fragmentos.";
}
