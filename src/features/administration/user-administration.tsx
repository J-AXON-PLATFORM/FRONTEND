"use client";

import { ApiError, type Session } from "@/features/auth/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createHumanUser, HUMAN_ROLES, type HumanRole, type HumanUser } from "./api";

const ROLE_LABELS: Record<HumanRole, string> = {
  SYSTEM_ADMIN: "Administración del sistema",
  IT_OPERATOR: "Operación de TI",
  SUPPORT_TECHNICIAN: "Atención técnica",
  END_USER: "Usuario final",
  AUDITOR: "Auditoría",
};

export function UserAdministration({ session }: Readonly<{ session: Session }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<HumanRole[]>([]);
  const [createdUser, setCreatedUser] = useState<HumanUser>();
  const [selectionError, setSelectionError] = useState(false);
  const creation = useMutation({
    mutationFn: () => createHumanUser(username, password, [...roles].sort(), session.csrfToken),
    retry: false,
    onSuccess: (user) => {
      setCreatedUser(user);
      setUsername("");
      setPassword("");
      setRoles([]);
      setSelectionError(false);
    },
  });

  useEffect(() => {
    if (creation.error instanceof ApiError && creation.error.status === 401) {
      queryClient.clear();
      router.replace("/login");
    }
  }, [creation.error, queryClient, router]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (roles.length === 0) {
      setSelectionError(true);
      return;
    }
    setSelectionError(false);
    creation.mutate();
  }

  function toggleRole(role: HumanRole) {
    setRoles((current) => current.includes(role)
      ? current.filter((candidate) => candidate !== role)
      : [...current, role]);
  }

  return (
    <section className="administration-workspace" aria-labelledby="administration-title">
      <header className="workspace-heading">
        <div>
          <p className="sequence">Identity / administración</p>
          <h2 id="administration-title">Usuarios humanos</h2>
        </div>
        <p>Alta explícita de cuentas locales. Sin listado, edición, deshabilitación ni reset.</p>
      </header>
      <div className="administration-grid">
        <form className="user-form" onSubmit={submit} aria-describedby={creation.isError ? "user-create-error" : undefined}>
          <div className="field">
            <label htmlFor="new-username">Usuario</label>
            <input
              id="new-username"
              autoComplete="off"
              maxLength={128}
              required
              disabled={creation.isPending}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">Contraseña inicial</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={256}
              required
              disabled={creation.isPending}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <span className="field-help">Entre 15 y 256 caracteres; no se conserva tras el alta.</span>
          </div>
          <fieldset className="role-selector" disabled={creation.isPending} aria-describedby={selectionError ? "role-selection-error" : undefined}>
            <legend>Roles explícitos</legend>
            {HUMAN_ROLES.map((role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={() => toggleRole(role)}
                />
                <span>{ROLE_LABELS[role]}<small>{role}</small></span>
              </label>
            ))}
          </fieldset>
          {selectionError && <p className="form-error" id="role-selection-error" role="alert">Selecciona al menos un rol.</p>}
          {creation.isError && <p className="form-error" id="user-create-error" role="alert">{errorMessage(creation.error)}</p>}
          <button type="submit" disabled={creation.isPending}>
            {creation.isPending ? "Creando usuario..." : "Crear usuario"}
          </button>
        </form>
        <div className="user-result" aria-live="polite">
          {createdUser ? <UserCard user={createdUser} /> : (
            <p className="administration-empty">La cuenta creada aparecerá aquí sin exponer su contraseña.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function UserCard({ user }: Readonly<{ user: HumanUser }>) {
  return (
    <article className="user-card" aria-label="Usuario creado">
      <p className="sequence">Cuenta activa</p>
      <div className="user-card-title">
        <h3>{user.username}</h3>
        <span>{user.status}</span>
      </div>
      <dl>
        <div><dt>ID</dt><dd>{user.userId}</dd></div>
        <div><dt>Creado</dt><dd>{new Date(user.createdAt).toLocaleString("es-ES", { timeZone: "UTC" })} UTC</dd></div>
        <div><dt>Roles</dt><dd>{user.roles.join(", ")}</dd></div>
      </dl>
    </article>
  );
}

function errorMessage(error: Error | null) {
  if (!(error instanceof ApiError)) return "No fue posible crear el usuario. El servicio no está disponible.";
  if (error.status === 401) return "La sesión ya no es válida.";
  if (error.status === 403) return "La sesión no autoriza crear usuarios.";
  if (error.status === 409) return "Ya existe un usuario con ese nombre normalizado.";
  if (error.status === 400 || error.status === 422) return "Revisa el usuario, la contraseña inicial y los roles seleccionados.";
  return "No fue posible crear el usuario. El servicio no está disponible.";
}
