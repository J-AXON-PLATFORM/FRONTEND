"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  addTicketComment,
  createTicket,
  getTicket,
  listTicketComments,
  listTicketLifecycle,
  listTickets,
  reopenTicket,
  TicketContractError,
  type Ticket,
  type TicketComment,
  type TicketLifecycleEntry,
  type TicketType,
} from "./api";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_PAGE_SIZE = 20;
const COMMENT_PAGE_SIZE = 50;
const LIFECYCLE_PAGE_SIZE = 50;
const TICKET_TYPES: { value: TicketType; label: string }[] = [
  { value: "INCIDENT", label: "Incidente" },
  { value: "SERVICE_REQUEST", label: "Solicitud de servicio" },
  { value: "QUESTION", label: "Consulta" },
  { value: "OTHER", label: "Otro" },
];

function ticketKey(userId: string, ticketId: string) {
  return ["users", userId, "support", "ticket", ticketId] as const;
}

function ticketListKey(userId: string, page: number) {
  return ["users", userId, "support", "tickets", { page, size: TICKET_PAGE_SIZE }] as const;
}

function commentKey(userId: string, ticketId: string, page: number) {
  return [
    "users", userId, "support", "ticket", ticketId, "comments",
    { page, size: COMMENT_PAGE_SIZE },
  ] as const;
}

function lifecycleKey(userId: string, ticketId: string, page?: number) {
  const base = ["users", userId, "support", "ticket", ticketId, "lifecycle"] as const;
  return page === undefined ? base : [...base, { page, size: LIFECYCLE_PAGE_SIZE }] as const;
}

function retryGet(count: number, error: Error) {
  return !(error instanceof ApiError && error.status < 500)
    && !(error instanceof TicketContractError)
    && count < 1;
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
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const [ticketPage, setTicketPage] = useState(0);
  const [commentPage, setCommentPage] = useState(0);
  const [commentBody, setCommentBody] = useState("");
  const [lifecyclePage, setLifecyclePage] = useState(0);
  const [reopenReason, setReopenReason] = useState("");
  const canOperate = session.roles.includes("IT_OPERATOR");

  const tickets = useQuery({
    queryKey: ticketListKey(session.userId, ticketPage),
    queryFn: () => listTickets(ticketPage, TICKET_PAGE_SIZE, session.userId),
    enabled: canOperate,
    retry: retryGet,
  });
  const selectedTicket = useQuery({
    queryKey: ticketKey(session.userId, selectedTicketId),
    queryFn: () => getTicket(selectedTicketId, session.userId),
    enabled: canOperate && UUID_V4.test(selectedTicketId),
    retry: retryGet,
  });
  const comments = useQuery({
    queryKey: commentKey(session.userId, selectedTicketId, commentPage),
    queryFn: () => listTicketComments(
      selectedTicketId, commentPage, COMMENT_PAGE_SIZE, session.userId,
    ),
    enabled: canOperate && UUID_V4.test(selectedTicketId),
    retry: retryGet,
  });
  const lifecycle = useQuery({
    queryKey: lifecycleKey(session.userId, selectedTicketId, lifecyclePage),
    queryFn: () => listTicketLifecycle(
      selectedTicketId, lifecyclePage, LIFECYCLE_PAGE_SIZE, session.userId,
    ),
    enabled: canOperate && UUID_V4.test(selectedTicketId),
    retry: retryGet,
  });
  const creation = useMutation({
    mutationFn: () => createTicket({
      type,
      summary: summary.trim(),
      description: description.trim(),
      ...(assetId.trim() ? { assetId: assetId.trim() } : {}),
    }, session.csrfToken, session.userId),
    retry: false,
    onSuccess: (ticket) => {
      setCreatedTicket(ticket);
      setLookupValue(ticket.ticketId);
      selectTicket(ticket.ticketId);
      setSummary("");
      setDescription("");
      setAssetId("");
      void queryClient.invalidateQueries({
        queryKey: ["users", session.userId, "support", "tickets"],
      });
    },
  });
  const commentCreation = useMutation({
    mutationFn: ({ ticketId, body }: { ticketId: string; body: string }) => addTicketComment(
      ticketId, body, session.csrfToken, session.userId,
    ),
    retry: false,
    onSuccess: async (_, variables) => {
      setCommentBody("");
      await queryClient.invalidateQueries({
        queryKey: [
          "users", session.userId, "support", "ticket", variables.ticketId, "comments",
        ],
      });
      const firstPage = await queryClient.fetchQuery({
        queryKey: commentKey(session.userId, variables.ticketId, 0),
        queryFn: () => listTicketComments(
          variables.ticketId, 0, COMMENT_PAGE_SIZE, session.userId,
        ),
      });
      if (selectedTicketId === variables.ticketId) {
        setCommentPage(Math.max(0, firstPage.totalPages - 1));
      }
    },
  });
  const reopen = useMutation({
    mutationFn: (ticket: Ticket) => reopenTicket(
      ticket.ticketId, reopenReason.trim(), ticket.version, session.csrfToken, session.userId, false,
    ),
    retry: false,
    onSuccess: async (ticket) => {
      setReopenReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ticketKey(session.userId, ticket.ticketId), exact: true }),
        queryClient.invalidateQueries({ queryKey: lifecycleKey(session.userId, ticket.ticketId) }),
        queryClient.invalidateQueries({ queryKey: ["users", session.userId, "support", "tickets"] }),
      ]);
    },
    onError: (error, ticket) => {
      if (error instanceof ApiError && error.status === 409) {
        return queryClient.invalidateQueries({ queryKey: ticketKey(session.userId, ticket.ticketId), exact: true });
      }
    },
  });
  const authenticationError = [
    tickets.error, selectedTicket.error, comments.error, lifecycle.error, creation.error,
    commentCreation.error, reopen.error,
  ].find((error) => error instanceof ApiError && error.status === 401);

  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  if (!canOperate) return null;

  function selectTicket(ticketId: string) {
    commentCreation.reset();
    setSelectedTicketId(ticketId);
    setCommentPage(0);
    setLifecyclePage(0);
    setCommentBody("");
    setReopenReason("");
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
    selectTicket(candidate);
    if (UUID_V4.test(candidate)) {
      void queryClient.invalidateQueries({
        queryKey: ticketKey(session.userId, candidate), exact: true,
      });
    }
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commentBody.trim()) {
      commentCreation.mutate({ ticketId: selectedTicketId, body: commentBody.trim() });
    }
  }

  const invalidAssetId = Boolean(assetId.trim()) && !UUID_V4.test(assetId.trim());
  const invalidLookup = Boolean(selectedTicketId) && !UUID_V4.test(selectedTicketId);
  return (
    <section className="ticket-workspace" aria-labelledby="ticket-title">
      <header className="workspace-heading">
        <div>
          <p className="sequence">Support / solicitud propia</p>
          <h2 id="ticket-title">Tickets</h2>
        </div>
        <p>Alta, consulta y conversación pública de tus tickets, sin autoridad sobre su ciclo de vida.</p>
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
          <div className="ticket-list-panel">
            <div className="form-heading"><span>02</span><h3>Mis tickets</h3></div>
            {tickets.isPending && <p className="result-status" aria-live="polite">Cargando tickets...</p>}
            {tickets.isError && <p className="form-error" role="alert">{errorMessage(tickets.error, "listar")}</p>}
            {tickets.data?.items.length === 0 && <p className="ticket-empty">Todavía no tienes tickets.</p>}
            {tickets.data && tickets.data.items.length > 0 && (
              <ul className="ticket-list" aria-label="Tickets propios">
                {tickets.data.items.map((ticket) => (
                  <li key={ticket.ticketId}>
                    <button
                      type="button"
                      aria-pressed={selectedTicketId === ticket.ticketId}
                      onClick={() => {
                        setLookupValue(ticket.ticketId);
                        setCreatedTicket(undefined);
                        selectTicket(ticket.ticketId);
                      }}
                    >
                      <span>{ticket.type.replaceAll("_", " ")}</span>
                      <strong>{ticket.summary}</strong>
                      <time dateTime={ticket.createdAt}>{formatUtc(ticket.createdAt)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tickets.data && (
              <Pagination
                label="Paginación de tickets"
                page={ticketPage}
                totalPages={tickets.data.totalPages}
                pending={tickets.isFetching}
                onPage={setTicketPage}
              />
            )}
          </div>

          <form className="lookup-form" onSubmit={submitLookup}>
            <div className="form-heading"><span>03</span><h3>Consultar por ID</h3></div>
            <div className="field">
              <label htmlFor="ticket-id">UUID del ticket</label>
              <div className="lookup-control">
                <input id="ticket-id" autoComplete="off" placeholder="00000000-0000-4000-8000-000000000000" required value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} />
                <button type="submit" disabled={selectedTicket.isFetching}>Buscar ticket</button>
              </div>
            </div>
          </form>
          {invalidLookup && <p className="form-error" role="alert">Introduce un UUIDv4 válido.</p>}
          {selectedTicket.isError && <p className="form-error" role="alert">{errorMessage(selectedTicket.error, "consultar")}</p>}
          {selectedTicket.isFetching && <p className="result-status" aria-live="polite">Consultando ticket...</p>}
          {createdTicket && <TicketCard ticket={createdTicket} label="Resultado de creación del ticket" />}
          {selectedTicket.data && <TicketCard ticket={selectedTicket.data} label="Consulta del ticket por ID" />}
          {selectedTicket.data && (
            <Conversation
              ticketId={selectedTicket.data.ticketId}
              comments={comments.data?.items ?? []}
              page={commentPage}
              totalPages={comments.data?.totalPages ?? 0}
              body={commentBody}
              pending={commentCreation.isPending}
              fetching={comments.isFetching}
              commentsError={comments.error}
              commentError={commentCreation.error}
              onBody={setCommentBody}
              onPage={setCommentPage}
              onSubmit={submitComment}
              closed={selectedTicket.data.status === "CLOSED"}
            />
          )}
          {selectedTicket.data && (
            <LifecycleTimeline
              entries={lifecycle.data?.items ?? []}
              page={lifecyclePage}
              totalPages={lifecycle.data?.totalPages ?? 0}
              fetching={lifecycle.isFetching}
              error={lifecycle.error}
              onPage={setLifecyclePage}
            />
          )}
          {selectedTicket.data
            && (selectedTicket.data.status === "RESOLVED" || selectedTicket.data.status === "CLOSED") && (
            <form className="lifecycle-form" onSubmit={(event) => {
              event.preventDefault();
              if (reopenReason.trim()) reopen.mutate(selectedTicket.data);
            }}>
              <div className="form-heading"><span>06</span><h3>Reabrir ticket</h3></div>
              <label htmlFor={`reopen-${selectedTicket.data.ticketId}`}>Motivo de reapertura</label>
              <textarea
                id={`reopen-${selectedTicket.data.ticketId}`}
                required
                maxLength={2000}
                rows={4}
                value={reopenReason}
                disabled={reopen.isPending}
                onChange={(event) => setReopenReason(event.target.value)}
              />
              {reopen.isError && <p className="form-error" role="alert">{errorMessage(reopen.error, "reabrir")}</p>}
              <button type="submit" disabled={reopen.isPending || !reopenReason.trim()}>
                {reopen.isPending ? "Reabriendo..." : "Reabrir ticket"}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Conversation({
  ticketId, comments, page, totalPages, body, pending, fetching, commentsError, commentError,
  onBody, onPage, onSubmit, closed,
}: Readonly<{
  ticketId: string;
  comments: TicketComment[];
  page: number;
  totalPages: number;
  body: string;
  pending: boolean;
  fetching: boolean;
  commentsError: Error | null;
  commentError: Error | null;
  onBody: (body: string) => void;
  onPage: (page: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  closed: boolean;
}>) {
  return (
    <section className="ticket-conversation" aria-labelledby={`conversation-${ticketId}`}>
      <div className="form-heading"><span>04</span><h3 id={`conversation-${ticketId}`}>Conversación pública</h3></div>
      {fetching && <p className="result-status" aria-live="polite">Cargando conversación...</p>}
      {commentsError && <p className="form-error" role="alert">{errorMessage(commentsError, "consultar")}</p>}
      {commentError && <p className="form-error" role="alert">{errorMessage(commentError, "comentar")}</p>}
      {!fetching && !commentsError && comments.length === 0 && <p className="ticket-empty">Aún no hay comentarios públicos.</p>}
      {comments.length > 0 && (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li key={comment.commentId}>
              <p>{comment.body}</p>
              <time dateTime={comment.createdAt}>{formatUtc(comment.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
      <Pagination
        label="Paginación de comentarios"
        page={page}
        totalPages={totalPages}
        pending={fetching}
        onPage={onPage}
      />
      {closed
        ? <p className="read-only-note">El ticket está cerrado. Reábrelo para continuar la conversación.</p>
        : (
          <form className="comment-form" onSubmit={onSubmit}>
            <label htmlFor={`comment-${ticketId}`}>Añadir comentario público</label>
            <textarea id={`comment-${ticketId}`} required maxLength={10000} rows={4} value={body} disabled={pending} onChange={(event) => onBody(event.target.value)} />
            <button type="submit" disabled={pending || !body.trim()}>{pending ? "Publicando..." : "Publicar comentario"}</button>
          </form>
        )}
    </section>
  );
}

function LifecycleTimeline({ entries, page, totalPages, fetching, error, onPage }: Readonly<{
  entries: TicketLifecycleEntry[];
  page: number;
  totalPages: number;
  fetching: boolean;
  error: Error | null;
  onPage: (page: number) => void;
}>) {
  return (
    <section className="lifecycle-timeline" aria-labelledby="requester-lifecycle-title">
      <div className="form-heading"><span>05</span><h3 id="requester-lifecycle-title">Historial del ciclo de vida</h3></div>
      {fetching && <p className="result-status" aria-live="polite">Cargando historial...</p>}
      {error && <p className="form-error" role="alert">{errorMessage(error, "consultar")}</p>}
      {!fetching && !error && entries.length === 0 && <p className="ticket-empty">Aún no hay eventos terminales.</p>}
      <ol className="lifecycle-list">
        {entries.map((entry) => <LifecycleItem key={entry.lifecycleEventId} entry={entry} />)}
      </ol>
      <Pagination label="Paginación del historial" page={page} totalPages={totalPages} pending={fetching} onPage={onPage} />
    </section>
  );
}

function LifecycleItem({ entry }: Readonly<{ entry: TicketLifecycleEntry }>) {
  const detail = entry.resolutionSummary ?? entry.reopenReason
    ?? (entry.closeReason ? `Motivo: ${entry.closeReason.replaceAll("_", " ")}` : "");
  return (
    <li>
      <strong>{entry.eventType}</strong>
      <span>{entry.fromStatus} → {entry.toStatus}</span>
      {detail && <p>{detail}</p>}
      <time dateTime={entry.occurredAt}>{formatUtc(entry.occurredAt)}</time>
    </li>
  );
}

function Pagination({ label, page, totalPages, pending, onPage }: Readonly<{
  label: string;
  page: number;
  totalPages: number;
  pending: boolean;
  onPage: (page: number) => void;
}>) {
  return (
    <nav className="ticket-pagination" aria-label={label}>
      <button type="button" disabled={pending || page === 0} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Página {totalPages === 0 ? 0 : page + 1} de {totalPages}</span>
      <button type="button" disabled={pending || page + 1 >= totalPages} onClick={() => onPage(page + 1)}>Siguiente</button>
    </nav>
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
        <div><dt>Creado</dt><dd>{formatUtc(ticket.createdAt)}</dd></div>
      </dl>
    </article>
  );
}

function formatUtc(value: string) {
  return `${new Date(value).toLocaleString("es-ES", { timeZone: "UTC" })} UTC`;
}

function errorMessage(error: Error | null, action: "crear" | "consultar" | "listar" | "comentar" | "reabrir") {
  if (error instanceof TicketContractError) {
    return "El servicio devolvió datos de Support con un formato no válido.";
  }
  if (!(error instanceof ApiError)) {
    return `No fue posible ${action} tickets. El servicio no está disponible.`;
  }
  if (error.status === 403) return "La sesión no autoriza esta operación.";
  if (error.status === 404) {
    return action === "crear"
      ? "No existe el activo asociado indicado."
      : "No existe un ticket propio con ese identificador.";
  }
  if (error.status === 409 && action === "reabrir") {
    return "El ticket cambió o ya no puede reabrirse. El detalle se actualizó; revisa antes de reintentar.";
  }
  if (error.status === 400 || error.status === 422) return "Revisa los datos e inténtalo de nuevo.";
  return `No fue posible ${action} tickets. El servicio no está disponible.`;
}
