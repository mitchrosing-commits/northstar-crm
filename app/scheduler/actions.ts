"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { createSchedulerLink, updateSchedulerLink } from "@/lib/services/crm";

const schedulerWeekdays = [0, 1, 2, 3, 4, 5, 6] as const;

export async function createSchedulerLinkAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  await createSchedulerLink(actor, {
    name: String(formData.get("name") ?? ""),
    meetingTitle: String(formData.get("meetingTitle") ?? ""),
    description: String(formData.get("description") ?? ""),
    durationMinutes: String(formData.get("durationMinutes") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    minimumNoticeMinutes: String(formData.get("minimumNoticeMinutes") ?? ""),
    availability: schedulerAvailabilityFromFormData(formData)
  });

  revalidatePath("/scheduler");
  redirect("/scheduler?created=1" as Route);
}

export async function updateSchedulerLinkAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const schedulerLinkId = String(formData.get("schedulerLinkId") ?? "");
  await updateSchedulerLink(actor, schedulerLinkId, {
    name: String(formData.get("name") ?? ""),
    meetingTitle: String(formData.get("meetingTitle") ?? ""),
    description: String(formData.get("description") ?? ""),
    durationMinutes: String(formData.get("durationMinutes") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    minimumNoticeMinutes: String(formData.get("minimumNoticeMinutes") ?? ""),
    availability: schedulerAvailabilityFromFormData(formData),
    isEnabled: formData.get("isEnabled") === "on"
  });

  revalidatePath("/scheduler");
  revalidatePath(`/scheduler/${schedulerLinkId}`);
  redirect(`/scheduler/${schedulerLinkId}?updated=1` as Route);
}

export async function setSchedulerLinkEnabledAction(formData: FormData) {
  const { actor } = await getCurrentWorkspaceContext();
  const schedulerLinkId = String(formData.get("schedulerLinkId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";

  await updateSchedulerLink(actor, schedulerLinkId, { isEnabled: enabled });
  revalidatePath("/scheduler");
  revalidatePath(`/scheduler/${schedulerLinkId}`);
  redirect(`/scheduler?${enabled ? "enabled" : "disabled"}=1` as Route);
}

function schedulerAvailabilityFromFormData(formData: FormData) {
  return schedulerWeekdays
    .filter((weekday) => formData.get(`availability-${weekday}-enabled`) === "on")
    .map((weekday) => ({
      weekday,
      start: String(formData.get(`availability-${weekday}-start`) ?? ""),
      end: String(formData.get(`availability-${weekday}-end`) ?? "")
    }));
}
