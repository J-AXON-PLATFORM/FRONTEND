"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  createDiscoveryJob,
  AuthorizedScopeContractError,
  DiscoveryJobContractError,
  DiscoveryExecutorContractError,
  getDiscoveryJob,
  listAllAuthorizedScopes,
  listAllDiscoveryExecutors,
  type DiscoveryJob,
} from "./api";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function DiscoveryJobWorkspace({ session }: Readonly<{ session: Session }>) {
  const canOperate = session.roles.includes("IT_OPERATOR");
  const queryClient = useQueryClient();
  const router = useRouter();
  const [executorId, setExecutorId] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [lookupValue, setLookupValue] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [createdJob, setCreatedJob] = useState<DiscoveryJob>();
  const [localError, setLocalError] = useState<string | null>(null);
  const scopeKey = ["discovery", "job-scope-options", session.userId, "IT_OPERATOR"] as const;
  const executorKey = ["discovery", "job-executor-options", session.userId, "IT_OPERATOR"] as const;
  const detailKey = ["discovery", "jobs", session.userId, "IT_OPERATOR", "detail", lookupId] as const;

  const scopes = useQuery({
    queryKey: scopeKey,
    queryFn: listAllAuthorizedScopes,
    enabled: canOperate,
    retry: retryQuery,
  });
  const executors = useQuery({
    queryKey: executorKey,
    queryFn: listAllDiscoveryExecutors,
    enabled: canOperate,
    retry: retryQuery,
  });
  const lookup = useQuery({
    queryKey: detailKey,
    queryFn: () => getDiscoveryJob(lookupId),
    enabled: canOperate && UUID_V4.test(lookupId),
    staleTime: Number.POSITIVE_INFINITY,
    retry: retryQuery,
  });
  const creation = useMutation({
    mutationFn: () => createDiscoveryJob(executorId, scopeId, session.csrfToken),
    retry: false,
    onSuccess: (job) => {
      setCreatedJob(job);
      setLookupValue(job.jobId);
      setLookupId(job.jobId);
      setLocalError(null);
      queryClient.setQueryData(
        ["discovery", "jobs", session.userId, "IT_OPERATOR", "detail", job.jobId],
        job,
      );
    },
    onError: (error) => {
      const jobId = pendingJobId(error);
      if (jobId) {
        setLookupValue(jobId);
        setLookupId(jobId);
      }
    },
  });
  const pendingId = pendingJobId(creation.error);

  const authenticationError = [scopes.error, executors.error, lookup.error, creation.error]
    .some((error) => error instanceof ApiError && error.status === 401);
  useEffect(() => {
    if (authenticationError) {
      queryClient.clear();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);
  if (!canOperate) {
    return (
      <section className="permission-panel" aria-labelledby="discovery-job-title">
        <p className="sequence">Discovery / acceso restringido</p>
        <h2 id="discovery-job-title">Sin permiso de operación</h2>
        <p>Se requiere el rol IT OPERATOR para crear o consultar Discovery Jobs.</p>
      </section>
    );
  }

  const activeExecutors = executors.data?.filter((executor) => executor.status === "ACTIVE") ?? [];
  const selectedExecutor = activeExecutors.find((executor) => executor.executorId === executorId);
  const allowedScopeIds = new Set(selectedExecutor?.scopeIds ?? []);
  const eligibleScopes = scopes.data?.filter((scope) => (
    scope.status === "ACTIVE" && allowedScopeIds.has(scope.scopeId)
  )) ?? [];

  function changeExecutor(value: string) {
    setExecutorId(value);
    setScopeId("");
    setLocalError(null);
    creation.reset();
  }

  function submitCreation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedExecutor || !eligibleScopes.some((scope) => scope.scopeId === scopeId)) {
      setLocalError("La selección cambió; revisa el executor y el ámbito activo asociado.");
      return;
    }
    setLocalError(null);
    creation.mutate();
  }

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupId(lookupValue.trim());
  }

  const visibleJob = lookup.data ?? (createdJob?.jobId === lookupId ? createdJob : undefined);
  return (
    <section className="discovery-job-workspace" aria-labelledby="discovery-job-title">
      <header className="workspace-heading">
        <div>
          <p className="sequence">Discovery / despacho controlado</p>
          <h2 id="discovery-job-title">Discovery Jobs</h2>
        </div>
        <p>Crea un job BASIC para un executor activo y consulta su estado oficial por ID.</p>
      </header>
      <div className="discovery-job-grid">
        <form className="discovery-job-form" onSubmit={submitCreation}>
          <h3>Nuevo job</h3>
          <div className="field">
            <label htmlFor="job-executor">Executor activo</label>
            <select id="job-executor" required value={executorId}
              disabled={creation.isPending || executors.isPending}
              onChange={(event) => changeExecutor(event.target.value)}>
              <option value="">Selecciona un executor</option>
              {activeExecutors.map((executor) => (
                <option key={executor.executorId} value={executor.executorId}>{executor.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="job-scope">Ámbito activo asociado</label>
            <select id="job-scope" required value={scopeId}
              disabled={!executorId || creation.isPending || scopes.isPending}
              onChange={(event) => setScopeId(event.target.value)}>
              <option value="">Selecciona un ámbito</option>
              {eligibleScopes.map((scope) => (
                <option key={scope.scopeId} value={scope.scopeId}>{scope.name} · {scope.cidr}</option>
              ))}
            </select>
          </div>
          <p className="security-note">Perfil fijo: BASIC. Vigencia: una hora.</p>
          <button type="submit" disabled={creation.isPending || Boolean(pendingId) || !executorId || !scopeId}>
            {creation.isPending ? "Despachando..." : "Crear Discovery Job"}
          </button>
          {localError && <p className="form-error" role="alert">{localError}</p>}
          {(scopes.isError || executors.isError) && (
            <p className="form-error" role="alert">No fue posible cargar las opciones activas.</p>
          )}
          {creation.isError && (
            <p className="form-error" role="alert">{jobError(creation.error, "crear")}</p>
          )}
        </form>
        <div className="discovery-job-result">
          <form className="lookup-form" onSubmit={submitLookup}>
            <h3>Consultar por ID</h3>
            <div className="field">
              <label htmlFor="discovery-job-id">UUID del job</label>
              <div className="lookup-control">
                <input id="discovery-job-id" required autoComplete="off" value={lookupValue}
                  onChange={(event) => setLookupValue(event.target.value)} />
                <button type="submit" disabled={lookup.isFetching}>Consultar job</button>
              </div>
            </div>
          </form>
          {lookupId && !UUID_V4.test(lookupId) && (
            <p className="form-error" role="alert">Introduce un UUIDv4 válido.</p>
          )}
          {lookup.isError && <p className="form-error" role="alert">{jobError(lookup.error, "consultar")}</p>}
          {visibleJob && <JobCard job={visibleJob} />}
          {visibleJob && (
            <button type="button" disabled={lookup.isFetching}
              onClick={() => void lookup.refetch()}>
              {lookup.isFetching ? "Actualizando..." : "Actualizar job"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function JobCard({ job }: Readonly<{ job: DiscoveryJob }>) {
  return (
    <article className="discovery-job-card" aria-label="Estado del Discovery Job">
      <p className="sequence">{job.status} · versión {job.version}</p>
      <h3>Job BASIC</h3>
      <dl>
        <div><dt>Job ID</dt><dd>{job.jobId}</dd></div>
        <div><dt>Executor</dt><dd>{job.executorId}</dd></div>
        <div><dt>Ámbito</dt><dd>{job.scopeId}</dd></div>
        <div><dt>Creado</dt><dd>{job.createdAt}</dd></div>
        <div><dt>Expira</dt><dd>{job.expiresAt}</dd></div>
        <div><dt>Despachado</dt><dd>{job.dispatchedAt ?? "Pendiente"}</dd></div>
      </dl>
    </article>
  );
}

function retryQuery(count: number, error: Error) {
  return count < 1
    && !(error instanceof DiscoveryJobContractError)
    && !(error instanceof AuthorizedScopeContractError)
    && !(error instanceof DiscoveryExecutorContractError)
    && (!(error instanceof ApiError) || error.status >= 500);
}

function pendingJobId(error: Error | null) {
  if (!(error instanceof ApiError) || error.status !== 503 || !error.location) return undefined;
  const match = error.location.match(/\/discovery\/jobs\/([0-9a-f-]+)$/);
  return match && UUID_V4.test(match[1]) ? match[1] : undefined;
}

function jobError(error: Error | null, action: "crear" | "consultar") {
  if (error instanceof ApiError && error.status === 403) return "La sesión no autoriza esta operación.";
  if (error instanceof ApiError && error.status === 404) return "No existe un Discovery Job accesible con ese ID.";
  if (error instanceof ApiError && error.status === 409) return "El executor ya tiene un job no terminal o la selección dejó de ser válida.";
  if (error instanceof ApiError && error.status === 503) return "La publicación no está disponible; el job quedó pendiente para reconciliación.";
  if (error instanceof ApiError && (error.status === 400 || error.status === 422)) return "Revisa el executor y el ámbito seleccionados.";
  return `No fue posible ${action} el Discovery Job.`;
}
