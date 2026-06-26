"use server";

import { ApiError } from "@/lib/api/responses";
import { resetPasswordWithToken } from "@/lib/auth/password-reset";

export type ResetPasswordActionState = {
  error?: string;
  success?: boolean;
};

export async function resetPasswordAction(
  _previousState: ResetPasswordActionState,
  formData: FormData
): Promise<ResetPasswordActionState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    return { error: "Passwords must match." };
  }

  try {
    await resetPasswordWithToken(token, password);
  } catch (error) {
    return {
      error: error instanceof ApiError ? error.message : "Password reset failed."
    };
  }

  return { success: true };
}
