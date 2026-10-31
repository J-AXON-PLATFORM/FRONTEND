"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AiSourceContractError,
  createAiSource,
  getAiSource,
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

  const authenticationError = [sources.error, detail.error, creation.error]
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
          {detail.data && <AiSourceDetail source={detail.data} />}
        </div>
      )}
    </section>
  );
}

function AiSourceDetail({ source }: Readonly<{ source: AiSource }>) {
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
    </article>
  );
}

function sourceError(error: Error | null, action: "registrar" | "listar" | "consultar") {
  if (error instanceof AiSourceContractError) {
    return "El servicio devolvió metadata de AI con un formato no válido.";
  }
  if (!(error instanceof ApiError)) return `No fue posible ${action} fuentes documentales.`;
  if (error.status === 401) return "La sesión ya no es válida.";
  if (error.status === 403) return "La sesión no autoriza esta operación.";
  if (error.status === 404) return "La fuente documental ya no existe.";
  if (error.status === 413) return "El archivo supera el máximo de 1 MiB.";
  if (error.status === 400 || error.status === 422) return "Revisa el nombre, tipo, tamaño y codificación del archivo.";
  if (error.status === 503) return "El almacenamiento documental no está disponible.";
  return `No fue posible ${action} fuentes documentales.`;
}

function formatUtc(value: string) {
  return `${new Date(value).toLocaleString("es-ES", { timeZone: "UTC" })} UTC`;
}
