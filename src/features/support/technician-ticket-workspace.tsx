"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  claimTicket,
  getTechnicianTicket,
  listTechnicianQueue,
  listTechnicianTicketComments,
  TicketContractError,
  type Ticket,
  type TicketComment,
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
  const comments = useQuery({
    queryKey: commentsKey(session.userId, selectedTicketId, commentPage),
    queryFn: () => listTechnicianTicketComments(
      selectedTicketId, commentPage, COMMENT_PAGE_SIZE, session.userId,
    ),
    enabled: canOperate && Boolean(selectedTicketId),
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
  const authenticationError = [queue.error, selectedTicket.error, comments.error, claim.error]
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
    setSelectedTicketId(ticketId);
    setCommentPage(0);
  }

  return (
    <section className="technician-workspace" aria-labelledby="technician-ticket-title">
      <header className="workspace-heading technician-heading">
        <div>
          <p className="sequence">Support / atención técnica</p>
          <h2 id="technician-ticket-title">Bandeja técnica</h2>
        </div>
        <p>Tickets no cerrados, sin asignar o bajo tu atención. La conversación es pública y de solo lectura.</p>
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
            />
          )}
          {claim.isError && <p className="form-error" role="alert">{errorMessage(claim.error, "claim")}</p>}
          {claim.isSuccess && <p className="claim-success" aria-live="polite">Ticket asignado a tu sesión.</p>}
          {selectedTicket.data && (
            <TechnicianConversation
              comments={comments.data?.items ?? []}
              page={commentPage}
              totalPages={comments.data?.totalPages ?? 0}
              fetching={comments.isFetching}
              error={comments.error}
              onPage={setCommentPage}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function TechnicianTicketCard({ ticket, technicianUserId, pending, onClaim }: Readonly<{
  ticket: Ticket;
  technicianUserId: string;
  pending: boolean;
  onClaim: () => void;
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
    </article>
  );
}

function TechnicianConversation({ comments, page, totalPages, fetching, error, onPage }: Readonly<{
  comments: TicketComment[];
  page: number;
  totalPages: number;
  fetching: boolean;
  error: Error | null;
  onPage: (page: number) => void;
}>) {
  return (
    <section className="ticket-conversation" aria-labelledby="technician-conversation-title">
      <div className="form-heading"><span>02</span><h3 id="technician-conversation-title">Conversación pública</h3></div>
      <p className="read-only-note">Solo lectura en este incremento.</p>
      {fetching && <p className="result-status" aria-live="polite">Cargando conversación...</p>}
      {error && <p className="form-error" role="alert">{errorMessage(error, "comments")}</p>}
      {!fetching && !error && comments.length === 0 && <p className="ticket-empty">Aún no hay comentarios públicos.</p>}
      {comments.length > 0 && (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li key={comment.commentId}>
              <p>{comment.body}</p>
              <small>Autor {comment.authorUserId}</small>
              <time dateTime={comment.createdAt}>{formatUtc(comment.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
      <Pagination
        label="Paginación de comentarios públicos"
        page={page}
        totalPages={totalPages}
        pending={fetching}
        onPage={onPage}
      />
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

function errorMessage(error: Error | null, action: "queue" | "detail" | "comments" | "claim") {
  if (error instanceof TicketContractError) return "El servicio devolvió datos de Support con un formato no válido.";
  if (!(error instanceof ApiError)) return "El servicio de Support no está disponible.";
  if (error.status === 403) return "La sesión no autoriza esta operación técnica.";
  if (error.status === 404) return "El ticket ya no está disponible en tu bandeja.";
  if (error.status === 409 && action === "claim") {
    return "Otro técnico cambió o tomó el ticket. Actualiza la bandeja antes de reintentar.";
  }
  if (error.status === 400 || error.status === 422) return "La solicitud no cumple el contrato esperado.";
  return "El servicio de Support no está disponible.";
}
