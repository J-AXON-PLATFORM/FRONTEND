"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { AgentEnrollment } from "@/features/agents/agent-enrollment";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  createAsset,
  getAsset,
  getAssetTechnicalState,
  openTechnicalStateEvents,
  parseTechnicalStateUpdatedEvent,
  type Asset,
  type AssetStatus,
  type AssetType,
  type TechnicalState,
} from "./api";

const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: "DESKTOP", label: "Equipo de escritorio" },
  { value: "LAPTOP", label: "Portátil" },
  { value: "SERVER", label: "Servidor" },
  { value: "NETWORK_DEVICE", label: "Dispositivo de red" },
  { value: "PRINTER", label: "Impresora" },
  { value: "OTHER", label: "Otro" },
];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function AssetWorkspace({ session }: Readonly<{ session: Session }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("DESKTOP");
  const [status, setStatus] = useState<AssetStatus>("ACTIVE");
  const [createdAsset, setCreatedAsset] = useState<Asset>();
  const [lookupValue, setLookupValue] = useState("");
  const [lookupId, setLookupId] = useState("");

  const creation = useMutation({
    mutationFn: () => createAsset({ name, assetType, status }, session.csrfToken),
    onSuccess: (asset) => {
      setCreatedAsset(asset);
      setLookupValue(asset.assetId);
      setLookupId(asset.assetId);
      setName("");
    },
  });
  const lookup = useQuery({
    queryKey: ["inventory", session.userId, "asset", lookupId],
    queryFn: () => getAsset(lookupId),
    enabled: UUID_V4.test(lookupId),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  });
  const selectedAsset = lookupId ? lookup.data : createdAsset;
  const technicalState = useQuery({
    queryKey: ["collector", session.userId, "asset-technical-state", selectedAsset?.assetId],
    queryFn: () => getAssetTechnicalState(selectedAsset!.assetId),
    enabled: Boolean(selectedAsset),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  });
  const authenticationError = [creation.error, lookup.error, technicalState.error]
    .find((error) => error instanceof ApiError && error.status === 401);
  const canOperate = session.roles.includes("IT_OPERATOR");

  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  useEffect(() => {
    const assetId = selectedAsset?.assetId;
    if (!assetId || !canOperate || typeof EventSource === "undefined") {
      return;
    }
    const source = openTechnicalStateEvents(assetId);
    const handleUpdate = (event: MessageEvent<string>) => {
      const update = parseTechnicalStateUpdatedEvent(event.data);
      if (update?.assetId === assetId && event.lastEventId === update.eventId) {
        void queryClient.invalidateQueries({
          queryKey: ["collector", session.userId, "asset-technical-state", assetId],
          exact: true,
        });
      }
    };
    source.addEventListener("ASSET_TECHNICAL_STATE_UPDATED", handleUpdate);
    return () => {
      source.removeEventListener("ASSET_TECHNICAL_STATE_UPDATED", handleUpdate);
      source.close();
    };
  }, [canOperate, queryClient, selectedAsset?.assetId, session.userId]);

  if (!canOperate) {
    return (
      <section className="permission-panel" aria-labelledby="inventory-title">
        <p className="sequence">Inventory / acceso restringido</p>
        <h2 id="inventory-title">Sin permiso de operación</h2>
        <p>La sesión está activa, pero no incluye el rol IT OPERATOR requerido para consultar o crear activos.</p>
      </section>
    );
  }

  function submitCreation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    creation.mutate();
  }

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = lookupValue.trim();
    if (!UUID_V4.test(candidate)) {
      setLookupId(candidate);
      return;
    }
    setLookupId(candidate);
    void queryClient.invalidateQueries({ queryKey: ["inventory", session.userId, "asset", candidate] });
  }

  return (
    <section className="inventory-workspace" aria-labelledby="inventory-title">
      <header className="workspace-heading">
        <div>
          <p className="sequence">Inventory / registro oficial</p>
          <h2 id="inventory-title">Activos</h2>
        </div>
        <p>Alta mínima y consulta directa. Sin listado, edición ni borrado.</p>
      </header>

      <div className="workspace-grid">
        <form className="asset-form" onSubmit={submitCreation} aria-describedby={creation.isError ? "asset-create-error" : undefined}>
          <div className="form-heading">
            <span>01</span>
            <h3>Registrar activo</h3>
          </div>
          <div className="field">
            <label htmlFor="asset-name">Nombre</label>
            <input
              id="asset-name"
              maxLength={256}
              required
              disabled={creation.isPending}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="asset-type">Tipo</label>
            <select id="asset-type" disabled={creation.isPending} value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}>
              {ASSET_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>
          <fieldset disabled={creation.isPending}>
            <legend>Estado inicial</legend>
            <label><input type="radio" name="status" value="ACTIVE" checked={status === "ACTIVE"} onChange={() => setStatus("ACTIVE")} /> Activo</label>
            <label><input type="radio" name="status" value="INACTIVE" checked={status === "INACTIVE"} onChange={() => setStatus("INACTIVE")} /> Inactivo</label>
          </fieldset>
          {creation.isError && <p className="form-error" id="asset-create-error" role="alert">{errorMessage(creation.error, "crear")}</p>}
          <button type="submit" disabled={creation.isPending}>
            {creation.isPending ? "Registrando..." : "Registrar activo"}
          </button>
        </form>

        <div className="asset-results">
          <form className="lookup-form" onSubmit={submitLookup}>
            <div className="form-heading">
              <span>02</span>
              <h3>Consultar por ID</h3>
            </div>
            <div className="field">
              <label htmlFor="asset-id">UUID del activo</label>
              <div className="lookup-control">
                <input
                  id="asset-id"
                  autoComplete="off"
                  placeholder="00000000-0000-4000-8000-000000000000"
                  value={lookupValue}
                  onChange={(event) => setLookupValue(event.target.value)}
                  required
                />
                <button type="submit" disabled={lookup.isFetching}>Consultar</button>
              </div>
            </div>
          </form>

          {lookupId && !UUID_V4.test(lookupId) && <p className="form-error" role="alert">Introduce un UUIDv4 válido.</p>}
          {lookup.isError && <p className="form-error" role="alert">{errorMessage(lookup.error, "consultar")}</p>}
          {lookup.isFetching && <p className="result-status" aria-live="polite">Consultando ficha oficial...</p>}
          {createdAsset && <AssetCard asset={createdAsset} label="Resultado de creación" />}
          {lookup.data && <AssetCard asset={lookup.data} label="Consulta por ID" />}
        </div>
      </div>
      {selectedAsset && (
        <>
          <TechnicalStatePanel
            state={technicalState.data}
            error={technicalState.error}
            loading={technicalState.isLoading}
            refreshing={technicalState.isFetching && !technicalState.isLoading}
            onRefresh={() => void technicalState.refetch()}
          />
          <AgentEnrollment key={selectedAsset.assetId} assetId={selectedAsset.assetId} session={session} />
        </>
      )}
    </section>
  );
}

function AssetCard({ asset, label }: Readonly<{ asset: Asset; label: string }>) {
  return (
    <article className="asset-card" aria-label={label}>
      <p className="sequence">{label}</p>
      <h3 className="record-kind">Información oficial del activo</h3>
      <div className="asset-card-title">
        <h4>{asset.name}</h4>
        <span className={`asset-status asset-status-${asset.status.toLowerCase()}`}>{asset.status}</span>
      </div>
      <dl>
        <div><dt>ID</dt><dd>{asset.assetId}</dd></div>
        <div><dt>Tipo</dt><dd>{asset.assetType.replaceAll("_", " ")}</dd></div>
        <div><dt>Versión</dt><dd>{asset.version}</dd></div>
        <div><dt>Creado</dt><dd>{new Date(asset.createdAt).toLocaleString("es-ES", { timeZone: "UTC" })} UTC</dd></div>
      </dl>
    </article>
  );
}

function TechnicalStatePanel({
  state,
  error,
  loading,
  refreshing,
  onRefresh,
}: Readonly<{
  state?: TechnicalState;
  error: Error | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}>) {
  return (
    <section className="technical-state" aria-labelledby="technical-state-title">
      <header className="technical-state-heading">
        <div>
          <p className="sequence">Collector / observación</p>
          <h3 id="technical-state-title">Información técnica observada</h3>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading || refreshing}>
          {refreshing ? "Actualizando..." : "Actualizar información técnica"}
        </button>
      </header>
      {error && <p className="form-error" role="alert">{technicalErrorMessage(error)}</p>}
      <div aria-live="polite">
        {loading && <p className="result-status">Consultando información técnica observada...</p>}
        {!loading && !error && state?.latestObservation === null && (
          <p className="technical-empty">Aún no hay información técnica observada para este activo.</p>
        )}
        {!loading && !error && state?.latestObservation && (
          <TechnicalObservationCard state={state} />
        )}
      </div>
    </section>
  );
}

function TechnicalObservationCard({ state }: Readonly<{ state: TechnicalState }>) {
  const observation = state.latestObservation!;
  return (
    <article className="technical-card" aria-label="Última observación técnica">
      <dl className="technical-facts">
        <div><dt>Hostname observado</dt><dd>{observation.hostname}</dd></div>
        <div><dt>Sistema operativo</dt><dd>{observation.operatingSystem.name} {observation.operatingSystem.version} ({observation.operatingSystem.family})</dd></div>
        <div><dt>Arquitectura</dt><dd>{observation.architecture}</dd></div>
        <div><dt>CPU lógicas</dt><dd>{observation.logicalCpuCount}</dd></div>
        <div><dt>Memoria total</dt><dd>{formatBytes(observation.memoryBytes)}</dd></div>
        <div><dt>Último contacto</dt><dd>{formatUtc(state.lastSeenAt)}</dd></div>
        <div><dt>Último snapshot</dt><dd>{formatUtc(state.lastSnapshotAt)}</dd></div>
        <div><dt>Capturado</dt><dd>{formatUtc(observation.capturedAt)}</dd></div>
        <div><dt>ID del snapshot</dt><dd>{observation.snapshotId}</dd></div>
      </dl>
      <div className="storage-observations">
        <h4>Almacenamiento observado</h4>
        <ul>
          {observation.storageVolumes.map((volume, index) => (
            <li key={`${volume.name}-${volume.totalBytes}-${index}`}>
              <strong>{volume.name}</strong>
              <span>{formatBytes(volume.availableBytes)} disponibles de {formatBytes(volume.totalBytes)}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function formatUtc(value: string | null) {
  return value ? `${new Date(value).toLocaleString("es-ES", { timeZone: "UTC" })} UTC` : "Sin datos";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount.toLocaleString("es-ES", { maximumFractionDigits: 1 })} ${unit}`;
}

function technicalErrorMessage(error: Error | null) {
  if (error instanceof ApiError && error.status === 403) {
    return "La sesión no autoriza consultar la información técnica observada.";
  }
  if (error instanceof ApiError && error.status === 404) {
    return "El activo ya no está disponible. Vuelve a consultar su ficha oficial.";
  }
  return "No fue posible consultar la información técnica observada. El servicio no está disponible.";
}

function errorMessage(error: Error | null, action: "crear" | "consultar") {
  if (!(error instanceof ApiError)) {
    return `No fue posible ${action} el activo. El servicio no está disponible.`;
  }
  if (error.status === 403) {
    return "La sesión no autoriza esta operación.";
  }
  if (error.status === 404) {
    return "No existe un activo con ese identificador.";
  }
  if (error.status === 400 || error.status === 422) {
    return "Revisa los datos del activo e inténtalo de nuevo.";
  }
  if (error.status === 409) {
    return "El activo entra en conflicto con el estado actual. Vuelve a consultar antes de continuar.";
  }
  return `No fue posible ${action} el activo. El servicio no está disponible.`;
}
