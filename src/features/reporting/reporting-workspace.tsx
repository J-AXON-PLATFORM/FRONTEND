"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  AGENT_STATUSES,
  ASSET_STATUSES,
  ASSET_TYPE,
  OPERATIONAL_STATUSES,
  REPORT_DEFAULT_SIZE,
  REPORT_SIZES,
  ReportContractError,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  UUID_V4,
  downloadReportCsv,
  instantToUtcInput,
  listReport,
  utcInputToInstant,
  type AgentReportRow,
  type AssetReportRow,
  type ReportFilters,
  type ReportRow,
  type ReportType,
  type TicketReportRow,
} from "./api";

const URL_KEYS = [
  "report", "reportStatus", "reportAssetType", "reportOperationalStatus", "reportAssetId", "reportTicketType",
  "reportPriority", "reportRequesterUserId", "reportAssigneeUserId", "reportCreatedFrom", "reportCreatedTo",
  "reportPage", "reportSize",
] as const;

type Draft = {
  status: string;
  assetType: string;
  operationalStatus: string;
  assetId: string;
  type: string;
  priority: string;
  requesterUserId: string;
  assigneeUserId: string;
  createdFrom: string;
  createdTo: string;
  size: number;
};

function allowedReports(session: Session): ReportType[] {
  const reports: ReportType[] = [];
  if (session.roles.includes("AUDITOR") || session.roles.includes("IT_OPERATOR")) {
    reports.push("assets", "agents");
  }
  if (session.roles.includes("AUDITOR") || session.roles.includes("SUPPORT_TECHNICIAN")) reports.push("tickets");
  return reports;
}

function defaultFilters(report: ReportType): ReportFilters {
  return { report, page: 0, size: REPORT_DEFAULT_SIZE };
}

function draftFrom(filters: ReportFilters): Draft {
  return {
    status: filters.status ?? "",
    assetType: filters.assetType ?? "",
    operationalStatus: filters.operationalStatus ?? "",
    assetId: filters.assetId ?? "",
    type: filters.type ?? "",
    priority: filters.priority ?? "",
    requesterUserId: filters.requesterUserId ?? "",
    assigneeUserId: filters.assigneeUserId ?? "",
    createdFrom: instantToUtcInput(filters.createdFrom),
    createdTo: instantToUtcInput(filters.createdTo),
    size: filters.size,
  };
}

function readLocation(allowed: ReportType[]): ReportFilters {
  const fallback = defaultFilters(allowed[0]);
  if (typeof window === "undefined") return fallback;
  const parameters = new URLSearchParams(window.location.search);
  const requested = parameters.get("report");
  const report = allowed.includes(requested as ReportType) ? requested as ReportType : allowed[0];
  const filters = defaultFilters(report);
  const page = Number(parameters.get("reportPage"));
  const size = Number(parameters.get("reportSize"));
  filters.page = Number.isSafeInteger(page) && page >= 0 && page <= 1_000_000 ? page : 0;
  filters.size = REPORT_SIZES.includes(size as (typeof REPORT_SIZES)[number]) ? size : REPORT_DEFAULT_SIZE;
  const assign = (key: keyof ReportFilters, parameter: string, valid: (value: string) => boolean) => {
    const value = parameters.get(parameter);
    if (value && valid(value)) Object.assign(filters, { [key]: value });
  };
  if (report === "assets") {
    assign("status", "reportStatus", (value) => ASSET_STATUSES.includes(value as never));
    assign("assetType", "reportAssetType", (value) => ASSET_TYPE.test(value));
  } else if (report === "agents") {
    assign("status", "reportStatus", (value) => AGENT_STATUSES.includes(value as never));
    assign("operationalStatus", "reportOperationalStatus", (value) => OPERATIONAL_STATUSES.includes(value as never));
    assign("assetId", "reportAssetId", (value) => UUID_V4.test(value));
  } else {
    assign("type", "reportTicketType", (value) => TICKET_TYPES.includes(value as never));
    assign("status", "reportStatus", (value) => TICKET_STATUSES.includes(value as never));
    assign("priority", "reportPriority", (value) => TICKET_PRIORITIES.includes(value as never));
    assign("requesterUserId", "reportRequesterUserId", (value) => UUID_V4.test(value));
    assign("assigneeUserId", "reportAssigneeUserId", (value) => UUID_V4.test(value));
    assign("assetId", "reportAssetId", (value) => UUID_V4.test(value));
  }
  assign("createdFrom", "reportCreatedFrom", validInstant);
  assign("createdTo", "reportCreatedTo", validInstant);
  if (filters.createdFrom && filters.createdTo
      && Date.parse(filters.createdFrom) >= Date.parse(filters.createdTo)) {
    delete filters.createdFrom;
    delete filters.createdTo;
  }
  return filters;
}

function validInstant(value: string) {
  return utcInputToInstant(value.slice(0, 19)) === value;
}

function updateLocation(filters: ReportFilters, mode: "push" | "replace") {
  const parameters = new URLSearchParams(window.location.search);
  for (const key of URL_KEYS) parameters.delete(key);
  parameters.set("report", filters.report);
  if (filters.status) parameters.set("reportStatus", filters.status);
  if (filters.assetType) parameters.set("reportAssetType", filters.assetType);
  if (filters.operationalStatus) parameters.set("reportOperationalStatus", filters.operationalStatus);
  if (filters.assetId) parameters.set("reportAssetId", filters.assetId);
  if (filters.type) parameters.set("reportTicketType", filters.type);
  if (filters.priority) parameters.set("reportPriority", filters.priority);
  if (filters.requesterUserId) parameters.set("reportRequesterUserId", filters.requesterUserId);
  if (filters.assigneeUserId) parameters.set("reportAssigneeUserId", filters.assigneeUserId);
  if (filters.createdFrom) parameters.set("reportCreatedFrom", filters.createdFrom);
  if (filters.createdTo) parameters.set("reportCreatedTo", filters.createdTo);
  parameters.set("reportPage", String(filters.page));
  parameters.set("reportSize", String(filters.size));
  const target = `${window.location.pathname}?${parameters.toString()}${window.location.hash}`;
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", target);
}

function reportKey(userId: string, filters: ReportFilters) {
  return ["users", userId, "reporting", filters.report, filters] as const;
}

function retryReport(count: number, error: Error) {
  return !(error instanceof ApiError && error.status < 500)
    && !(error instanceof ReportContractError)
    && count < 1;
}

export function ReportingWorkspace({ session }: Readonly<{ session: Session }>) {
  const reports = allowedReports(session);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ReportFilters>(() => (
    reports.length > 0 ? readLocation(reports) : defaultFilters("assets")
  ));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(filters));
  const [validationError, setValidationError] = useState<string | null>(null);
  const report = useQuery({
    queryKey: reportKey(session.userId, filters),
    queryFn: () => listReport(filters),
    enabled: reports.includes(filters.report),
    retry: retryReport,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const exportCsv = useMutation({
    mutationFn: () => downloadReportCsv(filters),
    retry: false,
  });
  const authenticationError = [report.error, exportCsv.error]
    .find((error) => error instanceof ApiError && error.status === 401);

  useEffect(() => {
    if (reports.length === 0) return;
    updateLocation(filters, "replace");
    const synchronize = () => {
      const next = readLocation(reports);
      setFilters(next);
      setDraft(draftFrom(next));
      setValidationError(null);
      exportCsv.reset();
    };
    window.addEventListener("popstate", synchronize);
    return () => window.removeEventListener("popstate", synchronize);
    // Initial synchronization is intentionally tied to the session's stable role set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  if (reports.length === 0) return null;

  function navigate(next: ReportFilters) {
    updateLocation(next, "push");
    setFilters(next);
    setDraft(draftFrom(next));
    setValidationError(null);
    exportCsv.reset();
  }

  function chooseReport(nextReport: ReportType) {
    if (nextReport === filters.report || !reports.includes(nextReport)) return;
    navigate(defaultFilters(nextReport));
  }

  function update(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: field === "size" ? Number(value) : value }));
    setValidationError(null);
    exportCsv.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (report.isFetching || exportCsv.isPending) return;
    const next = filtersFromDraft(filters.report, draft);
    if (typeof next === "string") {
      setValidationError(next);
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(filters)) {
      void report.refetch();
      return;
    }
    navigate(next);
  }

  const busy = report.isFetching;
  return (
    <section className="reporting-workspace" aria-labelledby="reporting-title">
      <header className="workspace-heading reporting-heading">
        <div>
          <p className="sequence">Audit / Reporting v1</p>
          <h2 id="reporting-title">Reportes</h2>
        </div>
        <p>Consulta operativa de Assets, Agents y Tickets. REST conserva la fuente oficial.</p>
      </header>

      <nav className="report-tabs" aria-label="Tipos de reporte">
        {reports.map((item) => (
          <button key={item} type="button" aria-current={filters.report === item ? "page" : undefined}
            onClick={() => chooseReport(item)}>
            {reportLabel(item)}
          </button>
        ))}
      </nav>

      <form className="report-filters" aria-label={`Filtros del reporte de ${reportLabel(filters.report)}`}
        onSubmit={submit}>
        <ReportFields report={filters.report} draft={draft} busy={busy || exportCsv.isPending} update={update} />
        <Field id="report-created-from" label="Creado desde (UTC)">
          <input id="report-created-from" type="datetime-local" step={1} value={draft.createdFrom}
            disabled={busy || exportCsv.isPending}
            onChange={(event) => update("createdFrom", event.target.value)} />
        </Field>
        <Field id="report-created-to" label="Creado hasta (UTC, exclusivo)">
          <input id="report-created-to" type="datetime-local" step={1} value={draft.createdTo}
            disabled={busy || exportCsv.isPending}
            onChange={(event) => update("createdTo", event.target.value)} />
        </Field>
        <Field id="report-size" label="Filas por página">
          <select id="report-size" value={draft.size} disabled={busy || exportCsv.isPending}
            onChange={(event) => update("size", event.target.value)}>
            {REPORT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </Field>
        {validationError && <p className="form-error" role="alert">{validationError}</p>}
        <div className="report-actions">
          <button type="submit" disabled={busy || exportCsv.isPending}>
            {busy ? "Consultando..." : "Aplicar filtros"}
          </button>
          <button type="button" disabled={busy || exportCsv.isPending}
            onClick={() => exportCsv.mutate()}>
            {exportCsv.isPending ? "Preparando CSV..." : "Descargar CSV"}
          </button>
        </div>
        {exportCsv.isError && (
          <p className="form-error" role="alert">{reportError(exportCsv.error, "export")}</p>
        )}
      </form>

      <div className="report-results" aria-live="polite" aria-busy={busy}>
        {busy && <p className="administration-empty">Consultando reporte...</p>}
        {!busy && report.isError && <p className="form-error" role="alert">{reportError(report.error, "list")}</p>}
        {!busy && report.isSuccess && report.data.items.length === 0 && (
          <p className="administration-empty">No hay filas para estos filtros.</p>
        )}
        {!busy && report.isSuccess && report.data.items.length > 0 && (
          <div className="report-table-scroll">
            <table>
              <caption className="visually-hidden">Reporte de {reportLabel(filters.report)}</caption>
              <ReportTable report={filters.report} rows={report.data.items} />
            </table>
          </div>
        )}
        {report.isSuccess && (
          <nav className="report-pagination" aria-label={`Paginación del reporte de ${reportLabel(filters.report)}`}>
            <button type="button" disabled={busy || filters.page === 0}
              onClick={() => navigate({ ...filters, page: filters.page - 1 })}>Anterior</button>
            <span>
              Página {report.data.totalPages === 0 ? 0 : filters.page + 1} de {report.data.totalPages}
              {" · "}{report.data.totalElements} fila(s)
            </span>
            <button type="button" disabled={busy || filters.page + 1 >= report.data.totalPages}
              onClick={() => navigate({ ...filters, page: filters.page + 1 })}>Siguiente</button>
          </nav>
        )}
      </div>
    </section>
  );
}

function ReportFields({ report, draft, busy, update }: Readonly<{
  report: ReportType;
  draft: Draft;
  busy: boolean;
  update: (field: keyof Draft, value: string) => void;
}>) {
  if (report === "assets") {
    return (
      <>
        <SelectField id="report-status" label="Estado" value={draft.status} values={ASSET_STATUSES}
          busy={busy} update={(value) => update("status", value)} />
        <Field id="report-asset-type" label="Tipo de activo">
          <input id="report-asset-type" maxLength={64} value={draft.assetType} disabled={busy}
            onChange={(event) => update("assetType", event.target.value)} placeholder="DESKTOP" />
        </Field>
      </>
    );
  }
  if (report === "agents") {
    return (
      <>
        <SelectField id="report-status" label="Estado administrativo" value={draft.status} values={AGENT_STATUSES}
          busy={busy} update={(value) => update("status", value)} />
        <SelectField id="report-operational-status" label="Estado operativo" value={draft.operationalStatus}
          values={OPERATIONAL_STATUSES} busy={busy}
          update={(value) => update("operationalStatus", value)} />
        <UuidField id="report-asset-id" label="Asset ID" value={draft.assetId} busy={busy}
          update={(value) => update("assetId", value)} />
      </>
    );
  }
  return (
    <>
      <SelectField id="report-ticket-type" label="Tipo" value={draft.type} values={TICKET_TYPES}
        busy={busy} update={(value) => update("type", value)} />
      <SelectField id="report-status" label="Estado" value={draft.status} values={TICKET_STATUSES}
        busy={busy} update={(value) => update("status", value)} />
      <SelectField id="report-priority" label="Prioridad" value={draft.priority} values={TICKET_PRIORITIES}
        busy={busy} update={(value) => update("priority", value)} />
      <UuidField id="report-requester" label="Requester user ID" value={draft.requesterUserId} busy={busy}
        update={(value) => update("requesterUserId", value)} />
      <UuidField id="report-assignee" label="Assignee user ID" value={draft.assigneeUserId} busy={busy}
        update={(value) => update("assigneeUserId", value)} />
      <UuidField id="report-asset-id" label="Asset ID" value={draft.assetId} busy={busy}
        update={(value) => update("assetId", value)} />
    </>
  );
}

function Field({ id, label, children }: Readonly<{ id: string; label: string; children: ReactNode }>) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}</div>;
}

function SelectField({ id, label, value, values, busy, update }: Readonly<{
  id: string;
  label: string;
  value: string;
  values: readonly string[];
  busy: boolean;
  update: (value: string) => void;
}>) {
  return (
    <Field id={id} label={label}>
      <select id={id} value={value} disabled={busy} onChange={(event) => update(event.target.value)}>
        <option value="">Todos</option>
        {values.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </Field>
  );
}

function UuidField({ id, label, value, busy, update }: Readonly<{
  id: string;
  label: string;
  value: string;
  busy: boolean;
  update: (value: string) => void;
}>) {
  return (
    <Field id={id} label={label}>
      <input id={id} maxLength={36} value={value} disabled={busy}
        onChange={(event) => update(event.target.value)} />
    </Field>
  );
}

function ReportTable({ report, rows }: Readonly<{ report: ReportType; rows: ReportRow[] }>) {
  if (report === "assets") {
    return (
      <>
        <thead><tr><th>Asset ID</th><th>Nombre</th><th>Tipo</th><th>Estado</th><th>Creado</th><th>Actualizado</th></tr></thead>
        <tbody>{(rows as AssetReportRow[]).map((row) => (
          <tr key={row.assetId}><td>{row.assetId}</td><td>{row.name}</td><td>{row.assetType}</td>
            <td>{row.status}</td><td>{formatUtc(row.createdAt)}</td><td>{formatUtc(row.updatedAt)}</td></tr>
        ))}</tbody>
      </>
    );
  }
  if (report === "agents") {
    return (
      <>
        <thead><tr><th>Agent ID</th><th>Asset ID</th><th>Administrativo</th><th>Operativo</th>
          <th>Último contacto</th><th>Último snapshot</th><th>Creado</th><th>Actualizado</th></tr></thead>
        <tbody>{(rows as AgentReportRow[]).map((row) => (
          <tr key={row.agentId}><td>{row.agentId}</td><td>{row.assetId}</td><td>{row.status}</td>
            <td>{row.operationalStatus}</td><td>{formatNullableUtc(row.lastSeenAt)}</td>
            <td>{formatNullableUtc(row.lastSnapshotAt)}</td><td>{formatUtc(row.createdAt)}</td>
            <td>{formatUtc(row.updatedAt)}</td></tr>
        ))}</tbody>
      </>
    );
  }
  return (
    <>
      <thead><tr><th>Ticket ID</th><th>Tipo</th><th>Resumen</th><th>Estado</th><th>Prioridad</th>
        <th>Origen</th><th>Requester</th><th>Creado por</th><th>Assignee</th><th>Asset ID</th>
        <th>Creado</th><th>Actualizado</th></tr></thead>
      <tbody>{(rows as TicketReportRow[]).map((row) => (
        <tr key={row.ticketId}><td>{row.ticketId}</td><td>{row.type}</td><td>{row.summary}</td>
          <td>{row.status}</td><td>{row.priority}</td><td>{row.source}</td><td>{row.requesterUserId}</td>
          <td>{row.createdByUserId}</td><td>{row.assigneeUserId ?? "Sin asignar"}</td>
          <td>{row.assetId ?? "Sin activo"}</td><td>{formatUtc(row.createdAt)}</td>
          <td>{formatUtc(row.updatedAt)}</td></tr>
      ))}</tbody>
    </>
  );
}

function filtersFromDraft(report: ReportType, draft: Draft): ReportFilters | string {
  const createdFrom = draft.createdFrom ? utcInputToInstant(draft.createdFrom) : undefined;
  const createdTo = draft.createdTo ? utcInputToInstant(draft.createdTo) : undefined;
  if (createdFrom === null || createdTo === null) return "Las fechas deben ser válidas.";
  if (createdFrom && createdTo && Date.parse(createdFrom) >= Date.parse(createdTo)) {
    return "La fecha final debe ser posterior a la inicial.";
  }
  const next: ReportFilters = { report, page: 0, size: draft.size };
  if (createdFrom) next.createdFrom = createdFrom;
  if (createdTo) next.createdTo = createdTo;
  if (report === "assets") {
    const assetType = draft.assetType.trim();
    if (assetType && !ASSET_TYPE.test(assetType)) {
      return "Tipo de activo debe usar mayúsculas, dígitos o guion bajo (1 a 64 caracteres).";
    }
    if (draft.status) next.status = draft.status;
    if (assetType) next.assetType = assetType;
    return next;
  }
  if (report === "agents") {
    if (draft.assetId.trim() && !UUID_V4.test(draft.assetId.trim())) return "Asset ID debe ser un UUIDv4.";
    if (draft.status) next.status = draft.status;
    if (draft.operationalStatus) next.operationalStatus = draft.operationalStatus;
    if (draft.assetId.trim()) next.assetId = draft.assetId.trim().toLowerCase();
    return next;
  }
  for (const [value, label] of [
    [draft.requesterUserId, "Requester user ID"],
    [draft.assigneeUserId, "Assignee user ID"],
    [draft.assetId, "Asset ID"],
  ] as const) {
    if (value.trim() && !UUID_V4.test(value.trim())) return `${label} debe ser un UUIDv4.`;
  }
  if (draft.type) next.type = draft.type;
  if (draft.status) next.status = draft.status;
  if (draft.priority) next.priority = draft.priority;
  if (draft.requesterUserId.trim()) next.requesterUserId = draft.requesterUserId.trim().toLowerCase();
  if (draft.assigneeUserId.trim()) next.assigneeUserId = draft.assigneeUserId.trim().toLowerCase();
  if (draft.assetId.trim()) next.assetId = draft.assetId.trim().toLowerCase();
  return next;
}

function reportError(error: Error | null, operation: "list" | "export") {
  if (error instanceof ReportContractError) return error.message;
  if (!(error instanceof ApiError)) {
    return operation === "export" ? "No fue posible descargar el CSV." : "No fue posible consultar el reporte.";
  }
  const reference = error.problem?.correlationId ? ` Referencia: ${error.problem.correlationId}.` : "";
  if (error.status === 401) return `La sesión ya no es válida.${reference}`;
  if (error.status === 403) return `La sesión no autoriza este reporte.${reference}`;
  if (error.status === 422 && error.problem?.code === "REPORT_EXPORT_LIMIT_EXCEEDED") {
    return `La exportación supera 10.000 filas o 10 MiB. Restringe los filtros.${reference}`;
  }
  if (error.status === 422) return `Revisa los filtros y la paginación.${reference}`;
  if (error.status === 503 && error.problem?.code === "REPORT_UNAVAILABLE") {
    return `Reporting no está disponible temporalmente.${reference}`;
  }
  return `${operation === "export" ? "No fue posible descargar el CSV." : "No fue posible consultar el reporte."}${reference}`;
}

function reportLabel(report: ReportType) {
  if (report === "assets") return "Assets";
  if (report === "agents") return "Agents";
  return "Tickets";
}

function formatUtc(value: string) {
  return `${new Date(value).toLocaleString("es-ES", { timeZone: "UTC" })} UTC`;
}

function formatNullableUtc(value: string | null) {
  return value === null ? "Sin evidencia" : formatUtc(value);
}
