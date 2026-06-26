import { z } from "zod";

export const idSchema = z.string().min(1);

const optionalDate = z
  .string()
  .datetime()
  .optional()
	  .nullable()
	  .transform((value) => (value ? new Date(value) : null));

const requiredDate = z.string().datetime().transform((value) => new Date(value));

export const createPipelineSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().optional()
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
});

export const updatePipelineSchema = createPipelineSchema.partial();

export const createStageSchema = z.object({
  name: z.string().min(1),
  probability: z.number().int().min(0).max(100).optional().nullable(),
  sortOrder: z.number().int()
});

export const updateStageSchema = createStageSchema.partial();

export const createDealSchema = z.object({
  pipelineId: idSchema,
  stageId: idSchema,
  ownerId: idSchema.optional().nullable(),
  personId: idSchema.optional().nullable(),
  organizationId: idSchema.optional().nullable(),
  title: z.string().min(1),
  valueCents: z.number().int().nonnegative().optional().nullable(),
  currency: z.string().length(3).default("USD"),
  status: z.enum(["OPEN", "WON", "LOST"]).optional(),
  expectedCloseAt: optionalDate
});

export const updateDealSchema = createDealSchema.partial();

export const createProductSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  unitPriceCents: z.number().int().nonnegative(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("USD")
});
export const updateProductSchema = createProductSchema;

export const createDealLineItemSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().positive(),
  description: z.string().trim().optional().nullable()
});

const quoteAdjustmentTypeSchema = z.enum(["NONE", "PERCENT", "FIXED"]);

export const updateQuoteAdjustmentsSchema = z.object({
  discountType: quoteAdjustmentTypeSchema.default("NONE"),
  discountValue: z.number().int().nonnegative().default(0),
  taxType: quoteAdjustmentTypeSchema.default("NONE"),
  taxValue: z.number().int().nonnegative().default(0)
}).superRefine((value, context) => {
  if (value.discountType === "PERCENT" && value.discountValue > 10000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Discount percent cannot be greater than 100%.",
      path: ["discountValue"]
    });
  }
  if (value.taxType === "PERCENT" && value.taxValue > 10000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Tax percent cannot be greater than 100%.",
      path: ["taxValue"]
    });
  }
});

export const closeDealSchema = z.object({
  status: z.enum(["WON", "LOST"]),
  lostReason: z.string().max(1000).optional().nullable()
});

export const createLeadSchema = z.object({
  ownerId: idSchema.optional().nullable(),
  personId: idSchema.optional().nullable(),
  organizationId: idSchema.optional().nullable(),
  title: z.string().min(1),
  source: z.string().optional().nullable(),
  status: z.enum(["NEW", "QUALIFIED", "DISQUALIFIED", "CONVERTED"]).optional()
});

export const updateLeadSchema = createLeadSchema.partial();

export const convertLeadSchema = z.object({
  pipelineId: idSchema,
  stageId: idSchema,
  title: z.string().min(1).optional().nullable()
});

export const createPersonSchema = z.object({
  ownerId: idSchema.optional().nullable(),
  organizationId: idSchema.optional().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable()
});

export const updatePersonSchema = createPersonSchema.partial();

export const createOrganizationSchema = z.object({
  ownerId: idSchema.optional().nullable(),
  name: z.string().min(1),
  domain: z.string().optional().nullable()
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const createActivitySchema = z.object({
  ownerId: idSchema.optional().nullable(),
  dealId: idSchema.optional().nullable(),
  leadId: idSchema.optional().nullable(),
  personId: idSchema.optional().nullable(),
  organizationId: idSchema.optional().nullable(),
  type: z.enum(["CALL", "EMAIL", "MEETING", "TASK"]),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  dueAt: optionalDate,
  completedAt: optionalDate
});

export const updateActivitySchema = createActivitySchema.partial();

export const createNoteSchema = z.object({
  dealId: idSchema.optional().nullable(),
  leadId: idSchema.optional().nullable(),
  personId: idSchema.optional().nullable(),
  organizationId: idSchema.optional().nullable(),
  body: z.string().min(1)
});

export const createEmailLogSchema = z.object({
  dealId: idSchema.optional().nullable(),
  leadId: idSchema.optional().nullable(),
  personId: idSchema.optional().nullable(),
  organizationId: idSchema.optional().nullable(),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  occurredAt: requiredDate,
  fromText: z.string().trim().optional().nullable(),
  toText: z.string().trim().optional().nullable(),
  ccText: z.string().trim().optional().nullable()
});

export const createEmailTemplateSchema = z.object({
  name: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1)
});

export const updateEmailTemplateSchema = createEmailTemplateSchema;

export const createCustomFieldSchema = z.object({
  entityType: z.enum(["DEAL", "PERSON", "ORGANIZATION", "LEAD"]),
  name: z.string().min(1),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  fieldType: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN"]),
  required: z.boolean().optional(),
  options: z.unknown().optional().nullable()
});

export const upsertCustomFieldValuesSchema = z.object({
  entityType: z.enum(["DEAL", "PERSON", "ORGANIZATION", "LEAD"]),
  entityId: idSchema,
  values: z.record(z.unknown())
});
