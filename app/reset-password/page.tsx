import Link from "next/link";

import {
  getPasswordResetTokenStatus,
  invalidPasswordResetTokenMessage,
  minimumResetPasswordLength
} from "@/lib/auth/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token = "" } = await searchParams;
  const status = await getPasswordResetTokenStatus(token);

  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="page-kicker">Northstar CRM</p>
        <h1 className="page-title">Set new password</h1>
        {status === "valid" ? (
          <>
            <p className="empty-copy">Choose a new password for your existing workspace account.</p>
            <ResetPasswordForm minimumPasswordLength={minimumResetPasswordLength} token={token} />
          </>
        ) : (
          <>
            <p className="form-error">{invalidPasswordResetTokenMessage}</p>
            <p className="empty-copy">
              <Link href="/forgot-password">Request a new reset link</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
