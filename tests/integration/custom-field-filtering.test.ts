import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { listDeals } from "@/lib/services/crm";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | undefined;

beforeEach(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("custom field list filtering operators", () => {
  it("keeps exact custom field filtering backward compatible without an operator", async () => {
    const fx = currentFixture();
    const field = await createDealField(fx, "TEXT", "Priority Fit", "priority_fit");
    await createDealValue(fx, field.id, fx.recordsA.deal.id, "Enterprise High");
    await createDealValue(fx, field.id, fx.recordsB.deal.id, "Enterprise High", "B");

    const deals = await listDeals(fx.actorA, {
      customFieldId: field.id,
      customFieldValue: "Enterprise High"
    });

    expect(deals.map((deal) => deal.id)).toEqual([fx.recordsA.deal.id]);

    const blankOperatorDeals = await listDeals(fx.actorA, {
      customFieldId: field.id,
      customFieldOperator: "",
      customFieldValue: "Enterprise High"
    });

    expect(blankOperatorDeals.map((deal) => deal.id)).toEqual([fx.recordsA.deal.id]);
  });

  it("supports case-insensitive text contains and rejects contains for non-text fields", async () => {
    const fx = currentFixture();
    const textField = await createDealField(fx, "TEXT", "Decision Notes", "decision_notes");
    const numberField = await createDealField(fx, "NUMBER", "Fit Score", "fit_score");
    await createDealValue(fx, textField.id, fx.recordsA.deal.id, "Enterprise buying committee");
    await createDealValue(fx, numberField.id, fx.recordsA.deal.id, 10);

    await expect(
      listDeals(fx.actorA, {
        customFieldId: textField.id,
        customFieldOperator: "contains",
        customFieldValue: "BUYING"
      })
    ).resolves.toEqual([expect.objectContaining({ id: fx.recordsA.deal.id })]);

    await expect(
      listDeals(fx.actorA, {
        customFieldId: numberField.id,
        customFieldOperator: "contains",
        customFieldValue: "1"
      })
    ).resolves.toEqual([]);
  });

  it("matches empty and not-empty custom field values across missing, null, blank, and populated values", async () => {
    const fx = currentFixture();
    const field = await createDealField(fx, "TEXT", "Renewal Note", "renewal_note");
    const nullDeal = await createDeal(fx, "Null value deal");
    const blankDeal = await createDeal(fx, "Blank value deal");
    const missingDeal = await createDeal(fx, "Missing value deal");

    await createDealValue(fx, field.id, fx.recordsA.deal.id, "Populated");
    await createDealValue(fx, field.id, nullDeal.id, Prisma.JsonNull);
    await createDealValue(fx, field.id, blankDeal.id, "");

    const emptyDeals = await listDeals(fx.actorA, {
      customFieldId: field.id,
      customFieldOperator: "is_empty"
    });
    const notEmptyDeals = await listDeals(fx.actorA, {
      customFieldId: field.id,
      customFieldOperator: "is_not_empty"
    });

    expect(emptyDeals.map((deal) => deal.id).sort()).toEqual([blankDeal.id, missingDeal.id, nullDeal.id].sort());
    expect(notEmptyDeals.map((deal) => deal.id)).toEqual([fx.recordsA.deal.id]);
  });

  it("keeps zero and false values not-empty", async () => {
    const fx = currentFixture();
    const numberField = await createDealField(fx, "NUMBER", "Zero Score", "zero_score");
    const booleanField = await createDealField(fx, "BOOLEAN", "Decision Confirmed", "decision_confirmed");
    const dateField = await createDealField(fx, "DATE", "Target Date", "target_date");
    const falseDeal = await createDeal(fx, "False value deal");
    const dateDeal = await createDeal(fx, "Date value deal");
    await createDealValue(fx, numberField.id, fx.recordsA.deal.id, 0);
    await createDealValue(fx, booleanField.id, falseDeal.id, false);
    await createDealValue(fx, dateField.id, dateDeal.id, "2030-02-15");

    const numberMatches = await listDeals(fx.actorA, {
      customFieldId: numberField.id,
      customFieldOperator: "is_not_empty"
    });
    const booleanMatches = await listDeals(fx.actorA, {
      customFieldId: booleanField.id,
      customFieldOperator: "is_not_empty"
    });
    const dateMatches = await listDeals(fx.actorA, {
      customFieldId: dateField.id,
      customFieldOperator: "is_not_empty"
    });

    expect(numberMatches.map((deal) => deal.id)).toEqual([fx.recordsA.deal.id]);
    expect(booleanMatches.map((deal) => deal.id)).toEqual([falseDeal.id]);
    expect(dateMatches.map((deal) => deal.id)).toEqual([dateDeal.id]);
  });

  it("fails closed for invalid operators", async () => {
    const fx = currentFixture();
    const field = await createDealField(fx, "TEXT", "Invalid Operator Field", "invalid_operator_field");
    await createDealValue(fx, field.id, fx.recordsA.deal.id, "Visible only with valid filters");

    await expect(
      listDeals(fx.actorA, {
        customFieldId: field.id,
        customFieldOperator: "before",
        customFieldValue: "Visible"
      })
    ).resolves.toEqual([]);
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Expected integration fixture to be initialized.");
  return fixture;
}

async function createDealField(
  fx: Fixture,
  fieldType: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN",
  name: string,
  key: string
) {
  return fx.prisma.customFieldDefinition.create({
    data: {
      workspaceId: fx.workspaceA.id,
      entityType: "DEAL",
      name,
      key,
      fieldType,
      required: false
    }
  });
}

async function createDealValue(
  fx: Fixture,
  fieldId: string,
  entityId: string,
  value: Prisma.JsonNullValueInput | Prisma.InputJsonValue,
  workspace: "A" | "B" = "A"
) {
  return fx.prisma.customFieldValue.create({
    data: {
      workspaceId: workspace === "A" ? fx.workspaceA.id : fx.workspaceB.id,
      fieldId,
      entityType: "DEAL",
      entityId,
      value
    }
  });
}

async function createDeal(fx: Fixture, title: string) {
  return fx.prisma.deal.create({
    data: {
      workspaceId: fx.workspaceA.id,
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      title,
      valueCents: 0,
      currency: "USD"
    }
  });
}
