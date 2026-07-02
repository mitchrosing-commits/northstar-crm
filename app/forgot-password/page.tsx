import { AuthPanel } from "@/components/auth-panel";

import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <AuthPanel
      description="Enter your workspace account email. The response is the same whether or not an account exists."
      title="Reset password"
    >
      <ForgotPasswordForm />
    </AuthPanel>
  );
}
