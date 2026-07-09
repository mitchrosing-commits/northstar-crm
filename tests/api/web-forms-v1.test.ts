import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPublicWebFormUrl } from "@/lib/public-url";
import { redactSensitiveText } from "@/lib/security/redaction";
import { generatePublicWebFormToken } from "@/lib/services/web-form-service";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const service = readFileSync(join(process.cwd(), "lib/services/web-form-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const adminPage = readFileSync(join(process.cwd(), "app/web-forms/page.tsx"), "utf8");
const adminActions = readFileSync(join(process.cwd(), "app/web-forms/actions.ts"), "utf8");
const publicPage = readFileSync(join(process.cwd(), "app/f/[token]/page.tsx"), "utf8");
const publicActions = readFileSync(join(process.cwd(), "app/f/[token]/actions.ts"), "utf8");
const linkControls = readFileSync(join(process.cwd(), "components/web-form-public-link-controls.tsx"), "utf8");
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("web forms lead capture v1", () => {
  it("adds a focused schema for public lead capture without exposing sequential ids", () => {
    expect(schema).toContain("model WebForm");
    expect(schema).toContain("model WebFormSubmission");
    expect(schema).toContain("token               String              @unique");
    expect(schema).toContain("requireLeadTitle    Boolean             @default(false)");
    expect(schema).toContain("fingerprint String");
    expect(schema).toContain("@@index([workspaceId, fingerprint, submittedAt])");
    expect(schema).toContain("webForms                    WebForm[]");
    expect(schema).toContain("webFormSubmissions          WebFormSubmission[]");
  });

  it("keeps lead capture behavior conservative and service-backed", () => {
    expect(crmBarrel).toContain('export * from "./web-form-service"');
    expect(service).toContain("export async function createWebForm");
    expect(service).toContain("export async function listWebForms");
    expect(service).toContain("export async function getPublicWebFormByToken");
    expect(service).toContain("export async function submitPublicWebForm");
    expect(service).toContain("tx.lead.create");
    expect(service).toContain("tx.note.create");
    expect(service).toContain("web_form.submission_received");
    expect(service).toContain("lead.created_from_web_form");
    expect(service).toContain("honeypotFilled");
    expect(service).toContain("DUPLICATE_WINDOW_MS");
    expect(service).not.toContain("tx.deal.create");
    expect(service).not.toContain("createDeal");
    expect(service).not.toContain("sendEmail");
    expect(service).not.toContain("gmail.metadata");
  });

  it("exposes an internal Web Forms admin page and navigation item", () => {
    expect(navigation).toContain('href: "/web-forms" as Route');
    expect(navigation).toContain('label: "Web Forms"');
    expect(navigation).toContain('helper: "Lead capture"');
    expect(adminPage).toContain("export default async function WebFormsPage");
    expect(adminPage).toContain("createWebFormAction");
    expect(adminPage).toContain("setWebFormEnabledAction");
    expect(adminPage).toContain("WebFormPublicLinkControls");
    expect(adminPage).toContain("buildPublicWebFormUrl");
    expect(adminActions).toContain("createWebForm(actor");
    expect(adminActions).toContain("updateWebForm(actor");
    expect(linkControls).toContain("navigator.clipboard.writeText(publicUrl)");
  });

  it("adds a public no-chrome form route with honeypot and safe states", () => {
    expect(publicPage).toContain("export default async function PublicWebFormPage");
    expect(publicPage).toContain("getPublicWebFormByToken");
    expect(publicPage).toContain("submitPublicWebFormAction");
    expect(publicPage).toContain('className="web-form-honeypot"');
    expect(publicPage).toContain('robots:');
    expect(publicPage).toContain("Form unavailable");
    expect(publicPage).toContain("Your request was received.");
    expect(publicPage).not.toContain("AppShell");
    expect(publicPage).not.toContain("PrimaryNav");
    expect(publicActions).toContain("submitPublicWebForm(token");
    expect(publicActions).toContain("?submitted=1");
    expect(publicActions).toContain("?error=validation");
    expect(globalStyles).toContain(".public-form-page");
    expect(globalStyles).toContain(".web-form-honeypot");
  });

  it("generates and redacts public form links safely", () => {
    const token = generatePublicWebFormToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(buildPublicWebFormUrl("abc123", "https://crm.example.test")).toBe("https://crm.example.test/f/abc123");
    expect(
      buildPublicWebFormUrl("abc123", "http://crm.example.test", {
        NODE_ENV: "production"
      })
    ).toBe("/f/abc123");

    const redacted = redactSensitiveText(
      `Public form failed at https://crm.example.test/f/${token} and /f/${token}`
    );
    expect(redacted).toBe("Public form failed at https://crm.example.test/f/[redacted] and /f/[redacted]");
    expect(redacted).not.toContain(token);
  });
});
