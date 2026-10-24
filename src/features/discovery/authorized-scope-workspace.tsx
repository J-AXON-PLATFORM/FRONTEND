"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  AuthorizedScopeContractError,
  createAuthorizedScope,
  listAuthorizedScopes,
  updateAuthorizedScopeStatus,
  type AuthorizedScope,
  type AuthorizedScopeStatus,
} from "./api";

export function AuthorizedScopeWorkspace({ session }: Readonly<{ session: Session }>) {
  const administrator = session.roles.includes("SYSTEM_ADMIN");
  const cacheRole = administrator ? "SYSTEM_ADMIN" : "IT_OPERATOR";
  const queryClient = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [name, setName] = useState("");
  const [cidr, setCidr] = useState("");
  const queryKey = ["discovery", "authorized-scopes", session.userId, cacheRole, page] as const;
  const scopes = useQuery({
    queryKey,
    queryFn: () => listAuthorizedScopes(page),
    retry: (count, error) => count < 1
      && !(error instanceof AuthorizedScopeContractError)
      && (!(error instanceof ApiError) || error.status >= 500),
  });
  const creation = useMutation({
    mutationFn: () => createAuthorizedScope(name, cidr, session.csrfToken),
    retry: false,
    onSuccess: async () => {
      setName("");
      setCidr("");
      setPage(0);
      await refreshScopes(queryClient, session.userId, cacheRole);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        await refreshScopes(queryClient, session.userId, cacheRole);
      }
    },
  });
  const statusChange = useMutation({
    mutationFn: ({ scope, status }: { scope: AuthorizedScope; status: AuthorizedScopeStatus }) => (
      updateAuthorizedScopeStatus(scope.scopeId, status, scope.version, session.csrfToken)
    ),
    retry: false,
    onSuccess: async () => refreshScopes(queryClient, session.userId, cacheRole),
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        await refreshScopes(queryClient, session.userId, cacheRole);
      }
    },
  });

  const authenticationError = [scopes.error, creation.error, statusChange.error]
    .some((error) => error instanceof ApiError && error.status === 401);
  useEffect(() => {
    if (authenticationError) {
      queryClient.clear();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    creation.mutate();
  }

  return (
    <section className="discovery-workspace" aria-labelledby="discovery-title">
      <header className="workspace-heading">
        <div>
          <p className="sequence">Discovery / alcance permitido</p>
          <h2 id="discovery-title">Ámbitos autorizados</h2>
        </div>
        <p>{administrator
          ? "Administra redes explícitas sin ejecutar exploraciones ni incorporar activos."
          : "Consulta únicamente los ámbitos activos disponibles para operaciones posteriores."}</p>
      </header>
      {administrator && (
        <form className="scope-form" onSubmit={submit} aria-describedby={creation.isError ? "scope-create-error" : undefined}>
          <div className="field">
            <label htmlFor="scope-name">Nombre del ámbito</label>
            <input id="scope-name" required maxLength={200} disabled={creation.isPending} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="scope-cidr">Red CIDR canónica</label>
            <input id="scope-cidr" required maxLength={64} placeholder="192.0.2.0/24" disabled={creation.isPending} value={cidr} onChange={(event) => setCidr(event.target.value)} />
          </div>
          <button type="submit" disabled={creation.isPending}>{creation.isPending ? "Creando ámbito..." : "Crear ámbito"}</button>
          {creation.isError && <p className="form-error" id="scope-create-error" role="alert">{mutationError(creation.error, "crear")}</p>}
        </form>
      )}
      <div className="scope-list" aria-live="polite">
        {scopes.isPending && <p className="administration-empty">Consultando ámbitos...</p>}
        {scopes.isError && <p className="form-error" role="alert">No fue posible consultar los ámbitos.</p>}
        {scopes.data?.items.length === 0 && <p className="administration-empty">No hay ámbitos visibles.</p>}
        {scopes.data?.items.map((scope) => (
          <article className="scope-card" key={scope.scopeId}>
            <div>
              <p className="sequence">{scope.cidr}</p>
              <h3>{scope.name}</h3>
              <p>Versión {scope.version} · {scope.status}</p>
            </div>
            {administrator && (
              <button
                type="button"
                aria-label={`${scope.status === "ACTIVE" ? "Deshabilitar" : "Activar"} ${scope.name}`}
                disabled={statusChange.isPending}
                onClick={() => statusChange.mutate({
                  scope,
                  status: scope.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                })}
              >
                {scope.status === "ACTIVE" ? "Deshabilitar" : "Activar"}
              </button>
            )}
          </article>
        ))}
        {statusChange.isError && <p className="form-error" role="alert">{mutationError(statusChange.error, "actualizar")}</p>}
      </div>
      {scopes.data && scopes.data.totalPages > 1 && (
        <nav className="scope-pagination" aria-label="Paginación de ámbitos">
          <button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Anterior</button>
          <span>Página {page + 1} de {scopes.data.totalPages}</span>
          <button type="button" disabled={page + 1 >= scopes.data.totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente</button>
        </nav>
      )}
    </section>
  );
}

async function refreshScopes(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  role: string,
) {
  await queryClient.invalidateQueries({ queryKey: ["discovery", "authorized-scopes", userId, role] });
  if (role === "SYSTEM_ADMIN") {
    await queryClient.invalidateQueries({
      queryKey: ["discovery", "executor-scope-options", userId, "SYSTEM_ADMIN"],
    });
  }
}

function mutationError(error: Error | null, action: string) {
  if (!(error instanceof ApiError)) return `No fue posible ${action} el ámbito.`;
  if (error.status === 401) return "La sesión ya no es válida.";
  if (error.status === 403) return "La sesión no autoriza esta operación.";
  if (error.status === 409) return "Los datos entraron en conflicto; se actualizó el listado.";
  if (error.status === 400 || error.status === 422) return "Revisa el nombre y la red CIDR canónica.";
  return `No fue posible ${action} el ámbito.`;
}
