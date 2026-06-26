import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="page-kicker">Northstar CRM</p>
        <h1 className="page-title">Reset password</h1>
        <p className="empty-copy">
          Enter your workspace account email. The response is the same whether or not an account exists.
        </p>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
