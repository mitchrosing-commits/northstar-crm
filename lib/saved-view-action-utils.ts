import { ApiError } from "@/lib/api/responses";

export async function ignoreMissingSavedView(callback: () => Promise<unknown>) {
  try {
    await callback();
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return;
    throw error;
  }
}
