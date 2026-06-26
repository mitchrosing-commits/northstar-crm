"use server";

import { requestPasswordReset } from "@/lib/auth/password-reset";

export type ForgotPasswordActionState = {
  email: string;
  message?: string;
  resetUrl?: string;
};

export async function forgotPasswordAction(
  _previousState: ForgotPasswordActionState,
  formData: FormData
): Promise<ForgotPasswordActionState> {
  const email = String(formData.get("email") ?? "");
  const result = await requestPasswordReset(email);

  return {
    email,
    message: result.message,
    resetUrl: result.resetToken ? `/reset-password?token=${encodeURIComponent(result.resetToken)}` : undefined
  };
}
