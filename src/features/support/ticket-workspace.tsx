"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createTicket, getTicket, TicketContractError, type Ticket, type TicketType } from "./api";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_TYPES: { value: TicketType; label: string }[] = [
  { value: "INCIDENT", label: "Incidente" },
  { value: "SERVICE_REQUEST", label: "Solicitud de servicio" },
  { value: "QUESTION", label: "Consulta" },
  { value: "OTHER", label: "Otro" },
];

function ticketKey(userId: string, ticketId: string) {
  return ["users", userId, "support", "ticket", ticketId] as const;
}

export function TicketWorkspace({ session }: Readonly<{ session: Session }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [type, setType] = useState<TicketType>("INCIDENT");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [assetId, setAssetId] = useState("");
  const [createdTicket, setCreatedTicket] = useState<Ticket>();
  const [lookupValue, setLookupValue] = useState("");
  const [lookupId, setLookupId] = useState("");
  const canOperate = session.roles.includes("IT_OPERATOR");

  const creation = useMutation({
    mutationFn: () => createTicket({
      type,
      summary: summary.trim(),
      description: description.trim(),
      ...(assetId.trim() ? { assetId: assetId.trim() } : {}),
    }, session.csrfToken, session.userId),
    onSuccess: (ticket) => {
      setCreatedTicket(ticket);
      setLookupValue(ticket.ticketId);
      setLookupId(ticket.ticketId);
      setSummary("");
      setDescription("");
      setAssetId("");
    },
  });
  const lookup = useQuery({
    queryKey: ticketKey(session.userId, lookupId),
    queryFn: () => getTicket(lookupId, session.userId),
    enabled: UUID_V4.test(lookupId),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500)
      && !(error instanceof TicketContractError)
      && count < 1,
  });
  const authenticationError = [creation.error, lookup.error]
    .find((error) => error instanceof ApiError && error.status === 401);

  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  if (!canOperate) {
    return null;
  }

  function submitCreation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assetId.trim() && !UUID_V4.test(assetId.trim())) return;
    creation.mutate();
  }

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = lookupValue.trim();
    setCreatedTicket(undefined);
    setLookupId(candidate);
    if (UUID_V4.test(candidate)) {
      void queryClient.invalidateQueries({ queryKey: ticketKey(session.userId, candidate), exact: true });
    }
  }

  const invalidAssetId = Boolean(assetId.trim()) && !UUID_V4.test(assetId.trim());
  return (
    <section className="ticket-workspace" aria-labelledby="ticket-title">
      <header className="workspace-heading">
        <div>
          <p className="sequence">Support / solicitud propia</p>
          <h2 id="ticket-title">Tickets</h2>
        </div>
        <p>Alta mínima y consulta directa de tickets propios. Sin listado ni gestión del ciclo de vida.</p>
      </header>

      <div className="ticket-grid">
        <form className="ticket-form" onSubmit={submitCreation}>
          <div className="form-heading"><span>01</span><h3>Crear ticket</h3></div>
          <div className="field">
            <label htmlFor="ticket-type">Clasificación</label>
            <select id="ticket-type" value={type} disabled={creation.isPending} onChange={(event) => setType(event.target.value as TicketType)}>
              {TICKET_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ticket-summary">Resumen</label>
            <input id="ticket-summary" required maxLength={256} value={summary} disabled={creation.isPending} onChange={(event) => setSummary(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ticket-description">Descripción</label>
            <textarea id="ticket-description" required maxLength={10000} rows={6} value={description} disabled={creation.isPending} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ticket-asset-id">Activo asociado por UUID (opcional)</label>
            <input id="ticket-asset-id" autoComplete="off" placeholder="00000000-0000-4000-8000-000000000000" value={assetId} disabled={creation.isPending} onChange={(event) => setAssetId(event.target.value)} />
          </div>
          <div className="ticket-defaults" aria-label="Valores iniciales">
            <span>Prioridad <strong>NORMAL</strong></span>
            <span>Estado <strong>OPEN</strong></span>
          </div>
          {invalidAssetId && <p className="form-error" role="alert">Introduce un UUIDv4 de activo válido o deja el campo vacío.</p>}
          {creation.isError && <p className="form-error" role="alert">{errorMessage(creation.error, "crear")}</p>}
          <button type="submit" disabled={creation.isPending || invalidAssetId}>{creation.isPending ? "Creando..." : "Crear ticket"}</button>
        </form>

        <div className="ticket-results">
          <form className="lookup-form" onSubmit={submitLookup}>
            <div className="form-heading"><span>02</span><h3>Consultar por ID</h3></div>
            <div className="field">
              <label htmlFor="ticket-id">UUID del ticket</label>
              <div className="lookup-control">
                <input id="ticket-id" autoComplete="off" placeholder="00000000-0000-4000-8000-000000000000" required value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} />
                <button type="submit" disabled={lookup.isFetching}>Buscar ticket</button>
              </div>
            </div>
          </form>
          {lookupId && !UUID_V4.test(lookupId) && <p className="form-error" role="alert">Introduce un UUIDv4 válido.</p>}
          {lookup.isError && <p className="form-error" role="alert">{errorMessage(lookup.error, "consultar")}</p>}
          {lookup.isFetching && <p className="result-status" aria-live="polite">Consultando ticket...</p>}
          {createdTicket && <TicketCard ticket={createdTicket} label="Resultado de creación del ticket" />}
          {lookup.data && <TicketCard ticket={lookup.data} label="Consulta del ticket por ID" />}
        </div>
      </div>
    </section>
  );
}

function TicketCard({ ticket, label }: Readonly<{ ticket: Ticket; label: string }>) {
  return (
    <article className="ticket-card" aria-label={label}>
      <p className="sequence">{label}</p>
      <div className="ticket-card-title">
        <h3>{ticket.summary}</h3>
        <span>{ticket.status}</span>
      </div>
      <p className="ticket-description">{ticket.description}</p>
      <dl>
        <div><dt>ID</dt><dd>{ticket.ticketId}</dd></div>
        <div><dt>Tipo</dt><dd>{ticket.type.replaceAll("_", " ")}</dd></div>
        <div><dt>Prioridad</dt><dd>{ticket.priority}</dd></div>
        <div><dt>Origen</dt><dd>{ticket.source}</dd></div>
        <div><dt>Activo</dt><dd>{ticket.assetId ?? "Sin activo asociado"}</dd></div>
        <div><dt>Creado</dt><dd>{new Date(ticket.createdAt).toLocaleString("es-ES", { timeZone: "UTC" })} UTC</dd></div>
      </dl>
    </article>
  );
}

function errorMessage(error: Error | null, action: "crear" | "consultar") {
  if (error instanceof TicketContractError) {
    return "El servicio devolvió un ticket con un formato no válido.";
  }
  if (!(error instanceof ApiError)) {
    return `No fue posible ${action} el ticket. El servicio no está disponible.`;
  }
  if (error.status === 403) return "La sesión no autoriza esta operación.";
  if (error.status === 404) {
    return action === "crear"
      ? "No existe el activo asociado indicado."
      : "No existe un ticket propio con ese identificador.";
  }
  if (error.status === 400 || error.status === 422) return "Revisa los datos del ticket e inténtalo de nuevo.";
  return `No fue posible ${action} el ticket. El servicio no está disponible.`;
}
