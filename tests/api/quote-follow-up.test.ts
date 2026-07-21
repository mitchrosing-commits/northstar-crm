import { describe, expect, it } from "vitest";

import { buildQuoteFollowUpHref, quoteFollowUpStatus, quoteHasSimilarOpenFollowUp } from "@/lib/quote-follow-up";

const baseQuote = {
  id: "quote_1",
  number: "Q-1042",
  status: "SENT",
  dealId: "deal_1",
  deal: {
    title: "Expansion package",
    activities: []
  },
  dealValueSyncConflict: null,
  dealValueSyncReviewedAt: null,
  dealValueSyncedAt: null
};

describe("quote follow-up drafting", () => {
  it("builds an activity draft link with deal attachment, quote context, and return filter", () => {
    const href = buildQuoteFollowUpHref(baseQuote, {
      event: "quote.public_link_created",
      historyFilter: "public-link",
      returnHash: "quote-timeline-event-1"
    });
    const url = new URL(href, "https://northstar.test");

    expect(url.pathname).toBe("/activities/new");
    expect(url.searchParams.get("related")).toBe("deal:deal_1");
    expect(url.searchParams.get("title")).toBe("Follow up on public quote link");
    expect(url.searchParams.get("type")).toBe("EMAIL");
    expect(url.searchParams.get("quoteNumber")).toBe("Q-1042");
    expect(url.searchParams.get("quoteContext")).toBe("Public quote link was generated");
    expect(url.searchParams.get("quoteEvent")).toBe("quote.public_link_created");
    expect(url.searchParams.get("returnTo")).toBe("/deals/deal_1/quotes/quote_1?history=public-link#quote-timeline-event-1");
    expect(href).not.toContain("token");
  });

  it("can return a quote follow-up draft to a deal quote section", () => {
    const href = buildQuoteFollowUpHref(baseQuote, {
      returnTo: "/deals/deal_1#quotes"
    });
    const url = new URL(href, "https://northstar.test");

    expect(url.searchParams.get("returnTo")).toBe("/deals/deal_1#quotes");
    expect(url.searchParams.get("related")).toBe("deal:deal_1");
    expect(url.searchParams.get("quoteNumber")).toBe("Q-1042");
  });

  it("suggests conflict, declined, accepted, and sent follow-up copy", () => {
    expect(
      new URL(
        buildQuoteFollowUpHref({
          ...baseQuote,
          status: "ACCEPTED",
          dealValueSyncConflict: "Deal value changed after this quote was sent."
        }),
        "https://northstar.test"
      ).searchParams.get("title")
    ).toBe("Resolve accepted quote value conflict");
    expect(new URL(buildQuoteFollowUpHref({ ...baseQuote, status: "DECLINED" }), "https://northstar.test").searchParams.get("title")).toBe(
      "Review declined quote with customer"
    );
    expect(new URL(buildQuoteFollowUpHref({ ...baseQuote, status: "ACCEPTED" }), "https://northstar.test").searchParams.get("title")).toBe(
      "Confirm next steps after quote acceptance"
    );
    expect(new URL(buildQuoteFollowUpHref(baseQuote), "https://northstar.test").searchParams.get("title")).toBe("Follow up on sent quote");
  });

  it("derives conservative quote follow-up states from existing deal activities", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    expect(quoteFollowUpStatus(baseQuote, now)).toMatchObject({ label: "No open quote follow-up", tone: "warning" });
    expect(
      quoteFollowUpStatus(
        {
          ...baseQuote,
          deal: {
            title: "Expansion package",
            activities: [{ id: "a1", title: "Follow up on Q-1042", dueAt: "2026-07-14T00:00:00.000Z", completedAt: null }]
          }
        },
        now
      )
    ).toMatchObject({ label: "Follow-up scheduled", tone: "success" });
    expect(
      quoteFollowUpStatus(
        {
          ...baseQuote,
          deal: {
            title: "Expansion package",
            activities: [{ id: "a1", title: "Follow up on Q-1042", dueAt: "2026-07-12T00:00:00.000Z", completedAt: null }]
          }
        },
        now
      )
    ).toMatchObject({ label: "Follow-up overdue", tone: "warning" });
    expect(
      quoteFollowUpStatus(
        {
          ...baseQuote,
          deal: {
            title: "Expansion package",
            activities: [{ id: "a1", title: "Follow up on Q-1042", dueAt: "2026-07-12T00:00:00.000Z", completedAt: "2026-07-12T10:00:00.000Z" }]
          }
        },
        now
      )
    ).toMatchObject({ label: "Follow-up completed", tone: "muted" });
  });

  it("warns only for open activities that mention the quote number", () => {
    expect(
      quoteHasSimilarOpenFollowUp({
        ...baseQuote,
        deal: {
          title: "Expansion package",
          activities: [
            { id: "a1", title: "General deal task", dueAt: null, completedAt: null },
            { id: "a2", title: "Completed Q-1042 task", dueAt: null, completedAt: "2026-07-13T10:00:00.000Z" }
          ]
        }
      })
    ).toBe(false);
    expect(
      quoteHasSimilarOpenFollowUp({
        ...baseQuote,
        deal: {
          title: "Expansion package",
          activities: [{ id: "a1", title: "Call about Q-1042", dueAt: null, completedAt: null }]
        }
      })
    ).toBe(true);
  });
});
