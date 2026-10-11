"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, login } from "./api";

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: (session) => {
      queryClient.setQueryData(["authentication", "session"], session);
      setPassword("");
      router.replace("/");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  const error = mutation.error instanceof ApiError ? mutation.error : undefined;
  const message = error?.status === 429
    ? "Demasiados intentos. Espera antes de volver a intentarlo."
    : error?.status === 400 || error?.status === 401
      ? "No fue posible iniciar sesión. Revisa tus credenciales."
      : mutation.isError
        ? "El servicio no está disponible. Inténtalo de nuevo más tarde."
      : null;

  return (
    <form className="login-form" onSubmit={submit} aria-describedby={message ? "login-error" : undefined}>
      <div className="field">
        <label htmlFor="username">Usuario</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          maxLength={128}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {message && <p className="form-error" id="login-error" role="alert">{message}</p>}
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Verificando..." : "Iniciar sesión"}
      </button>
    </form>
  );
}
