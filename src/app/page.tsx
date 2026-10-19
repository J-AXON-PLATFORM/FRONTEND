"use client";

import { ApiError, getCurrentSession } from "@/features/auth/api";
import { AssetWorkspace } from "@/features/inventory/asset-workspace";
import { TicketWorkspace } from "@/features/support/ticket-workspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["authentication", "session"],
    queryFn: getCurrentSession,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1,
  });

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [queryClient, router, session.error]);

  if (session.isPending) {
    return <main className="status-screen" aria-live="polite">Recuperando sesión...</main>;
  }
  if (session.isError) {
    return <main className="status-screen" role="alert">No fue posible recuperar la sesión.</main>;
  }

  return (
    <main className="session-shell">
      <header className="session-header">
        <p className="eyebrow">Sesión activa</p>
        <span className="status-dot">Conectado</span>
      </header>
      <section className="identity-card" aria-labelledby="identity-title">
        <p className="sequence">Identidad verificada</p>
        <h1 id="identity-title">{session.data.username}</h1>
        <p className="intro">Roles concedidos explícitamente</p>
        <ul className="role-list" aria-label="Roles de usuario">
          {session.data.roles.map((role) => <li key={role}>{role.replaceAll("_", " ")}</li>)}
        </ul>
      </section>
      <AssetWorkspace session={session.data} />
      <TicketWorkspace session={session.data} />
    </main>
  );
}
