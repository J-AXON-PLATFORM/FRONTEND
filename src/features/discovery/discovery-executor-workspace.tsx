"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  createDiscoveryExecutor,
  DiscoveryExecutorContractError,
  getDiscoveryExecutor,
  listAllAuthorizedScopes,
  listDiscoveryExecutors,
  registerDiscoveryExecutorPublicKey,
  type DiscoveryExecutor,
} from "./api";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ED25519_PUBLIC_KEY = /^ssh-ed25519\s+[A-Za-z0-9+/]+={0,2}(?:\s+.*)?$/;

export function DiscoveryExecutorWorkspace({ session }: Readonly<{ session: Session }>) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [selectedExecutorId, setSelectedExecutorId] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const scopeKey = [
    "discovery", "executor-scope-options", session.userId, "SYSTEM_ADMIN",
  ] as const;
  const listKey = ["discovery", "executors", session.userId, "SYSTEM_ADMIN", page] as const;
  const detailKey = [
    "discovery", "executors", session.userId, "SYSTEM_ADMIN", "detail", selectedExecutorId,
  ] as const;

  const scopes = useQuery({
    queryKey: scopeKey,
    queryFn: listAllAuthorizedScopes,
    retry: retryQuery,
  });
  const executors = useQuery({
    queryKey: listKey,
    queryFn: () => listDiscoveryExecutors(page),
    retry: retryQuery,
  });
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => getDiscoveryExecutor(selectedExecutorId!),
    enabled: selectedExecutorId !== null && UUID_V4.test(selectedExecutorId),
    retry: retryQuery,
  });
  const creation = useMutation({
    mutationFn: () => createDiscoveryExecutor(name.trim(), selectedScopes, session.csrfToken),
    retry: false,
    onSuccess: async (created) => {
      setName("");
      setSelectedScopes([]);
      setLocalError(null);
      setPage(0);
      setPublicKey("");
      setSelectedExecutorId(created.executorId);
      queryClient.setQueryData(
        ["discovery", "executors", session.userId, "SYSTEM_ADMIN", "detail", created.executorId],
        created,
      );
      await refreshExecutors(queryClient, session.userId);
    },
    onError: async (error) => {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        await Promise.all([
          refreshExecutors(queryClient, session.userId),
          queryClient.invalidateQueries({ queryKey: scopeKey }),
        ]);
        const refreshed = queryClient.getQueryData<Awaited<ReturnType<typeof listAllAuthorizedScopes>>>(scopeKey);
        if (refreshed) {
          const active = new Set(refreshed.filter((scope) => scope.status === "ACTIVE")
            .map((scope) => scope.scopeId));
          setSelectedScopes((current) => current.filter((scopeId) => active.has(scopeId)));
        }
      }
    },
  });
  const keyRegistration = useMutation({
    mutationFn: () => registerDiscoveryExecutorPublicKey(
      selectedExecutorId!, publicKey.trim(), session.csrfToken,
    ),
    retry: false,
    onSuccess: async (updated) => {
      setPublicKey("");
      queryClient.setQueryData(
        ["discovery", "executors", session.userId, "SYSTEM_ADMIN", "detail", updated.executorId],
        updated,
      );
      await refreshExecutors(queryClient, session.userId);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409 && selectedExecutorId) {
        await Promise.all([
          refreshExecutors(queryClient, session.userId),
          queryClient.invalidateQueries({ queryKey: detailKey }),
        ]);
      }
    },
  });

  const authenticationError = [
    scopes.error, executors.error, detail.error, creation.error, keyRegistration.error,
  ].some((error) => error instanceof ApiError && error.status === 401);
  useEffect(() => {
    if (authenticationError) {
      queryClient.clear();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  function submitCreation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeIds = new Set(activeScopes.map((scope) => scope.scopeId));
    const validSelection = selectedScopes.filter((scopeId) => activeIds.has(scopeId));
    if (validSelection.length !== selectedScopes.length) {
      setSelectedScopes(validSelection);
      setLocalError("La selección cambió; revisa los ámbitos activos.");
      return;
    }
    if (validSelection.length === 0) {
      setLocalError("Selecciona al menos un ámbito activo.");
      return;
    }
    setLocalError(null);
    creation.mutate();
  }

  function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedExecutorId || !validPublicKey(publicKey)) return;
    keyRegistration.mutate();
  }

  function toggleScope(scopeId: string) {
    setSelectedScopes((current) => current.includes(scopeId)
      ? current.filter((candidate) => candidate !== scopeId)
      : [...current, scopeId]);
    setLocalError(null);
  }

  function selectExecutor(executorId: string) {
    setPublicKey("");
    setSelectedExecutorId(executorId);
  }

  const activeScopes = scopes.data?.filter((scope) => scope.status === "ACTIVE") ?? [];
  const selected = detail.data;

  return (
    <section className="executor-workspace" aria-labelledby="executor-title">
      <header className="workspace-heading">
        <div>
          <p className="sequence">Discovery / identidad local</p>
          <h2 id="executor-title">Discovery Executors</h2>
        </div>
        <p>Pre-registra identidades separadas y asócialas solo con ámbitos activos.</p>
      </header>

      <div className="executor-grid">
        <form className="executor-form" onSubmit={submitCreation}>
          <h3>Nuevo executor</h3>
          <div className="field">
            <label htmlFor="executor-name">Nombre</label>
            <input
              id="executor-name"
              required
              maxLength={200}
              disabled={creation.isPending}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset disabled={creation.isPending || scopes.isPending}>
            <legend>Ámbitos activos</legend>
            {activeScopes.length === 0 && (
              <p className="administration-empty">No hay ámbitos activos disponibles.</p>
            )}
            <div className="executor-scope-options">
              {activeScopes.map((scope) => (
                <label key={scope.scopeId}>
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope.scopeId)}
                    onChange={() => toggleScope(scope.scopeId)}
                  />
                  <span><strong>{scope.name}</strong><small>{scope.cidr}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={creation.isPending || activeScopes.length === 0}>
            {creation.isPending ? "Pre-registrando..." : "Pre-registrar executor"}
          </button>
          {localError && <p className="form-error" role="alert">{localError}</p>}
          {scopes.isError && <p className="form-error" role="alert">No fue posible consultar los ámbitos.</p>}
          {creation.isError && <p className="form-error" role="alert">{executorError(creation.error, "pre-registrar")}</p>}
        </form>

        <div className="executor-list" aria-live="polite">
          <h3>Executors registrados</h3>
          {executors.isPending && <p className="administration-empty">Consultando executors...</p>}
          {executors.isError && <p className="form-error" role="alert">No fue posible consultar los executors.</p>}
          {executors.data?.items.length === 0 && <p className="administration-empty">No hay executors registrados.</p>}
          {executors.data?.items.map((executor) => (
            <button
              type="button"
              className="executor-card"
              aria-pressed={selectedExecutorId === executor.executorId}
              key={executor.executorId}
              onClick={() => selectExecutor(executor.executorId)}
            >
              <span><strong>{executor.name}</strong><small>{executor.executorId}</small></span>
              <span>{executor.publicKeyRegistered ? "Clave registrada" : "Sin clave"}</span>
            </button>
          ))}
          {executors.data && executors.data.totalPages > 1 && (
            <nav className="executor-pagination" aria-label="Paginación de executors">
              <button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Anterior</button>
              <span>Página {page + 1} de {executors.data.totalPages}</span>
              <button type="button" disabled={page + 1 >= executors.data.totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente</button>
            </nav>
          )}
        </div>
      </div>

      {selectedExecutorId && (
        <div className="executor-detail" aria-live="polite">
          {detail.isPending && <p className="administration-empty">Consultando detalle...</p>}
          {detail.isError && <p className="form-error" role="alert">{executorError(detail.error, "consultar")}</p>}
          {selected && <ExecutorDetail executor={selected} />}
          {selected && !selected.publicKeyRegistered && (
            <form className="executor-key-form" onSubmit={submitKey}>
              <h3>Registrar clave pública</h3>
              <p>Inicializa el programa en el host destino y copia únicamente la clave pública.</p>
              <code>jaxon-discovery-executor initialize --executor-id {selected.executorId} --state-dir &lt;directorio-privado&gt;</code>
              <div className="field">
                <label htmlFor="executor-public-key">Clave pública Ed25519</label>
                <textarea
                  id="executor-public-key"
                  required
                  maxLength={4096}
                  rows={4}
                  value={publicKey}
                  disabled={keyRegistration.isPending}
                  onChange={(event) => setPublicKey(event.target.value)}
                />
              </div>
              <button type="submit" disabled={keyRegistration.isPending || !validPublicKey(publicKey)}>
                {keyRegistration.isPending ? "Registrando..." : "Registrar clave pública"}
              </button>
              <p className="security-note">La clave privada no sale del host y nunca debe copiarse aquí.</p>
              {keyRegistration.isError && <p className="form-error" role="alert">{executorError(keyRegistration.error, "registrar la clave de")}</p>}
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function ExecutorDetail({ executor }: Readonly<{ executor: DiscoveryExecutor }>) {
  return (
    <article>
      <p className="sequence">{executor.status} · versión {executor.version}</p>
      <h3>{executor.name}</h3>
      <dl>
        <dt>Executor ID</dt><dd>{executor.executorId}</dd>
        <dt>Ámbitos asociados</dt><dd><ul>{executor.scopeIds.map((id) => <li key={id}>{id}</li>)}</ul></dd>
        <dt>Clave pública</dt><dd>{executor.publicKeyRegistered ? "Registrada" : "Pendiente"}</dd>
        <dt>Huella</dt><dd>{executor.publicKeyFingerprint ?? "Pendiente"}</dd>
        <dt>Creado por</dt><dd>{executor.createdByUserId}</dd>
        <dt>Creado</dt><dd>{executor.createdAt}</dd>
        <dt>Actualizado</dt><dd>{executor.updatedAt}</dd>
      </dl>
    </article>
  );
}

function retryQuery(count: number, error: Error) {
  return count < 1
    && !(error instanceof DiscoveryExecutorContractError)
    && (!(error instanceof ApiError) || error.status >= 500);
}

function validPublicKey(value: string) {
  const trimmed = value.trim();
  return trimmed.length <= 4096 && ED25519_PUBLIC_KEY.test(trimmed);
}

async function refreshExecutors(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: ["discovery", "executors", userId, "SYSTEM_ADMIN"],
  });
}

function executorError(error: Error | null, action: string) {
  if (!(error instanceof ApiError)) return `No fue posible ${action} el Discovery Executor.`;
  if (error.status === 401) return "La sesión ya no es válida.";
  if (error.status === 403) return "La sesión no autoriza esta operación.";
  if (error.status === 404) return "El Discovery Executor ya no existe.";
  if (error.status === 409) return "La identidad o la clave pública entraron en conflicto.";
  if (error.status === 400 || error.status === 422) return "Revisa el nombre, los ámbitos y la clave pública.";
  return `No fue posible ${action} el Discovery Executor.`;
}
