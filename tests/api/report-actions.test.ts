import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/responses";

const mocks = vi.hoisted(() => ({
  createOrUpdateMonthlyWonRevenueGoal: vi.fn(),
  getCurrentWorkspaceContext: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/lib/auth/request-context", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext
}));

vi.mock("@/lib/services/crm", () => ({
  createOrUpdateMonthlyWonRevenueGoal: mocks.createOrUpdateMonthlyWonRevenueGoal
}));

import { saveMonthlyWonRevenueGoalAction } from "@/app/reports/actions";

const actor = { workspaceId: "workspace_1", actorUserId: "user_1" };

function redirectError(url: string) {
  return Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT", url });
}

function goalForm({
  currency = " usd ",
  month = "2030-03",
  targetAmount = "$12,345.67"
} = {}) {
  const formData = new FormData();
  formData.set("goalMonth", month);
  formData.set("goalCurrency", currency);
  formData.set("goalTargetAmount", targetAmount);
  return formData;
}

async function expectRedirectUrl(action: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ digest: "NEXT_REDIRECT" });
  return (caught as { url: string }).url;
}

function parseRedirect(url: string) {
  return new URL(url, "https://northstar.test");
}

describe("reports server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
  });

  it("saves a monthly won-revenue goal, revalidates reports, and redirects with preserved filters", async () => {
    mocks.createOrUpdateMonthlyWonRevenueGoal.mockResolvedValue({ id: "goal_1" });

    const url = await expectRedirectUrl(() =>
      saveMonthlyWonRevenueGoalAction(goalForm())
    );

    expect(mocks.createOrUpdateMonthlyWonRevenueGoal).toHaveBeenCalledWith(actor, {
      month: "2030-03",
      currency: " usd ",
      targetCents: 1_234_567
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/reports");
    expect(url).toBe("/reports?goalMonth=2030-03&goalCurrency=USD&goalSaved=1");
  });

  it("rejects malformed money before writing and keeps the user on the selected goal month", async () => {
    const url = parseRedirect(
      await expectRedirectUrl(() =>
        saveMonthlyWonRevenueGoalAction(
          goalForm({ month: "2030-04", currency: "eur", targetAmount: "12.345" })
        )
      )
    );

    expect(mocks.createOrUpdateMonthlyWonRevenueGoal).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/reports");
    expect(url.searchParams.get("goalMonth")).toBe("2030-04");
    expect(url.searchParams.get("goalCurrency")).toBe("EUR");
    expect(url.searchParams.get("goalError")).toBe("Goal target must be a positive currency amount.");
  });

  it("redacts sensitive ApiError messages before redirecting them back to the reports page", async () => {
    mocks.createOrUpdateMonthlyWonRevenueGoal.mockRejectedValue(
      new ApiError(
        "VALIDATION_ERROR",
        "Bad request for owner@example.test with token=raw-secret-token",
        422
      )
    );

    const url = parseRedirect(
      await expectRedirectUrl(() =>
        saveMonthlyWonRevenueGoalAction(goalForm({ targetAmount: "2500" }))
      )
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(url.searchParams.get("goalError")).toBe(
      "Bad request for [redacted email] with token=[redacted]"
    );
  });

  it("uses a generic error message for unexpected failures", async () => {
    mocks.createOrUpdateMonthlyWonRevenueGoal.mockRejectedValue(
      new Error("database token=raw-secret-token")
    );

    const url = parseRedirect(
      await expectRedirectUrl(() =>
        saveMonthlyWonRevenueGoalAction(goalForm({ targetAmount: "10" }))
      )
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(url.searchParams.get("goalError")).toBe("Goal target could not be saved.");
  });
});
