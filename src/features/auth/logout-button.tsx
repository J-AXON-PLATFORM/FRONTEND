"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ApiError, logout } from "./api";

export function LogoutButton({ csrfToken }: Readonly<{ csrfToken: string }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => logout(csrfToken),
    retry: false,
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      router.replace("/login");
    },
  });
  const sessionExpired = mutation.error instanceof ApiError && mutation.error.status === 401;

  return (
    <div className="logout-control">
      <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? "Cerrando sesión..." : "Cerrar sesión"}
      </button>
      {mutation.isError && (
        <p className="header-error" role="alert">
          {sessionExpired
            ? "La sesión ya no es válida. Recarga la página para volver al acceso."
            : "No fue posible cerrar la sesión. La sesión local se conserva para evitar un cierre incompleto."}
        </p>
      )}
    </div>
  );
}
