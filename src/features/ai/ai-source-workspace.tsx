"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AiSourceContractError,
  createAiSource,
  disableAiSource,
  getAiSource,
  indexAiSource,
  listAiSources,
  normalizeAiSourceName,
  type AiSource,
} from "./api";

const PAGE_SIZE = 20;
const MAX_BYTES = 1_048_576;

function listKey(userId: string, page: number) {
  return ["users", userId, "ai", "sources", { page, size: PAGE_SIZE }] as const;
}

function detailKey(userId: string, sourceId: string) {
  return ["users", userId, "ai", "source", sourceId] as const;
}

export function AiSourceWorkspace({ session }: Readonly<{ session: Session }>) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const indexLock = useRef(false);
  const disableLock = useRef(false);
  const [page, setPage] = useState(0);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const allowed = session.roles.includes("SYSTEM_ADMIN");

  const sources = useQuery({
    queryKey: listKey(session.userId, page),
    queryFn: () => listAiSources(page, PAGE_SIZE),
    enabled: allowed,
    retry: false,
  });
  const detail = useQuery({
    queryKey: detailKey(session.userId, selectedSourceId ?? ""),
    queryFn: () => getAiSource(selectedSourceId!),
    enabled: allowed && selectedSourceId !== null,
    retry: false,
  });
  const creation = useMutation({
    mutationFn: ({ normalizedName, selectedFile }: { normalizedName: string; selectedFile: File }) => (
      createAiSource(normalizedName, selectedFile, session.csrfToken)
    ),
    retry: false,
    onSuccess: (created) => {
      setName("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setValidationError(null);
      setPage(0);
      setSelectedSourceId(created.sourceId);
      void queryClient.invalidateQueries({
        queryKey: listKey(session.userId, 0),
        exact: true,
      });
    },
    onSettled: () => {
      submitLock.current = false;
    },
  });
  const indexing = useMutation({
    mutationFn: (source: AiSource) => indexAiSource(
      source.sourceId,
      source.version,
      session.csrfToken,
    ),
    retry: false,
    onSuccess: async (accepted) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["users", session.userId, "ai", "sources"],
        }),
        queryClient.invalidateQueries({
          queryKey: detailKey(session.userId, accepted.sourceId),
          exact: true,
        }),
      ]);
    },
    onError: async (error, source) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["users", session.userId, "ai", "sources"],
          }),
          queryClient.invalidateQueries({
            queryKey: detailKey(session.userId, source.sourceId),
            exact: true,
          }),
        ]);
      }
    },
    onSettled: () => {
      indexLock.current = false;
    },
  });

  const disabling = useMutation({
    mutationFn: (source: AiSource) => disableAiSource(
      source.sourceId,
      source.version,
      session.csrfToken,
    ),
    retry: false,
    onSuccess: async (disabled) => {
      await Promise.all([
        refreshSource(disabled.sourceId),
        queryClient.invalidateQueries({
          queryKey: ["users", session.userId, "ai", "retrieval"],
        }),
      ]);
    },
    onError: async (error, source) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        await refreshSource(source.sourceId);
      }
    },
    onSettled: () => {
      disableLock.current = false;
    },
  });

  async function refreshSource(sourceId: string) {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["users", session.userId, "ai", "sources"],
      }),
      queryClient.invalidateQueries({
        queryKey: detailKey(session.userId, sourceId),
        exact: true,
      }),
    ]);
  }

  const authenticationError = [
    sources.error, detail.error, creation.error, indexing.error, disabling.error,
  ]
    .some((error) => error instanceof ApiError && error.status === 401);
  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  if (!allowed) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setValidating(true);
    creation.reset();
    const normalizedName = normalizeAiSourceName(name);
    if (!normalizedName || [...normalizedName].length > 256) {
      setValidationError("El nombre normalizado debe contener entre 1 y 256 caracteres.");
      unlockValidation();
      return;
    }
    if (!file) {
      setValidationError("Selecciona un archivo de texto.");
      unlockValidation();
      return;
    }
    if (file.type !== "text/plain") {
      setValidationError("El archivo debe declarar exactamente el tipo text/plain.");
      unlockValidation();
      return;
    }
    if (file.size > MAX_BYTES) {
      setValidationError("El archivo no puede superar 1 MiB.");
      unlockValidation();
      return;
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      setValidationError("El archivo debe contener UTF-8 válido.");
      unlockValidation();
      return;
    }
    setValidationError(null);
    if (!window.confirm(`Registrar la fuente documental “${normalizedName}”?`)) {
      unlockValidation();
      return;
    }
    setValidating(false);
    creation.mutate({ normalizedName, selectedFile: file });
  }

  function unlockValidation() {
    submitLock.current = false;
    setValidating(false);
  }

  function requestIndexing(source: AiSource) {
    if (source.status !== "PENDING" || indexLock.current) return;
    indexLock.current = true;
    indexing.reset();
    if (!window.confirm(`Indexar la fuente documental “${source.name}” en versión ${source.version}?`)) {
      indexLock.current = false;
      return;
    }
    indexing.mutate(source);
  }

  function requestDisable(source: AiSource) {
    if ((source.status !== "READY" && source.status !== "FAILED") || disableLock.current) return;
    disableLock.current = true;
    disabling.reset();
    if (!window.confirm(
      `Deshabilitar la fuente documental “${source.name}” en versión ${source.version}? `
        + "Dejará de usarse en la recuperación y no puede reactivarse desde J-AXON.",
    )) {
      disableLock.current = false;
      return;
    }
    disabling.mutate(source);
  }

  return (
    <section className="ai-source-workspace" aria-labelledby="ai-source-title">
      <header className="workspace-heading ai-heading">
        <div>
          <p className="sequence">AI / fuentes controladas</p>
          <h2 id="ai-source-title">Fuentes documentales</h2>
        </div>
        <p>Registra originales de texto para preparación posterior. Este espacio muestra únicamente metadata.</p>
      </header>

      <div className="ai-source-grid">
        <form className="ai-source-form" onSubmit={submit}>
          <div className="form-heading"><span>01</span><h3>Nueva fuente</h3></div>
          <div className="field">
            <label htmlFor="ai-source-name">Nombre</label>
            <input
              id="ai-source-name"
              required
              maxLength={512}
              value={name}
              disabled={validating || creation.isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ai-source-file">Archivo de texto</label>
            <input
              ref={fileInput}
              id="ai-source-file"
              type="file"
              required
              accept="text/plain,.txt"
              disabled={validating || creation.isPending}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setValidationError(null);
              }}
            />
            <small>Solo text/plain, UTF-8 estricto y hasta 1 MiB.</small>
          </div>
          {validationError && <p className="form-error" role="alert">{validationError}</p>}
          {creation.isError && <p className="form-error" role="alert">{sourceError(creation.error, "registrar")}</p>}
          <button type="submit" disabled={validating || creation.isPending}>
            {validating ? "Validando fuente..." : creation.isPending ? "Registrando fuente..." : "Registrar fuente"}
          </button>
        </form>

        <div className="ai-source-list" aria-live="polite">
          <div className="form-heading"><span>02</span><h3>Fuentes registradas</h3></div>
          {sources.isPending && <p className="administration-empty">Consultando fuentes...</p>}
          {sources.isError && <p className="form-error" role="alert">{sourceError(sources.error, "listar")}</p>}
          {sources.data?.items.length === 0 && <p className="administration-empty">No hay fuentes registradas.</p>}
          {sources.data && sources.data.items.length > 0 && (
            <ul>
              {sources.data.items.map((source) => (
                <li key={source.sourceId}>
                  <button
                    type="button"
                    disabled={indexing.isPending || disabling.isPending}
                    aria-pressed={selectedSourceId === source.sourceId}
                    onClick={() => setSelectedSourceId(source.sourceId)}
                  >
                    <span><strong>{source.name}</strong><small>{source.sourceId}</small></span>
                    <span>{source.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sources.data && (
            <nav className="ai-source-pagination" aria-label="Paginación de fuentes documentales">
              <button type="button" disabled={sources.isFetching || page === 0} onClick={() => setPage((current) => current - 1)}>Anterior</button>
              <span>Página {sources.data.totalPages === 0 ? 0 : page + 1} de {sources.data.totalPages}</span>
              <button type="button" disabled={sources.isFetching || page + 1 >= sources.data.totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente</button>
            </nav>
          )}
        </div>
      </div>

      {selectedSourceId && (
        <div className="ai-source-detail" aria-live="polite">
          {detail.isPending && <p className="administration-empty">Consultando detalle...</p>}
          {detail.isError && <p className="form-error" role="alert">{sourceError(detail.error, "consultar")}</p>}
          {detail.data && (
            <AiSourceDetail
              source={detail.data}
              indexing={indexing.isPending && indexing.variables?.sourceId === detail.data.sourceId}
              indexingError={indexing.isError && indexing.variables?.sourceId === detail.data.sourceId
                ? indexing.error
                : null}
              disabling={disabling.isPending && disabling.variables?.sourceId === detail.data.sourceId}
              disableError={disabling.isError && disabling.variables?.sourceId === detail.data.sourceId
                ? disabling.error
                : null}
              refreshing={detail.isFetching}
              onIndex={requestIndexing}
              onDisable={requestDisable}
              onRefresh={() => {
                void Promise.all([
                  detail.refetch(),
                  queryClient.invalidateQueries({
                    queryKey: ["users", session.userId, "ai", "sources"],
                  }),
                ]);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

function AiSourceDetail({
  source,
  indexing,
  indexingError,
  disabling,
  disableError,
  refreshing,
  onIndex,
  onDisable,
  onRefresh,
}: Readonly<{
  source: AiSource;
  indexing: boolean;
  indexingError: Error | null;
  disabling: boolean;
  disableError: Error | null;
  refreshing: boolean;
  onIndex: (source: AiSource) => void;
  onDisable: (source: AiSource) => void;
  onRefresh: () => void;
}>) {
  return (
    <article aria-label="Detalle de fuente documental">
      <p className="sequence">{source.status} · versión {source.version}</p>
      <h3>{source.name}</h3>
      <dl>
        <div><dt>Source ID</dt><dd>{source.sourceId}</dd></div>
        <div><dt>Tipo</dt><dd>{source.mediaType}</dd></div>
        <div><dt>Tamaño</dt><dd>{source.sizeBytes} bytes</dd></div>
        <div><dt>SHA-256</dt><dd>{source.sha256}</dd></div>
        <div><dt>Creado por</dt><dd>{source.createdByUserId}</dd></div>
        <div><dt>Creado</dt><dd>{formatUtc(source.createdAt)}</dd></div>
        <div><dt>Actualizado</dt><dd>{formatUtc(source.updatedAt)}</dd></div>
      </dl>
      {source.status === "PENDING" && (
        <div className="ai-source-indexing">
          <p>La indexación crea fragmentos y vectores locales de forma asíncrona.</p>
          {indexingError && <p className="form-error" role="alert">{sourceError(indexingError, "indexar")}</p>}
          <button type="button" disabled={indexing} onClick={() => onIndex(source)}>
            {indexing ? "Solicitando indexación..." : "Solicitar indexación"}
          </button>
        </div>
      )}
      {source.status !== "PENDING" && (
        <div className="ai-source-indexing">
          <p>REST conserva el estado oficial de la indexación.</p>
          <button type="button" disabled={refreshing || disabling} onClick={onRefresh}>
            {refreshing ? "Actualizando estado..." : "Actualizar estado"}
          </button>
        </div>
      )}
      {(source.status === "READY" || source.status === "FAILED") && (
        <div className="ai-source-indexing">
          <p>Deshabilitar excluye la fuente de toda recuperación de inmediato y conserva su original, fragmentos y vectores. No existe reactivación.</p>
          {disableError && <p className="form-error" role="alert">{sourceError(disableError, "deshabilitar")}</p>}
          <button type="button" disabled={disabling || refreshing} onClick={() => onDisable(source)}>
            {disabling ? "Deshabilitando fuente..." : "Deshabilitar"}
          </button>
        </div>
      )}
      {source.status === "DISABLED" && (
        <p className="administration-empty">Fuente deshabilitada: no participa en la recuperación y no admite indexación ni reactivación.</p>
      )}
    </article>
  );
}

function sourceError(error: Error | null, action: "registrar" | "listar" | "consultar" | "indexar" | "deshabilitar",
) {
  if (error instanceof AiSourceContractError) {
    return "El servicio devolvió metadata de AI con un formato no válido.";
  }
  if (!(error instanceof ApiError)) return `No fue posible ${action} fuentes documentales.`;
  if (error.status === 401) return "La sesión ya no es válida.";
  if (error.status === 403) return "La sesión no autoriza esta operación.";
  if (error.status === 404) return "La fuente documental ya no existe.";
  if (action === "indexar" && error.status === 409) {
    return "La versión o el estado actual ya no permite iniciar la indexación.";
  }
  if (action === "deshabilitar" && error.status === 409) {
    return "La versión o el estado actual ya no permite deshabilitar la fuente. Se reconsultó su estado.";
  }
  if (action === "deshabilitar" && (error.status === 400 || error.status === 422)) {
    return "La solicitud de deshabilitación no es válida.";
  }
  if (error.status === 413) return "El archivo supera el máximo de 1 MiB.";
  if (error.status === 400 || error.status === 422) return "Revisa el nombre, tipo, tamaño y codificación del archivo.";
  if (error.status === 503) return action === "indexar"
    ? "El servicio local de indexación no está disponible."
    : "El almacenamiento documental no está disponible.";
  return `No fue posible ${action} fuentes documentales.`;
}

function formatUtc(value: string) {
  return `${new Date(value).toLocaleString("es-ES", { timeZone: "UTC" })} UTC`;
}
