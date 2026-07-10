"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { ApiError } from "@/lib/api/responses";
import { submitPublicSchedulerBooking } from "@/lib/services/crm";

export async function submitPublicSchedulerBookingAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const redirectToken = encodeURIComponent(token);

  try {
    await submitPublicSchedulerBooking(token, {
      startAt: String(formData.get("startAt") ?? ""),
      attendeeName: String(formData.get("attendeeName") ?? ""),
      attendeeEmail: String(formData.get("attendeeEmail") ?? ""),
      attendeeCompany: String(formData.get("attendeeCompany") ?? ""),
      attendeeNote: String(formData.get("attendeeNote") ?? ""),
      website: String(formData.get("website") ?? "")
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      redirect(`/s/${redirectToken}?unavailable=1` as Route);
    }
    if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
      redirect(`/s/${redirectToken}?error=validation` as Route);
    }
    throw error;
  }

  redirect(`/s/${redirectToken}?booked=1` as Route);
}
