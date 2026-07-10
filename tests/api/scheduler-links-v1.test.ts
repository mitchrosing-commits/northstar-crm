import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPublicSchedulerUrl } from "@/lib/public-url";
import { redactSensitiveText } from "@/lib/security/redaction";
import { generatePublicSchedulerToken } from "@/lib/services/scheduler-service";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const service = readFileSync(join(process.cwd(), "lib/services/scheduler-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const adminPage = readFileSync(join(process.cwd(), "app/scheduler/page.tsx"), "utf8");
const detailPage = readFileSync(join(process.cwd(), "app/scheduler/[schedulerLinkId]/page.tsx"), "utf8");
const adminActions = readFileSync(join(process.cwd(), "app/scheduler/actions.ts"), "utf8");
const publicPage = readFileSync(join(process.cwd(), "app/s/[token]/page.tsx"), "utf8");
const publicActions = readFileSync(join(process.cwd(), "app/s/[token]/actions.ts"), "utf8");
const linkControls = readFileSync(join(process.cwd(), "components/scheduler-public-link-controls.tsx"), "utf8");
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("scheduler links v1", () => {
  it("adds a workspace-scoped scheduler schema with booking-to-activity linkage", () => {
    expect(schema).toContain("model SchedulerLink");
    expect(schema).toContain("model SchedulerBooking");
    expect(schema).toContain("schedulerLinks              SchedulerLink[]");
    expect(schema).toContain("schedulerBookings           SchedulerBooking[]");
    expect(schema).toContain("createdSchedulerLinks    SchedulerLink[]");
    expect(schema).toContain("token                String             @unique");
    expect(schema).toContain("availability         Json");
    expect(schema).toContain("activityId      String?");
    expect(schema).toContain("@@index([workspaceId, schedulerLinkId, requestedAt])");
    expect(schema).toContain("@@index([workspaceId, fingerprint, requestedAt])");
  });

  it("keeps scheduler behavior conservative and service-backed", () => {
    expect(crmBarrel).toContain('export * from "./scheduler-service"');
    expect(service).toContain("export async function createSchedulerLink");
    expect(service).toContain("export async function listSchedulerLinks");
    expect(service).toContain("export async function getSchedulerLinkReview");
    expect(service).toContain("export async function getPublicSchedulerLinkByToken");
    expect(service).toContain("export async function submitPublicSchedulerBooking");
    expect(service).toContain("ActivityType.MEETING");
    expect(service).toContain("tx.activity.create");
    expect(service).toContain("tx.schedulerBooking.create");
    expect(service).toContain("findExactContactByEmail");
    expect(service).toContain("honeypotFilled");
    expect(service).toContain("DUPLICATE_WINDOW_MS");
    expect(service).toContain("Northstar-configured availability");
    expect(service).not.toContain("tx.contact.create");
    expect(service).not.toContain("tx.person.create");
    expect(service).not.toContain("tx.organization.create");
    expect(service).not.toContain("tx.deal.create");
    expect(service).not.toContain("sendEmail");
    expect(service).not.toContain("google");
    expect(service).not.toContain("outlook");
  });

  it("exposes internal scheduler admin and review pages without table token leakage", () => {
    expect(navigation).toContain('href: "/scheduler" as Route');
    expect(navigation).toContain('label: "Scheduler"');
    expect(navigation).toContain('helper: "Booking links"');
    expect(adminPage).toContain("export default async function SchedulerPage");
    expect(adminPage).toContain("createSchedulerLinkAction");
    expect(adminPage).toContain("setSchedulerLinkEnabledAction");
    expect(adminPage).toContain("SchedulerPublicLinkControls");
    expect(adminPage).toContain("buildPublicSchedulerUrl");
    expect(adminPage).toContain("No scheduling links yet");
    expect(adminPage).toContain("No bookings");
    expect(detailPage).toContain("export default async function SchedulerLinkReviewPage");
    expect(detailPage).toContain("getSchedulerLinkReview");
    expect(detailPage).toContain("Recent Booking Requests");
    expect(detailPage).toContain("Accepted bookings");
    expect(detailPage).toContain("No booking requests yet");
    expect(detailPage).toContain('href={`/activities/${booking.activity.id}/edit` as Route}');
    expect(detailPage).toContain("notFound()");
    expect(detailPage).not.toContain("website");
    expect(adminActions).toContain("createSchedulerLink(actor");
    expect(adminActions).toContain("updateSchedulerLink(actor");
    expect(linkControls).toContain("navigator.clipboard.writeText(publicUrl)");
  });

  it("adds a public no-chrome scheduler route with safe unavailable and confirmation states", () => {
    expect(publicPage).toContain("export default async function PublicSchedulerPage");
    expect(publicPage).toContain("getPublicSchedulerLinkByToken");
    expect(publicPage).toContain("submitPublicSchedulerBookingAction");
    expect(publicPage).toContain('className="web-form-honeypot"');
    expect(publicPage).toContain("robots:");
    expect(publicPage).toContain("Scheduling unavailable");
    expect(publicPage).toContain("Your booking request was received.");
    expect(publicPage).toContain("Northstar-configured availability");
    expect(publicPage).not.toContain("AppShell");
    expect(publicPage).not.toContain("PrimaryNav");
    expect(publicActions).toContain("submitPublicSchedulerBooking(token");
    expect(publicActions).toContain("?booked=1");
    expect(publicActions).toContain("?error=validation");
    expect(globalStyles).toContain(".scheduler-public-times");
    expect(globalStyles).toContain(".scheduler-availability-grid");
  });

  it("generates and redacts public scheduler links safely", () => {
    const token = generatePublicSchedulerToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(buildPublicSchedulerUrl("abc123", "https://crm.example.test")).toBe("https://crm.example.test/s/abc123");
    expect(
      buildPublicSchedulerUrl("abc123", "http://crm.example.test", {
        NODE_ENV: "production"
      })
    ).toBe("/s/abc123");

    const redacted = redactSensitiveText(
      `Public scheduler failed at https://crm.example.test/s/${token} and /s/${token}`
    );
    expect(redacted).toBe("Public scheduler failed at https://crm.example.test/s/[redacted] and /s/[redacted]");
    expect(redacted).not.toContain(token);
  });
});
