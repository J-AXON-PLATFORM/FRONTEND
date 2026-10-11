import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <section className="brand-panel" aria-label="J-AXON">
        <p className="eyebrow">Plataforma operativa</p>
        <p className="wordmark">J-AXON</p>
        <p className="brand-copy">Control técnico con identidad, trazabilidad y límites claros.</p>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <p className="sequence">01 / Acceso humano</p>
          <h1 id="login-title">Iniciar sesión</h1>
          <p className="intro">Usa la cuenta local autorizada para acceder al entorno.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
