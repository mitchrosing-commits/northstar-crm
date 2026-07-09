"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { ApiError } from "@/lib/api/responses";
import { submitPublicWebForm } from "@/lib/services/crm";

export async function submitPublicWebFormAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const redirectToken = encodeURIComponent(token);

  try {
    await submitPublicWebForm(token, {
      leadTitle: String(formData.get("leadTitle") ?? ""),
      personName: String(formData.get("personName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      organizationName: String(formData.get("organizationName") ?? ""),
      message: String(formData.get("message") ?? ""),
      website: String(formData.get("website") ?? "")
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      redirect(`/f/${redirectToken}?unavailable=1` as Route);
    }
    if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
      redirect(`/f/${redirectToken}?error=validation` as Route);
    }
    throw error;
  }

  redirect(`/f/${redirectToken}?submitted=1` as Route);
}
