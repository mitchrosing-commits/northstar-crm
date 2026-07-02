"use server";

import { revalidatePath } from "next/cache";

import { ApiError } from "@/lib/api/responses";
import { getRequestContext } from "@/lib/auth/request-context";
import { updateCurrentUserDisplayName } from "@/lib/auth/account";
import { redactSensitiveText } from "@/lib/security/redaction";

export type AccountSettingsActionState = {
  name: string;
  error?: string;
  message?: string;
};

export async function updateAccountDisplayNameAction(
  _previousState: AccountSettingsActionState,
  formData: FormData
): Promise<AccountSettingsActionState> {
  const name = String(formData.get("name") ?? "");

  try {
    const { actorUserId } = await getRequestContext();
    const user = await updateCurrentUserDisplayName(actorUserId, name);
    revalidatePath("/settings");

    return {
      name: user.name ?? "",
      message: "Display name updated."
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { name, error: "A signed-in user is required to update account settings." };
    }

    if (error instanceof ApiError) {
      return { name, error: redactSensitiveText(error.message) };
    }

    return { name, error: "Account settings could not be updated." };
  }
}
