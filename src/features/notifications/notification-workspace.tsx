"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  NOTIFICATION_DEFAULT_SIZE,
  NOTIFICATION_SIZES,
  NotificationContractError,
  listNotifications,
  markNotificationRead,
  type Notification,
  type NotificationFilters,
  type NotificationStatus,
} from "./api";

function notificationKey(userId: string, filters: NotificationFilters) {
  return ["users", userId, "notifications", filters] as const;
}

export function NotificationWorkspace({ session }: Readonly<{ session: Session }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<NotificationFilters>({
    page: 0,
    size: NOTIFICATION_DEFAULT_SIZE,
  });
  const notifications = useQuery({
    queryKey: notificationKey(session.userId, filters),
    queryFn: () => listNotifications(filters),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const read = useMutation({
    mutationFn: (notification: Notification) => markNotificationRead(
      notification.notificationId,
      notification.version,
      session.csrfToken,
    ),
    retry: false,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users", session.userId, "notifications"] });
    },
  });

  const authenticationError = (notifications.error instanceof ApiError && notifications.error.status === 401)
    || (read.error instanceof ApiError && read.error.status === 401);
  useEffect(() => {
    if (authenticationError) {
      queryClient.clear();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  function changeStatus(value: string) {
    setFilters((current) => ({
      ...(value ? { status: value as NotificationStatus } : {}),
      page: 0,
      size: current.size,
    }));
    read.reset();
  }

  const busy = notifications.isFetching || read.isPending;

  return (
    <section className="notification-workspace" aria-labelledby="notification-title">
      <header className="workspace-heading notification-heading">
        <div>
          <p className="sequence">Automation / bandeja propia</p>
          <h2 id="notification-title">Notificaciones</h2>
        </div>
        <p>Avisos in-app de tu sesión. Actualización manual, sin polling ni estado sensible persistido.</p>
      </header>
      <div className="notification-toolbar">
        <label htmlFor="notification-status">
          Estado
          <select id="notification-status" value={filters.status ?? ""} disabled={busy}
            onChange={(event) => changeStatus(event.target.value)}>
            <option value="">Todas</option>
            <option value="UNREAD">No leídas</option>
            <option value="READ">Leídas</option>
          </select>
        </label>
        <label htmlFor="notification-size">
          Por página
          <select id="notification-size" value={filters.size} disabled={busy}
            onChange={(event) => setFilters((current) => ({
              ...current, page: 0, size: Number(event.target.value),
            }))}>
            {NOTIFICATION_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void notifications.refetch()}>
          {notifications.isFetching ? "Actualizando..." : "Actualizar"}
        </button>
      </div>
      {read.isError && <p className="form-error" role="alert">{notificationError(read.error, true)}</p>}
      <div className="notification-results" aria-live="polite">
        {notifications.isPending && <p className="administration-empty">Consultando notificaciones...</p>}
        {!notifications.isPending && notifications.isError && (
          <p className="form-error" role="alert">{notificationError(notifications.error, false)}</p>
        )}
        {notifications.isSuccess && notifications.data.items.length === 0 && (
          <p className="administration-empty">No hay notificaciones para este filtro.</p>
        )}
        {notifications.isSuccess && notifications.data.items.length > 0 && (
          <ol className="notification-list" aria-label="Notificaciones propias">
            {notifications.data.items.map((item) => (
              <li key={item.notificationId}>
                <NotificationCard
                  notification={item}
                  busy={read.isPending}
                  onRead={() => read.mutate(item)}
                />
              </li>
            ))}
          </ol>
        )}
        {notifications.isSuccess && (
          <nav className="notification-pagination" aria-label="Paginación de notificaciones">
            <button type="button" disabled={busy || filters.page === 0}
              onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Anterior</button>
            <span>
              Página {notifications.data.totalPages === 0 ? 0 : filters.page + 1}
              {" de "}{notifications.data.totalPages} · {notifications.data.totalElements} aviso(s)
            </span>
            <button type="button" disabled={busy || filters.page + 1 >= notifications.data.totalPages}
              onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Siguiente</button>
          </nav>
        )}
      </div>
    </section>
  );
}

function NotificationCard({
  notification,
  busy,
  onRead,
}: Readonly<{ notification: Notification; busy: boolean; onRead: () => void }>) {
  return (
    <article aria-label={`Notificación ${notification.type}`}>
      <header>
        <span className={`notification-status notification-status-${notification.status.toLowerCase()}`}>
          {notification.status === "UNREAD" ? "No leída" : "Leída"}
        </span>
        <h3>El ticket espera tu respuesta</h3>
      </header>
      <p>Ticket <strong>{notification.resourceId}</strong></p>
      <p className="notification-time">Creada {formatUtc(notification.createdAt)}</p>
      {notification.readAt && <p className="notification-time">Leída {formatUtc(notification.readAt)}</p>}
      {notification.status === "UNREAD" && (
        <button type="button" disabled={busy} onClick={onRead}>Marcar como leída</button>
      )}
    </article>
  );
}

function notificationError(error: Error | null, mutation: boolean) {
  if (error instanceof NotificationContractError) {
    return "El servicio devolvió notificaciones con un formato no válido.";
  }
  if (!(error instanceof ApiError)) return "No fue posible consultar las notificaciones.";
  if (error.status === 401) return "La sesión ya no es válida.";
  if (mutation && error.status === 404) return "La notificación ya no está disponible.";
  if (mutation && error.status === 409) return "La notificación cambió; actualiza la bandeja e inténtalo de nuevo.";
  if (error.status === 422) return "Revisa el filtro o la paginación.";
  return mutation ? "No fue posible marcar la notificación." : "No fue posible consultar las notificaciones.";
}

function formatUtc(value: string) {
  return `${new Date(value).toLocaleString("es-ES", { timeZone: "UTC" })} UTC`;
}
