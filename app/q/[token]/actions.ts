"use server";

import { notFound, redirect } from "next/navigation";

import { ApiError } from "@/lib/api/responses";
import { acceptPublicQuoteByToken } from "@/lib/services/crm";

export async function acceptPublicQuoteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const redirectToken = encodeURIComponent(token);

  try {
    await acceptPublicQuoteByToken(token);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ApiError && (error.code === "VALIDATION_ERROR" || error.code === "DEAL_CLOSED")) {
      redirect(`/q/${redirectToken}?acceptance=unavailable`);
    }
    throw error;
  }

  redirect(`/q/${redirectToken}?accepted=1`);
}
