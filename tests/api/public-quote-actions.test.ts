import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/responses";

const publicQuotePage = readFileSync(join(process.cwd(), "app/q/[token]/page.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

const mocks = vi.hoisted(() => ({
  acceptPublicQuoteByToken: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect
}));

vi.mock("@/lib/services/crm", () => ({
  acceptPublicQuoteByToken: mocks.acceptPublicQuoteByToken
}));

import { acceptPublicQuoteAction } from "@/app/q/[token]/actions";

function formData(token: string) {
  const data = new FormData();
  data.set("token", token);
  return data;
}

function redirectError(url: string) {
  return Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT", url });
}

function notFoundError() {
  return Object.assign(new Error("not found"), { digest: "NEXT_NOT_FOUND" });
}

describe("public quote actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
    mocks.notFound.mockImplementation(() => {
      throw notFoundError();
    });
  });

  it("accepts a public quote token and redirects to the accepted confirmation", async () => {
    const token = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890";
    mocks.acceptPublicQuoteByToken.mockResolvedValue({
      accepted: true,
      alreadyAccepted: false,
      quote: { id: "quote_1" }
    });

    await expect(acceptPublicQuoteAction(formData(token))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: `/q/${token}?accepted=1`
    });

    expect(mocks.acceptPublicQuoteByToken).toHaveBeenCalledWith(token);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("encodes accepted-confirmation redirects from submitted tokens", async () => {
    const token = "abc/../settings?x=1";
    mocks.acceptPublicQuoteByToken.mockResolvedValue({
      accepted: true,
      alreadyAccepted: false,
      quote: { id: "quote_1" }
    });

    await expect(acceptPublicQuoteAction(formData(token))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/q/abc%2F..%2Fsettings%3Fx%3D1?accepted=1"
    });

    expect(mocks.acceptPublicQuoteByToken).toHaveBeenCalledWith(token);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("encodes unavailable-acceptance redirects from submitted tokens", async () => {
    const token = "abc/../settings?x=1";
    mocks.acceptPublicQuoteByToken.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Only sent quotes can be accepted from a public link.", 422)
    );

    await expect(acceptPublicQuoteAction(formData(token))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/q/abc%2F..%2Fsettings%3Fx%3D1?acceptance=unavailable"
    });

    expect(mocks.acceptPublicQuoteByToken).toHaveBeenCalledWith(token);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("routes closed-deal public acceptance attempts back to the quote with an unavailable state", async () => {
    const token = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890";
    mocks.acceptPublicQuoteByToken.mockRejectedValue(new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409));

    await expect(acceptPublicQuoteAction(formData(token))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: `/q/${token}?acceptance=unavailable`
    });

    expect(mocks.acceptPublicQuoteByToken).toHaveBeenCalledWith(token);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("uses the not-found boundary for missing or revoked public quote tokens", async () => {
    const token = "missing-token";
    mocks.acceptPublicQuoteByToken.mockRejectedValue(new ApiError("NOT_FOUND", "Quote was not found.", 404));

    await expect(acceptPublicQuoteAction(formData(token))).rejects.toMatchObject({
      digest: "NEXT_NOT_FOUND"
    });

    expect(mocks.acceptPublicQuoteByToken).toHaveBeenCalledWith(token);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("labels the public quote acceptance action with quote context", () => {
    expect(publicQuotePage).toContain("const acceptQuoteLabel = `Accept quote ${quote.number}`");
    expect(publicQuotePage).toContain("aria-label={acceptQuoteLabel}");
    expect(publicQuotePage).toContain("title={acceptQuoteLabel}");
  });

  it("shows accepted redirect confirmation only when the accepted status is persisted", () => {
    expect(publicQuotePage).toContain('searchParams?: Promise<{ acceptance?: string; accepted?: string }>');
    expect(publicQuotePage).toContain('const acceptedRedirectConfirmed = query?.accepted === "1" && showAcceptedConfirmation');
    expect(publicQuotePage).toContain("FormSuccessMessage");
    expect(publicQuotePage).toContain("Quote acceptance recorded.");
  });

  it("keeps the public quote table readable on narrow screens", () => {
    expect(publicQuotePage).toContain('className="table quote-print-table"');
    expect(publicQuotePage).toContain("<TableScroll");
    for (const dataLabel of ["Item", "Qty", "Unit price", "Total"]) {
      expect(publicQuotePage).toContain(`data-label="${dataLabel}"`);
    }
    expect(globalStyles).toContain(".quote-print-table td::before");
    expect(globalStyles).toContain('content: attr(data-label)');
    expect(globalStyles).toContain(".quote-print-header > *");
    expect(globalStyles).toContain(".quote-print-context > *");
    expect(globalStyles).toContain(".quote-print-totals > *");
  });
});
