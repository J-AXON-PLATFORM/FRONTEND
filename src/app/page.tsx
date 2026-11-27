"use client";

import { ApiError, getCurrentSession } from "@/features/auth/api";
import { LogoutButton } from "@/features/auth/logout-button";
import { AiRetrievalWorkspace } from "@/features/ai/ai-retrieval-workspace";
import { AiSourceWorkspace } from "@/features/ai/ai-source-workspace";
import { UserAdministration } from "@/features/administration/user-administration";
import { AuditWorkspace } from "@/features/audit/audit-workspace";
import { AuthorizedScopeWorkspace } from "@/features/discovery/authorized-scope-workspace";
import { DiscoveryExecutorWorkspace } from "@/features/discovery/discovery-executor-workspace";
import { DiscoveryJobWorkspace } from "@/features/discovery/discovery-job-workspace";
import { AssetWorkspace } from "@/features/inventory/asset-workspace";
import { ReportingWorkspace } from "@/features/reporting/reporting-workspace";
import { TicketWorkspace } from "@/features/support/ticket-workspace";
import { TechnicianTicketWorkspace } from "@/features/support/technician-ticket-workspace";
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
        <div className="session-actions">
          <span className="status-dot">Conectado</span>
          <LogoutButton csrfToken={session.data.csrfToken} />
        </div>
      </header>
      <section className="identity-card" aria-labelledby="identity-title">
        <p className="sequence">Identidad verificada</p>
        <h1 id="identity-title">{session.data.username}</h1>
        <p className="intro">Roles concedidos explícitamente</p>
        <ul className="role-list" aria-label="Roles de usuario">
          {session.data.roles.map((role) => <li key={role}>{role.replaceAll("_", " ")}</li>)}
        </ul>
      </section>
      {session.data.roles.includes("SYSTEM_ADMIN") && <UserAdministration session={session.data} />}
      {session.data.roles.includes("SYSTEM_ADMIN") && <AiSourceWorkspace session={session.data} />}
      {session.data.roles.includes("SYSTEM_ADMIN") && <AiRetrievalWorkspace session={session.data} />}
      {(session.data.roles.includes("SYSTEM_ADMIN") || session.data.roles.includes("IT_OPERATOR"))
        && <AuthorizedScopeWorkspace session={session.data} />}
      {session.data.roles.includes("SYSTEM_ADMIN")
        && <DiscoveryExecutorWorkspace session={session.data} />}
      {session.data.roles.includes("IT_OPERATOR")
        && <DiscoveryJobWorkspace session={session.data} />}
      {session.data.roles.includes("IT_OPERATOR") && <AssetWorkspace session={session.data} />}
      {session.data.roles.includes("IT_OPERATOR") && <TicketWorkspace session={session.data} />}
      {session.data.roles.includes("SUPPORT_TECHNICIAN") && <TechnicianTicketWorkspace session={session.data} />}
      {session.data.roles.includes("AUDITOR") && <AuditWorkspace session={session.data} />}
      {(session.data.roles.includes("AUDITOR")
        || session.data.roles.includes("IT_OPERATOR")
        || session.data.roles.includes("SUPPORT_TECHNICIAN"))
        && <ReportingWorkspace session={session.data} />}
    </main>
  );
}
