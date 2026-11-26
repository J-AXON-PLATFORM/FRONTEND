"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  AUDIT_CODE,
  AUDIT_DEFAULT_SIZE,
  AUDIT_MODULES,
  AUDIT_RESULTS,
  AuditContractError,
  UUID_V4,
  listAuditEvents,
  utcInputToInstant,
  type AuditEvent,
  type AuditFilters,
  type AuditModule,
  type AuditResult,
} from "./api";

const SIZES = [50, 100, 200];

type Draft = {
  from: string;
  to: string;
  module: string;
  eventType: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
  result: string;
  correlationId: string;
  size: number;
};

const EMPTY_DRAFT: Draft = {
  from: "", to: "", module: "", eventType: "", actorId: "", resourceType: "", resourceId: "", result: "",
  correlationId: "", size: AUDIT_DEFAULT_SIZE,
};

function auditKey(userId: string, filters: AuditFilters) {
  return ["users", userId, "audit", "events", filters] as const;
}

export function AuditWorkspace({ session }: Readonly<{ session: Session }>) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const allowed = session.roles.includes("AUDITOR");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [filters, setFilters] = useState<AuditFilters>({ page: 0, size: AUDIT_DEFAULT_SIZE });
  const [validationError, setValidationError] = useState<string | null>(null);

  const events = useQuery({
    queryKey: auditKey(session.userId, filters),
    queryFn: () => listAuditEvents(filters),
    enabled: allowed,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const authenticationError = events.error instanceof ApiError && events.error.status === 401;
  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  if (!allowed) return null;

  function update(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: field === "size" ? Number(value) : value }));
    setValidationError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (events.isFetching) return;
    const next = toFilters(draft);
    if (typeof next === "string") {
      setValidationError(next);
      return;
    }
    setValidationError(null);
    if (JSON.stringify(next) === JSON.stringify(filters)) {
      void events.refetch();
      return;
    }
    setFilters(next);
  }

  const busy = events.isFetching;

  return (
    <section className="audit-workspace" aria-labelledby="audit-title">
      <header className="workspace-heading audit-heading">
        <div>
          <p className="sequence">Auditoría / eventos</p>
          <h2 id="audit-title">Auditoría</h2>
        </div>
        <p>Eventos auditables append-only. Lectura exclusiva de auditoría; los identificadores se muestran opacos.</p>
      </header>

      <form className="audit-filters" onSubmit={submit} aria-label="Filtros de auditoría">
        <Field id="audit-from" label="Desde (UTC)">
          <input id="audit-from" type="datetime-local" step={1} value={draft.from} disabled={busy}
            onChange={(event) => update("from", event.target.value)} />
        </Field>
        <Field id="audit-to" label="Hasta (UTC, exclusivo)">
          <input id="audit-to" type="datetime-local" step={1} value={draft.to} disabled={busy}
            onChange={(event) => update("to", event.target.value)} />
        </Field>
        <Field id="audit-module" label="Módulo">
          <select id="audit-module" value={draft.module} disabled={busy}
            onChange={(event) => update("module", event.target.value)}>
            <option value="">Todos</option>
            {AUDIT_MODULES.map((module) => <option key={module} value={module}>{module}</option>)}
          </select>
        </Field>
        <Field id="audit-event-type" label="Tipo de evento">
          <input id="audit-event-type" maxLength={64} value={draft.eventType} disabled={busy}
            onChange={(event) => update("eventType", event.target.value)} />
        </Field>
        <Field id="audit-result" label="Resultado">
          <select id="audit-result" value={draft.result} disabled={busy}
            onChange={(event) => update("result", event.target.value)}>
            <option value="">Todos</option>
            {AUDIT_RESULTS.map((result) => <option key={result} value={result}>{result}</option>)}
          </select>
        </Field>
        <Field id="audit-actor" label="Actor ID">
          <input id="audit-actor" maxLength={36} value={draft.actorId} disabled={busy}
            onChange={(event) => update("actorId", event.target.value)} />
        </Field>
        <Field id="audit-resource-type" label="Tipo de recurso">
          <input id="audit-resource-type" maxLength={64} value={draft.resourceType} disabled={busy}
            onChange={(event) => update("resourceType", event.target.value)} />
        </Field>
        <Field id="audit-resource" label="Recurso ID">
          <input id="audit-resource" maxLength={36} value={draft.resourceId} disabled={busy}
            onChange={(event) => update("resourceId", event.target.value)} />
        </Field>
        <Field id="audit-correlation" label="Correlation ID">
          <input id="audit-correlation" maxLength={36} value={draft.correlationId} disabled={busy}
            onChange={(event) => update("correlationId", event.target.value)} />
        </Field>
        <Field id="audit-size" label="Eventos por página">
          <select id="audit-size" value={draft.size} disabled={busy}
            onChange={(event) => update("size", event.target.value)}>
            {SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </Field>
        {validationError && <p className="form-error" role="alert">{validationError}</p>}
        <button type="submit" disabled={busy}>{busy ? "Consultando auditoría..." : "Consultar auditoría"}</button>
      </form>

      <div className="audit-results" aria-live="polite">
        {busy && <p className="administration-empty">Consultando auditoría...</p>}
        {!busy && events.isError && <p className="form-error" role="alert">{auditError(events.error)}</p>}
        {!busy && events.isSuccess && events.data.items.length === 0 && (
          <p className="administration-empty">No hay eventos de auditoría para estos filtros.</p>
        )}
        {!busy && events.isSuccess && events.data.items.length > 0 && (
          <ol aria-label="Eventos de auditoría">
            {events.data.items.map((item) => <AuditEventCard key={item.auditEventId} event={item} />)}
          </ol>
        )}
        {events.isSuccess && (
          <nav className="audit-pagination" aria-label="Paginación de auditoría">
            <button type="button" disabled={busy || filters.page === 0}
              onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Anterior</button>
            <span>
              Página {events.data.totalPages === 0 ? 0 : filters.page + 1} de {events.data.totalPages}
              {" · "}{events.data.totalElements} evento(s)
            </span>
            <button type="button" disabled={busy || filters.page + 1 >= events.data.totalPages}
              onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Siguiente</button>
          </nav>
        )}
      </div>
    </section>
  );
}

function Field({ id, label, children }: Readonly<{ id: string; label: string; children: React.ReactNode }>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function AuditEventCard({ event }: Readonly<{ event: AuditEvent }>) {
  return (
    <li>
      <article aria-label={`Evento ${event.eventType} ${event.auditEventId}`}>
        <header>
          <span className="sequence">{event.producerModule} · {event.result} · {formatUtc(event.occurredAt)}</span>
          <h3>{event.eventType}</h3>
        </header>
        <dl>
          <div><dt>Audit event ID</dt><dd>{event.auditEventId}</dd></div>
          <div><dt>Evento origen</dt><dd>{event.sourceEventId} · v{event.eventVersion}</dd></div>
          <div><dt>Actor</dt><dd>{event.actorType} · {event.actorId ?? "sin identificador"}</dd></div>
          <div>
            <dt>Recurso</dt>
            <dd>
              {event.resourceType} · {event.resourceId}
              {event.resourceVersion === null ? "" : ` · versión ${event.resourceVersion}`}
            </dd>
          </div>
          <div><dt>Correlation ID</dt><dd>{event.correlationId}</dd></div>
          <div><dt>Registrado</dt><dd>{formatUtc(event.recordedAt)}</dd></div>
          {Object.entries(event.metadata).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </article>
    </li>
  );
}

function toFilters(draft: Draft): AuditFilters | string {
  const from = draft.from ? utcInputToInstant(draft.from) : undefined;
  const to = draft.to ? utcInputToInstant(draft.to) : undefined;
  if (from === null || to === null) return "Las fechas deben ser válidas.";
  if (from && to && Date.parse(from) >= Date.parse(to)) return "La fecha final debe ser posterior a la inicial.";
  for (const [value, label] of [[draft.actorId, "Actor ID"], [draft.resourceId, "Recurso ID"],
    [draft.correlationId, "Correlation ID"]] as const) {
    if (value.trim() && !UUID_V4.test(value.trim())) return `${label} debe ser un UUIDv4.`;
  }
  for (const [value, label] of [[draft.eventType, "Tipo de evento"], [draft.resourceType, "Tipo de recurso"]] as const) {
    if (value.trim() && !AUDIT_CODE.test(value.trim())) {
      return `${label} debe usar mayúsculas, dígitos o guion bajo (3 a 64 caracteres).`;
    }
  }
  const result: AuditFilters = { page: 0, size: draft.size };
  if (from) result.from = from;
  if (to) result.to = to;
  if (draft.module) result.module = draft.module as AuditModule;
  if (draft.eventType.trim()) result.eventType = draft.eventType.trim();
  if (draft.actorId.trim()) result.actorId = draft.actorId.trim().toLowerCase();
  if (draft.resourceType.trim()) result.resourceType = draft.resourceType.trim();
  if (draft.resourceId.trim()) result.resourceId = draft.resourceId.trim().toLowerCase();
  if (draft.result) result.result = draft.result as AuditResult;
  if (draft.correlationId.trim()) result.correlationId = draft.correlationId.trim().toLowerCase();
  return result;
}

function auditError(error: Error | null) {
  if (error instanceof AuditContractError) return "El servicio devolvió eventos de auditoría con un formato no válido.";
  if (!(error instanceof ApiError)) return "No fue posible consultar la auditoría.";
  if (error.status === 401) return "La sesión ya no es válida.";
  if (error.status === 403) return "La sesión no autoriza la consulta de auditoría.";
  if (error.status === 422) return "Revisa los filtros y la paginación.";
  if (error.status === 503) return "El servicio de auditoría no está disponible.";
  return "No fue posible consultar la auditoría.";
}

function formatUtc(value: string) {
  return `${new Date(value).toLocaleString("es-ES", { timeZone: "UTC" })} UTC`;
}
