"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  addTechnicianTicketComment,
  claimTicket,
  getTechnicianTicket,
  listTechnicianQueue,
  listTechnicianTicketConversation,
  listTechnicianTicketComments,
  TicketContractError,
  type Ticket,
  type TicketComment,
  type TicketCommentVisibility,
  type TicketPriority,
  type TechnicianTicketComment,
  updateTicketPriority,
  updateTicketStatus,
} from "./api";

const PAGE_SIZES = [10, 20, 50] as const;
const COMMENT_PAGE_SIZE = 50;

function queueKey(userId: string, page: number, size: number) {
  return ["users", userId, "support", "technician", "tickets", { page, size }] as const;
}

function ticketKey(userId: string, ticketId: string) {
  return ["users", userId, "support", "technician", "ticket", ticketId] as const;
}

function commentsKey(userId: string, ticketId: string, page: number) {
  return [
    "users", userId, "support", "technician", "ticket", ticketId,
    "comments", { page, size: COMMENT_PAGE_SIZE },
  ] as const;
}

function conversationKey(userId: string, ticketId: string, page?: number) {
  const base = ["users", userId, "support", "technician", "ticket", ticketId, "conversation"] as const;
  return page === undefined ? base : [...base, { page, size: COMMENT_PAGE_SIZE }] as const;
}

function readLocation() {
  if (typeof window === "undefined") return { page: 0, size: 20 };
  const parameters = new URLSearchParams(window.location.search);
  const page = Number(parameters.get("page"));
  const size = Number(parameters.get("size"));
  return {
    page: Number.isSafeInteger(page) && page >= 0 ? page : 0,
    size: PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number]) ? size : 20,
  };
}

function retryGet(count: number, error: Error) {
  return !(error instanceof ApiError && error.status < 500)
    && !(error instanceof TicketContractError)
    && count < 1;
}

export function TechnicianTicketWorkspace({ session }: Readonly<{ session: Session }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const initial = readLocation();
  const [page, setPage] = useState(initial.page);
  const [size, setSize] = useState(initial.size);
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const [commentPage, setCommentPage] = useState(0);
  const [commentVisibility, setCommentVisibility] = useState<"" | TicketCommentVisibility>("");
  const [commentBody, setCommentBody] = useState("");
  const canOperate = session.roles.includes("SUPPORT_TECHNICIAN");

  const queue = useQuery({
    queryKey: queueKey(session.userId, page, size),
    queryFn: () => listTechnicianQueue(page, size, session.userId),
    enabled: canOperate,
    retry: retryGet,
  });
  const selectedTicket = useQuery({
    queryKey: ticketKey(session.userId, selectedTicketId),
    queryFn: () => getTechnicianTicket(selectedTicketId, session.userId),
    enabled: canOperate && Boolean(selectedTicketId),
    retry: retryGet,
  });
  const assignedToCurrentUser = selectedTicket.data?.assigneeUserId === session.userId;
  const comments = useQuery({
    queryKey: commentsKey(session.userId, selectedTicketId, commentPage),
    queryFn: () => listTechnicianTicketComments(
      selectedTicketId, commentPage, COMMENT_PAGE_SIZE, session.userId,
    ),
    enabled: canOperate && Boolean(selectedTicketId) && !assignedToCurrentUser,
    retry: retryGet,
  });
  const conversation = useQuery({
    queryKey: conversationKey(session.userId, selectedTicketId, commentPage),
    queryFn: () => listTechnicianTicketConversation(
      selectedTicketId, commentPage, COMMENT_PAGE_SIZE, session.userId,
    ),
    enabled: canOperate && Boolean(selectedTicketId) && assignedToCurrentUser,
    retry: retryGet,
  });
  const claim = useMutation({
    mutationFn: (ticket: Ticket) => claimTicket(
      ticket.ticketId, ticket.version, session.csrfToken, session.userId,
    ),
    retry: false,
    onSuccess: async (ticket) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queueKey(session.userId, page, size), exact: true }),
        queryClient.invalidateQueries({ queryKey: ticketKey(session.userId, ticket.ticketId), exact: true }),
      ]);
    },
  });
  const invalidateTicket = async (ticketId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queueKey(session.userId, page, size), exact: true }),
      queryClient.invalidateQueries({ queryKey: ticketKey(session.userId, ticketId), exact: true }),
    ]);
  };
  const changePriority = useMutation({
    mutationFn: ({ ticket, priority }: { ticket: Ticket; priority: TicketPriority }) => (
      updateTicketPriority(
        ticket.ticketId, ticket.priority, priority, ticket.version, session.csrfToken, session.userId,
      )
    ),
    retry: false,
    onSuccess: (ticket) => invalidateTicket(ticket.ticketId),
    onError: (error, variables) => {
      if (error instanceof ApiError && error.status === 409) {
        return invalidateTicket(variables.ticket.ticketId);
      }
    },
  });
  const changeStatus = useMutation({
    mutationFn: ({ ticket, status }: {
      ticket: Ticket;
      status: "IN_PROGRESS" | "WAITING_FOR_REQUESTER";
    }) => updateTicketStatus(
      ticket.ticketId, ticket.status, status, ticket.version, session.csrfToken, session.userId,
    ),
    retry: false,
    onSuccess: (ticket) => invalidateTicket(ticket.ticketId),
    onError: (error, variables) => {
      if (error instanceof ApiError && error.status === 409) {
        return invalidateTicket(variables.ticket.ticketId);
      }
    },
  });
  const addComment = useMutation({
    mutationFn: ({ ticketId, visibility, body }: {
      ticketId: string;
      visibility: TicketCommentVisibility;
      body: string;
    }) => (
      addTechnicianTicketComment(
        ticketId, visibility, body, session.csrfToken, session.userId,
      )
    ),
    retry: false,
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: conversationKey(session.userId, variables.ticketId),
      });
      if (selectedTicketId === variables.ticketId) {
        setCommentBody("");
        setCommentVisibility("");
      }
    },
  });
  const authenticationError = [
    queue.error, selectedTicket.error, comments.error, conversation.error, claim.error, addComment.error,
    changePriority.error, changeStatus.error,
  ]
    .find((error) => error instanceof ApiError && error.status === 401);

  useEffect(() => {
    const current = readLocation();
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get("page") !== String(current.page)
        || parameters.get("size") !== String(current.size)) {
      parameters.set("page", String(current.page));
      parameters.set("size", String(current.size));
      window.history.replaceState(null, "", `?${parameters}`);
    }
    const synchronize = () => {
      const next = readLocation();
      setPage(next.page);
      setSize(next.size);
    };
    window.addEventListener("popstate", synchronize);
    return () => window.removeEventListener("popstate", synchronize);
  }, []);

  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  if (!canOperate) return null;

  function navigate(nextPage: number, nextSize = size) {
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("page", String(nextPage));
    parameters.set("size", String(nextSize));
    window.history.pushState(null, "", `?${parameters}`);
    setPage(nextPage);
    setSize(nextSize);
  }

  function selectTicket(ticketId: string) {
    claim.reset();
    addComment.reset();
    changePriority.reset();
    changeStatus.reset();
    setSelectedTicketId(ticketId);
    setCommentPage(0);
    setCommentVisibility("");
    setCommentBody("");
  }

  function submitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentBody.trim();
    if (!commentVisibility || !body || body.length > 10_000) return;
    addComment.mutate({ ticketId: selectedTicketId, visibility: commentVisibility, body });
  }

  return (
    <section className="technician-workspace" aria-labelledby="technician-ticket-title">
      <header className="workspace-heading technician-heading">
        <div>
          <p className="sequence">Support / atención técnica</p>
          <h2 id="technician-ticket-title">Bandeja técnica</h2>
        </div>
        <p>Revisa la conversación pública antes del claim y atiende la conversación técnica tras asignarte el ticket.</p>
      </header>

      <div className="technician-grid">
        <section className="technician-queue" aria-labelledby="technician-queue-title">
          <div className="queue-toolbar">
            <div className="form-heading"><span>01</span><h3 id="technician-queue-title">Cola de trabajo</h3></div>
            <label htmlFor="technician-page-size">
              Por página
              <select
                id="technician-page-size"
                value={size}
                disabled={queue.isFetching}
                onChange={(event) => navigate(0, Number(event.target.value))}
              >
                {PAGE_SIZES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          {queue.isPending && <p className="result-status" aria-live="polite">Cargando bandeja...</p>}
          {queue.isError && <p className="form-error" role="alert">{errorMessage(queue.error, "queue")}</p>}
          {queue.data?.items.length === 0 && <p className="ticket-empty">No hay tickets disponibles en esta página.</p>}
          {queue.data && queue.data.items.length > 0 && (
            <ul className="technician-ticket-list" aria-label="Tickets de atención técnica">
              {queue.data.items.map((ticket) => (
                <li key={ticket.ticketId}>
                  <button
                    type="button"
                    aria-pressed={selectedTicketId === ticket.ticketId}
                    onClick={() => selectTicket(ticket.ticketId)}
                  >
                    <span className="queue-state">{ticket.assigneeUserId ? "Asignado a ti" : "Disponible"}</span>
                    <strong>{ticket.summary}</strong>
                    <span>{ticket.type.replaceAll("_", " ")} · {ticket.priority}</span>
                    <time dateTime={ticket.createdAt}>{formatUtc(ticket.createdAt)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {queue.data && (
            <Pagination
              label="Paginación de la bandeja técnica"
              page={page}
              totalPages={queue.data.totalPages}
              pending={queue.isFetching}
              onPage={(nextPage) => navigate(nextPage)}
            />
          )}
        </section>

        <div className="technician-detail">
          {!selectedTicketId && <p className="technician-placeholder">Selecciona un ticket para revisar su contexto.</p>}
          {selectedTicket.isFetching && <p className="result-status" aria-live="polite">Cargando detalle...</p>}
          {selectedTicket.isError && <p className="form-error" role="alert">{errorMessage(selectedTicket.error, "detail")}</p>}
          {selectedTicket.data && (
            <TechnicianTicketCard
              ticket={selectedTicket.data}
              technicianUserId={session.userId}
              pending={claim.isPending}
              onClaim={() => claim.mutate(selectedTicket.data)}
              mutationPending={changePriority.isPending || changeStatus.isPending}
              mutationError={changePriority.error ?? changeStatus.error}
              onPriority={(priority) => {
                changeStatus.reset();
                changePriority.mutate({ ticket: selectedTicket.data, priority });
              }}
              onStatus={(status) => {
                changePriority.reset();
                changeStatus.mutate({ ticket: selectedTicket.data, status });
              }}
            />
          )}
          {claim.isError && <p className="form-error" role="alert">{errorMessage(claim.error, "claim")}</p>}
          {claim.isSuccess && <p className="claim-success" aria-live="polite">Ticket asignado a tu sesión.</p>}
          {selectedTicket.data && (
            <TechnicianConversation
              comments={(assignedToCurrentUser ? conversation.data?.items : comments.data?.items) ?? []}
              page={commentPage}
              totalPages={(assignedToCurrentUser ? conversation.data?.totalPages : comments.data?.totalPages) ?? 0}
              fetching={assignedToCurrentUser ? conversation.isFetching : comments.isFetching}
              error={assignedToCurrentUser ? conversation.error : comments.error}
              assigned={assignedToCurrentUser}
              visibility={commentVisibility}
              body={commentBody}
              pending={addComment.isPending}
              mutationError={addComment.error}
              onPage={setCommentPage}
              onVisibility={setCommentVisibility}
              onBody={setCommentBody}
              onSubmit={submitComment}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function TechnicianTicketCard({
  ticket, technicianUserId, pending, onClaim, mutationPending, mutationError, onPriority, onStatus,
}: Readonly<{
  ticket: Ticket;
  technicianUserId: string;
  pending: boolean;
  onClaim: () => void;
  mutationPending: boolean;
  mutationError: Error | null;
  onPriority: (priority: TicketPriority) => void;
  onStatus: (status: "IN_PROGRESS" | "WAITING_FOR_REQUESTER") => void;
}>) {
  const assignedToCurrentUser = ticket.assigneeUserId === technicianUserId;
  return (
    <article className="technician-ticket-card" aria-label="Detalle técnico del ticket">
      <p className="sequence">Detalle completo</p>
      <div className="ticket-card-title">
        <h3>{ticket.summary}</h3>
        <span>{ticket.status}</span>
      </div>
      <p className="ticket-description">{ticket.description}</p>
      <dl>
        <div><dt>ID</dt><dd>{ticket.ticketId}</dd></div>
        <div><dt>Requester</dt><dd>{ticket.requesterUserId}</dd></div>
        <div><dt>Tipo</dt><dd>{ticket.type.replaceAll("_", " ")}</dd></div>
        <div><dt>Prioridad</dt><dd>{ticket.priority}</dd></div>
        <div><dt>Versión</dt><dd>{ticket.version}</dd></div>
        <div><dt>Asignación</dt><dd>{assignedToCurrentUser ? "Asignado a ti" : "Sin asignar"}</dd></div>
      </dl>
      <button
        className="claim-button"
        type="button"
        disabled={pending || assignedToCurrentUser}
        onClick={onClaim}
      >
        {pending ? "Asignando..." : assignedToCurrentUser ? "Ya está asignado a ti" : "Asignarme ticket"}
      </button>
      {assignedToCurrentUser && (
        <div className="ticket-triage" aria-label="Triaje operativo del ticket">
          <label htmlFor="ticket-priority">Prioridad</label>
          <select
            id="ticket-priority"
            value={ticket.priority}
            disabled={mutationPending}
            onChange={(event) => onPriority(event.target.value as TicketPriority)}
          >
            <option value="LOW">Baja</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">Alta</option>
            <option value="URGENT">Urgente</option>
          </select>
          {ticket.status === "OPEN" && (
            <button type="button" disabled={mutationPending} onClick={() => onStatus("IN_PROGRESS")}>
              Iniciar atención
            </button>
          )}
          {ticket.status === "IN_PROGRESS" && (
            <button type="button" disabled={mutationPending} onClick={() => onStatus("WAITING_FOR_REQUESTER")}>
              Esperar respuesta del requester
            </button>
          )}
          {ticket.status === "WAITING_FOR_REQUESTER" && (
            <button type="button" disabled={mutationPending} onClick={() => onStatus("IN_PROGRESS")}>
              Reanudar atención
            </button>
          )}
          {mutationError && <p className="form-error" role="alert">{errorMessage(mutationError, "triage")}</p>}
        </div>
      )}
    </article>
  );
}

function TechnicianConversation({
  comments, page, totalPages, fetching, error, assigned, visibility, body, pending,
  mutationError, onPage, onVisibility, onBody, onSubmit,
}: Readonly<{
  comments: Array<TicketComment | TechnicianTicketComment>;
  page: number;
  totalPages: number;
  fetching: boolean;
  error: Error | null;
  assigned: boolean;
  visibility: "" | TicketCommentVisibility;
  body: string;
  pending: boolean;
  mutationError: Error | null;
  onPage: (page: number) => void;
  onVisibility: (visibility: "" | TicketCommentVisibility) => void;
  onBody: (body: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}>) {
  return (
    <section className="ticket-conversation" aria-labelledby="technician-conversation-title">
      <div className="form-heading"><span>02</span><h3 id="technician-conversation-title">Conversación del ticket</h3></div>
      <p className="read-only-note">
        {assigned
          ? "Los comentarios públicos son visibles para el requester. Las notas internas permanecen en atención técnica."
          : "Conversación pública de solo lectura hasta que te asignes el ticket."}
      </p>
      {fetching && <p className="result-status" aria-live="polite">Cargando conversación...</p>}
      {error && <p className="form-error" role="alert">{errorMessage(error, "comments")}</p>}
      {!fetching && !error && comments.length === 0 && <p className="ticket-empty">Aún no hay comentarios.</p>}
      {comments.length > 0 && (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li key={comment.commentId} className={`comment-${comment.visibility.toLowerCase()}`}>
              <span
                className={`comment-visibility comment-visibility-${comment.visibility.toLowerCase()}`}
                aria-label={`Visibilidad: ${comment.visibility === "PUBLIC" ? "público" : "interno"}`}
              >
                {comment.visibility === "PUBLIC" ? "Público" : "Interno"}
              </span>
              <p>{comment.body}</p>
              <small>Autor {comment.authorUserId}</small>
              <time dateTime={comment.createdAt}>{formatUtc(comment.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
      <Pagination
        label="Paginación de la conversación técnica"
        page={page}
        totalPages={totalPages}
        pending={fetching}
        onPage={onPage}
      />
      {assigned && (
        <form className="comment-form technician-comment-form" onSubmit={onSubmit}>
          <label htmlFor="technician-comment-visibility">Visibilidad</label>
          <select
            id="technician-comment-visibility"
            value={visibility}
            required
            disabled={pending}
            onChange={(event) => onVisibility(event.target.value as "" | TicketCommentVisibility)}
          >
            <option value="">Selecciona una visibilidad</option>
            <option value="PUBLIC">Público</option>
            <option value="INTERNAL">Interno</option>
          </select>
          <label htmlFor="technician-comment-body">Comentario técnico</label>
          <textarea
            id="technician-comment-body"
            value={body}
            maxLength={10_000}
            rows={4}
            required
            disabled={pending}
            onChange={(event) => onBody(event.target.value)}
          />
          <button
            type="submit"
            disabled={pending || !visibility || !body.trim() || body.trim().length > 10_000}
          >
            {pending ? "Enviando..." : "Añadir a la conversación"}
          </button>
          {mutationError && <p className="form-error" role="alert">{errorMessage(mutationError, "comment")}</p>}
        </form>
      )}
    </section>
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

function formatUtc(value: string) {
  return `${new Date(value).toLocaleString("es-ES", { timeZone: "UTC" })} UTC`;
}

function errorMessage(
  error: Error | null,
  action: "queue" | "detail" | "comments" | "claim" | "comment" | "triage",
) {
  if (error instanceof TicketContractError) return "El servicio devolvió datos de Support con un formato no válido.";
  if (!(error instanceof ApiError)) return "El servicio de Support no está disponible.";
  if (error.status === 403) return "La sesión no autoriza esta operación técnica.";
  if (error.status === 404) return "El ticket ya no está disponible en tu bandeja.";
  if (error.status === 409 && action === "claim") {
    return "Otro técnico cambió o tomó el ticket. Actualiza la bandeja antes de reintentar.";
  }
  if (error.status === 409 && action === "comment") {
    return "El ticket cambió mientras escribías. Conservamos el comentario para que puedas revisar y reintentar.";
  }
  if (error.status === 409 && action === "triage") {
    return "El ticket cambió o la transición ya no es válida. El detalle se actualizó antes de reintentar.";
  }
  if (error.status === 400 || error.status === 422) return "La solicitud no cumple el contrato esperado.";
  return "El servicio de Support no está disponible.";
}
