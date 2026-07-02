import Link from "next/link";

import { AuthPanel } from "@/components/auth-panel";
import { FormErrorMessage } from "@/components/form-error-message";
import {
  getPasswordResetTokenStatus,
  invalidPasswordResetTokenMessage,
  minimumResetPasswordLength
} from "@/lib/auth/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token = "" } = await searchParams;
  const status = await getPasswordResetTokenStatus(token);

  return (
    <AuthPanel title="Set new password">
      {status === "valid" ? (
        <>
          <p className="empty-copy">Choose a new password for your existing workspace account.</p>
          <ResetPasswordForm minimumPasswordLength={minimumResetPasswordLength} token={token} />
        </>
      ) : (
        <>
          <FormErrorMessage>{invalidPasswordResetTokenMessage}</FormErrorMessage>
          <p className="empty-copy">
            <Link href="/forgot-password">Request a new reset link</Link>
          </p>
        </>
      )}
    </AuthPanel>
  );
}
