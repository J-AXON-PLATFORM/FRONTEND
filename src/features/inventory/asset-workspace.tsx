"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  createAsset,
  getAsset,
  type Asset,
  type AssetStatus,
  type AssetType,
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
    queryKey: ["inventory", "asset", lookupId],
    queryFn: () => getAsset(lookupId),
    enabled: UUID_V4.test(lookupId),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  });
  const authenticationError = [creation.error, lookup.error]
    .find((error) => error instanceof ApiError && error.status === 401);

  useEffect(() => {
    if (authenticationError) {
      queryClient.removeQueries();
      router.replace("/login");
    }
  }, [authenticationError, queryClient, router]);

  if (!session.roles.includes("IT_OPERATOR")) {
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
    void queryClient.invalidateQueries({ queryKey: ["inventory", "asset", candidate] });
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
    </section>
  );
}

function AssetCard({ asset, label }: Readonly<{ asset: Asset; label: string }>) {
  return (
    <article className="asset-card" aria-label={label}>
      <p className="sequence">{label}</p>
      <div className="asset-card-title">
        <h3>{asset.name}</h3>
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
