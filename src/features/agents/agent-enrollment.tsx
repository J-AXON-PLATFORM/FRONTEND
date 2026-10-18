"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  activateAgent,
  AgentContractError,
  getAgent,
  preRegisterAgent,
  registerAgentPublicKey,
  type Agent,
} from "./api";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ED25519_PUBLIC_KEY = /^ssh-ed25519\s+[A-Za-z0-9+/]+={0,2}(?:\s+.*)?$/;

export function AgentEnrollment({
  assetId,
  session,
}: Readonly<{ assetId: string; session: Session }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [agentIdValue, setAgentIdValue] = useState("");
  const [agentId, setAgentId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [keyValidation, setKeyValidation] = useState(false);
  const agentQueryKey = (id: string) => ["users", session.userId, "agents", "agent", id] as const;

  const preRegistration = useMutation({
    mutationFn: () => preRegisterAgent(assetId, session.csrfToken),
    onSuccess: (agent) => {
      activation.reset();
      setAgentIdValue(agent.agentId);
      setAgentId(agent.agentId);
    },
  });
  const lookup = useQuery({
    queryKey: agentQueryKey(agentId),
    queryFn: () => getAgent(agentId),
    enabled: UUID_V4.test(agentId),
    retry: (count, error) => !(error instanceof AgentContractError)
      && !(error instanceof ApiError && error.status < 500)
      && count < 1,
  });
  const keyRegistration = useMutation({
    mutationFn: () => registerAgentPublicKey(agentId, publicKey.trim(), session.csrfToken),
    onSuccess: (agent) => {
      queryClient.setQueryData(agentQueryKey(agent.agentId), agent);
      setPublicKey("");
      setKeyValidation(false);
    },
  });
  const activation = useMutation({
    mutationFn: async () => {
      const connection = await activateAgent(agentId, session.csrfToken);
      const agent = await getAgent(agentId);
      return { agent, connection };
    },
    onSuccess: ({ agent }) => {
      queryClient.setQueryData(agentQueryKey(agent.agentId), agent);
    },
  });
  const authenticationError = [
    preRegistration.error,
    lookup.error,
    keyRegistration.error,
    activation.error,
  ]
    .find((error) => error instanceof ApiError && error.status === 401);

  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = agentIdValue.trim();
    activation.reset();
    setAgentId(candidate);
    if (UUID_V4.test(candidate)) {
      void queryClient.invalidateQueries({ queryKey: agentQueryKey(candidate), exact: true });
    }
  }

  function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = publicKey.trim();
    const invalid = !ED25519_PUBLIC_KEY.test(candidate) || candidate.length > 4096;
    setKeyValidation(invalid);
    if (!invalid && UUID_V4.test(agentId)) {
      keyRegistration.mutate();
    }
  }

  const current = lookup.data
    ?? (preRegistration.data?.agentId === agentId ? preRegistration.data : undefined);

  return (
    <section className="agent-workspace" aria-labelledby="agent-title">
      <header className="workspace-heading">
        <div>
          <p className="sequence">Collector / identidad técnica</p>
          <h2 id="agent-title">Agent</h2>
        </div>
        <p>Pre-registro, clave pública y activación controlada del buzón SFTP del Agent.</p>
      </header>

      <div className="agent-grid">
        <div className="agent-step">
          <div className="form-heading"><span>03</span><h3>Pre-registrar</h3></div>
          <p>Activo seleccionado: <code>{assetId}</code></p>
          <button
            type="button"
            disabled={preRegistration.isPending}
            onClick={() => preRegistration.mutate()}
          >
            {preRegistration.isPending ? "Pre-registrando..." : "Pre-registrar Agent"}
          </button>
          {preRegistration.isError && <p className="form-error" role="alert">{agentError(preRegistration.error, "pre-registrar")}</p>}
          {preRegistration.data && (
            <div className="command-panel">
              <p>Ejecuta localmente, sin conexión al backend:</p>
              <code>jaxon-agent initialize --agent-id {preRegistration.data.agentId} --state-dir &lt;directorio-privado&gt;</code>
              <p>Copia únicamente la clave pública mostrada por el comando.</p>
            </div>
          )}
        </div>

        <div className="agent-step">
          <form onSubmit={submitLookup} className="lookup-form">
            <div className="form-heading"><span>04</span><h3>Consultar por ID</h3></div>
            <div className="field">
              <label htmlFor="agent-id">UUID del Agent</label>
              <div className="lookup-control">
                <input
                  id="agent-id"
                  autoComplete="off"
                  value={agentIdValue}
                  onChange={(event) => setAgentIdValue(event.target.value)}
                  required
                />
                <button type="submit" disabled={lookup.isFetching}>Consultar Agent</button>
              </div>
            </div>
          </form>
          {agentId && !UUID_V4.test(agentId) && <p className="form-error" role="alert">Introduce un UUIDv4 de Agent válido.</p>}
          {lookup.isError && <p className="form-error" role="alert">{agentError(lookup.error, "consultar")}</p>}
          {lookup.isFetching && <p className="result-status" aria-live="polite">Consultando Agent...</p>}
          {current && <AgentCard agent={current} />}
        </div>

        <form className="agent-step key-form" onSubmit={submitKey}>
          <div className="form-heading"><span>05</span><h3>Registrar clave pública</h3></div>
          <div className="field">
            <label htmlFor="agent-public-key">Clave pública OpenSSH Ed25519</label>
            <textarea
              id="agent-public-key"
              rows={5}
              maxLength={4096}
              value={publicKey}
              onChange={(event) => setPublicKey(event.target.value)}
              disabled={keyRegistration.isPending || !UUID_V4.test(agentId)}
              required
            />
          </div>
          <p className="field-help">Nunca pegues ni compartas la clave privada.</p>
          {keyValidation && <p className="form-error" role="alert">Introduce una clave pública ssh-ed25519 válida.</p>}
          {keyRegistration.isError && <p className="form-error" role="alert">{agentError(keyRegistration.error, "registrar la clave")}</p>}
          <button type="submit" disabled={keyRegistration.isPending || !UUID_V4.test(agentId)}>
            {keyRegistration.isPending ? "Registrando..." : "Registrar clave pública"}
          </button>
        </form>

        {current?.status === "PENDING" && current.publicKeyRegistered && (
          <div className="agent-step">
            <div className="form-heading"><span>06</span><h3>Activar Agent</h3></div>
            <p>Provisiona el buzón aislado y confirma la identidad del servidor SFTP.</p>
            <button
              type="button"
              disabled={activation.isPending}
              onClick={() => {
                activation.reset();
                activation.mutate();
              }}
            >
              {activation.isPending ? "Activando..." : "Activar Agent"}
            </button>
            {activation.isError && (
              <p className="form-error" role="alert">
                {agentError(activation.error, "activar", true)}
              </p>
            )}
          </div>
        )}
        {activation.data?.agent.agentId === agentId && (
          <article className="agent-step connection-card" aria-label="Conexión SFTP del Agent">
            <div className="form-heading"><span>OK</span><h3>Conexión SFTP</h3></div>
            <p>Configura el Agent con esta host key obtenida por el canal autenticado.</p>
            <dl>
              <div><dt>Host</dt><dd>{activation.data.connection.host}</dd></div>
              <div><dt>Puerto</dt><dd>{activation.data.connection.port}</dd></div>
              <div><dt>Usuario</dt><dd>{activation.data.connection.username}</dd></div>
              <div><dt>Host key</dt><dd><code>{activation.data.connection.publicHostKey}</code></dd></div>
            </dl>
          </article>
        )}
      </div>
    </section>
  );
}

function AgentCard({ agent }: Readonly<{ agent: Agent }>) {
  return (
    <article className="agent-card" aria-label="Estado del Agent">
      <div className="asset-card-title">
        <h3>{agent.agentId}</h3>
        <span className={`agent-status agent-status-${agent.operationalStatus.toLowerCase()}`}>
          {operationalLabel(agent.operationalStatus)}
        </span>
      </div>
      <dl>
        <div><dt>Activo</dt><dd>{agent.assetId}</dd></div>
        <div><dt>Estado administrativo</dt><dd>{agent.status}</dd></div>
        <div><dt>Estado operativo</dt><dd>{operationalLabel(agent.operationalStatus)}</dd></div>
        <div><dt>Último contacto</dt><dd>{formatUtc(agent.lastSeenAt, "Sin contacto")}</dd></div>
        <div><dt>Último snapshot</dt><dd>{formatUtc(agent.lastSnapshotAt, "Sin snapshot aceptado")}</dd></div>
        <div><dt>Clave pública</dt><dd>{agent.publicKeyRegistered ? "Registrada" : "Pendiente"}</dd></div>
        <div><dt>Huella</dt><dd>{agent.publicKeyFingerprint ?? "Aún no registrada"}</dd></div>
        <div><dt>Versión</dt><dd>{agent.version}</dd></div>
      </dl>
    </article>
  );
}

function operationalLabel(status: Agent["operationalStatus"]) {
  if (status === "ONLINE") return "En línea";
  if (status === "OFFLINE") return "Fuera de línea";
  return "Sin contacto";
}

function formatUtc(value: string | null, empty: string) {
  if (value === null) return empty;
  return `${new Date(value).toISOString().replace("T", " ").replace(".000Z", "Z")} UTC`;
}

function agentError(error: Error | null, action: string, activating = false) {
  if (!(error instanceof ApiError)) {
    return `No fue posible ${action} el Agent. El servicio no está disponible.`;
  }
  if (error.status === 403) return "La sesión no autoriza esta operación.";
  if (error.status === 404) return "No existe el activo o Agent indicado.";
  if (error.status === 409) return activating
    ? "El Agent ya no puede activarse o el aprovisionamiento presenta un conflicto. Reconsulta su estado."
    : "La clave ya pertenece a otro Agent o no puede sustituirse.";
  if (error.status === 400 || error.status === 422) return activating
    ? "Los requisitos de activación no son válidos."
    : "Revisa el UUID y la clave pública Ed25519.";
  return `No fue posible ${action} el Agent. El servicio no está disponible.`;
}
