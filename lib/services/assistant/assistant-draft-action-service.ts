import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { draftAiPreferenceChangesFromText, getAiPreferences } from "@/lib/services/ai-preferences-service";
import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import { redactSensitiveText } from "@/lib/security/redaction";
import { userDisplaySelect } from "@/lib/services/user-select";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

export type AssistantDraftActionKind =
  | "activity"
  | "ai_preference_update"
  | "contact_create"
  | "contact_organization_link"
  | "contact_relationship_update"
  | "contact_update"
  | "note"
  | "organization_contact_creation"
  | "organization_create"
  | "organization_update";

export type AssistantDraftActionConfidence = "high" | "low" | "medium" | "needs_clarification";

export type AssistantDraftActionField = {
  currentValue?: string | null;
  label: string;
  value: string;
};

export type AssistantDraftActionCandidate = {
  detail?: string;
  href: string;
  id: string;
  label: string;
  type: "deal" | "lead" | "organization" | "person";
};

export type AssistantDraftActionProposal = {
  expectedCurrentValues?: Record<string, string | null>;
  fields: Record<string, string | null>;
  operation:
    | "create_contact"
    | "create_organization"
    | "link_contact_organization"
    | "update_contact"
    | "update_organization";
  secondaryRecordId?: string;
  targetRecordId?: string;
};

export type AssistantDraftClarificationSlot = {
  candidateType: "organization" | "person";
  key: "organization" | "person";
  label: string;
  selectedRecordId?: string;
};

export type AssistantDraftActionClarification = {
  intent: CrmRecordChangeParseResult;
  resolved?: {
    organizationId?: string;
    personId?: string;
  };
  resolutionKey?: string;
  slots: AssistantDraftClarificationSlot[];
  status: "needs_selection" | "resolved";
};

export type AssistantDraftAction = {
  applyState: "disabled";
  candidates: AssistantDraftActionCandidate[];
  confidence: AssistantDraftActionConfidence;
  clarification?: AssistantDraftActionClarification;
  evidence: string[];
  fields: AssistantDraftActionField[];
  id: string;
  kind: AssistantDraftActionKind;
  missingInfo: string[];
  proposal?: AssistantDraftActionProposal;
  reviewLabel: "Draft only";
  targetHref?: string;
  targetKind: "AI preferences" | "Activity" | "Contact" | "Contact + organization" | "New record" | "Note" | "Organization";
  targetLabel: string;
  title: string;
  warnings: string[];
};

export type AssistantDraftCommandKind =
  | "draft_activity"
  | "draft_ai_preferences"
  | "draft_crm_record_change"
  | "draft_contact_relationship"
  | "draft_note"
  | "draft_record_creation";

export async function buildAssistantDraftActions(
  actor: WorkspaceActor,
  input: { kind: AssistantDraftCommandKind; query: string },
  now = new Date()
): Promise<AssistantDraftAction[]> {
  await ensureWorkspaceAccess(actor);
  if (input.kind === "draft_activity") return [await draftActivityAction(actor, input.query, now)];
  if (input.kind === "draft_note") return [await draftNoteAction(actor, input.query)];
  if (input.kind === "draft_contact_relationship") return [await draftContactRelationshipAction(actor, input.query)];
  if (input.kind === "draft_crm_record_change") return draftCrmRecordChangeActions(actor, input.query);
  if (input.kind === "draft_record_creation") return [await draftOrganizationContactCreationAction(actor, input.query)];
  return [await draftAiPreferenceAction(actor, input.query)];
}

async function draftActivityAction(actor: WorkspaceActor, query: string, now: Date): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const dueAt = parseDueDate(cleaned, now);
  const relatedTarget = extractActivityRelatedTarget(cleaned);
  const relationMatch = relatedTarget ? await matchAnyRecord(actor, relatedTarget) : emptyMatch();
  const title = activityTitle(cleaned, relatedTarget);
  const fields: AssistantDraftActionField[] = [
    { label: "Title", value: title || "Follow up" },
    { label: "Type", value: activityType(cleaned) },
    { label: "Due date", value: dueAt ? formatDraftDate(dueAt) : "Not detected" }
  ];
  if (relationMatch.selected) {
    fields.push({ label: "Related record", value: relationMatch.selected.label });
  }

  return {
    applyState: "disabled",
    candidates: relationMatch.candidates,
    confidence: dueAt && relationMatch.confidence === "high" ? "high" : relationMatch.confidence === "needs_clarification" ? "needs_clarification" : "medium",
    evidence: [cleaned],
    fields,
    id: "draft-activity",
    kind: "activity",
    missingInfo: [
      ...(dueAt ? [] : ["A due date was not confidently detected."]),
      ...(relatedTarget ? [] : ["A related person, organization, or deal was not detected."])
    ],
    reviewLabel: "Draft only",
    targetHref: relationMatch.selected?.href,
    targetKind: "Activity",
    targetLabel: relationMatch.selected ? relationMatch.selected.label : "New activity",
    title: "Draft activity",
    warnings: relationMatch.warnings
  };
}

async function draftNoteAction(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const parsed = parseNoteCommand(cleaned);
  const relationMatch = parsed.target ? await matchAnyRecord(actor, parsed.target) : emptyMatch();
  const body = parsed.body || noteBodyFallback(cleaned, parsed.target);
  const fields: AssistantDraftActionField[] = [
    { label: "Body", value: body || "No clear note body detected." }
  ];
  if (relationMatch.selected) {
    fields.push({ label: "Related record", value: relationMatch.selected.label });
  }

  return {
    applyState: "disabled",
    candidates: relationMatch.candidates,
    confidence: body && relationMatch.confidence === "high" ? "high" : relationMatch.confidence === "needs_clarification" ? "needs_clarification" : "medium",
    evidence: [cleaned],
    fields,
    id: "draft-note",
    kind: "note",
    missingInfo: [
      ...(body ? [] : ["A note body was not confidently detected."]),
      ...(parsed.target ? [] : ["A related person, organization, lead, or deal was not detected."])
    ],
    reviewLabel: "Draft only",
    targetHref: relationMatch.selected?.href,
    targetKind: "Note",
    targetLabel: relationMatch.selected ? relationMatch.selected.label : "New note",
    title: "Draft note",
    warnings: relationMatch.warnings
  };
}

async function draftContactRelationshipAction(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const parsed = parseContactRelationshipCommand(cleaned);
  const personMatch = parsed.target ? await matchPeople(actor, parsed.target) : emptyMatch();
  const selectedPerson = personMatch.selected;
  const summary = summarizeRelationshipFact(parsed.fact, selectedPerson?.label ?? parsed.target);
  const fields: AssistantDraftActionField[] = [
    { label: "Relationship Memory field", value: "Personal context" },
    { label: "Proposed summary", value: summary || "No clear relationship fact detected." }
  ];

  return {
    applyState: "disabled",
    candidates: personMatch.candidates,
    confidence: summary && personMatch.confidence === "high" ? "high" : personMatch.confidence,
    evidence: [parsed.fact ? `User-provided fact: ${parsed.fact}` : cleaned],
    fields,
    id: "draft-contact-relationship",
    kind: "contact_relationship_update",
    missingInfo: [
      ...(parsed.target ? [] : ["A contact name was not detected."]),
      ...(summary ? [] : ["A relationship/profile fact was not detected."])
    ],
    reviewLabel: "Draft only",
    targetHref: selectedPerson?.href,
    targetKind: "Contact",
    targetLabel: selectedPerson?.label ?? parsed.target ?? "Contact requires review",
    title: "Draft contact relationship update",
    warnings: [
      ...personMatch.warnings,
      "Review for sensitivity before saving. Do not store protected traits, confidential health details, or private facts that are not useful for customer relationship context."
    ]
  };
}

async function draftOrganizationContactCreationAction(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const parsed = parseOrganizationContactCommand(cleaned);
  const [organizationMatch, personMatch] = await Promise.all([
    parsed.organizationName ? matchOrganizations(actor, parsed.organizationName) : Promise.resolve(emptyMatch()),
    parsed.personName ? matchPeople(actor, parsed.personName) : Promise.resolve(emptyMatch())
  ]);
  const fields: AssistantDraftActionField[] = [
    { label: "Organization name", value: parsed.organizationName || "Missing" },
    { label: "Contact name", value: parsed.personName || "Missing" },
    { label: "Contact role/title", value: parsed.role || "Missing" },
    { label: "Relationship", value: parsed.organizationName && parsed.personName ? `${parsed.personName} at ${parsed.organizationName}` : "Missing" }
  ];

  return {
    applyState: "disabled",
    candidates: [...organizationMatch.candidates, ...personMatch.candidates],
    confidence: parsed.organizationName && parsed.personName && parsed.role && organizationMatch.candidates.length === 0 && personMatch.candidates.length === 0 ? "medium" : "needs_clarification",
    evidence: [parsed.note ? `Provided note: ${parsed.note}` : cleaned],
    fields,
    id: "draft-organization-contact-creation",
    kind: "organization_contact_creation",
    missingInfo: [
      ...(parsed.organizationName ? [] : ["Organization name is missing."]),
      ...(parsed.personName ? [] : ["Contact name is missing."]),
      ...(parsed.role ? [] : ["Contact role/title is missing."])
    ],
    reviewLabel: "Draft only",
    targetKind: "Contact + organization",
    targetLabel: "New records for review",
    title: "Draft organization/contact creation",
    warnings: [
      ...organizationMatch.candidates.map((candidate) => `Possible existing organization: ${candidate.label}. Review before creating a duplicate.`),
      ...personMatch.candidates.map((candidate) => `Possible existing contact: ${candidate.label}. Review before creating a duplicate.`),
      "No records will be created until an apply workflow exists and a user confirms it."
    ]
  };
}

async function draftCrmRecordChangeActions(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction[]> {
  const evidenceText = sanitizeEvidence(query);
  const parsed = parseCrmRecordChangeCommand(query);
  const draft = await draftFromParsedCrmRecordChange(actor, evidenceText, parsed);
  if (draft) return [draft];
  return [{
    applyState: "disabled",
    candidates: [],
    confidence: "needs_clarification",
    evidence: [evidenceText],
    fields: [{ label: "Requested change", value: "No supported contact or organization change was detected." }],
    id: "draft-crm-record-change-unsupported",
    kind: "contact_update",
    missingInfo: ["Ask for a supported contact or organization create, update, or link action."],
    reviewLabel: "Draft only",
    targetKind: "Contact",
    targetLabel: "Supported CRM record required",
    title: "Draft CRM record change",
    warnings: ["Supported fields are contact name, title, email, phone, organization link, and organization name or domain."]
  }];
}

export async function resolveAssistantCrmDraftClarification(
  actor: WorkspaceActor,
  input: { candidateId: string; candidateType: "organization" | "person"; draftAction: AssistantDraftAction }
): Promise<AssistantDraftAction> {
  await ensureWorkspaceAccess(actor);
  const clarification = input.draftAction.clarification;
  if (!clarification || clarification.status !== "needs_selection") {
    return unavailableClarificationDraft(input.draftAction, "This draft no longer needs clarification.");
  }
  const candidateId = input.candidateId.trim().slice(0, 160);
  const slot = clarification.slots.find((item) => !item.selectedRecordId && item.candidateType === input.candidateType);
  const selectedCandidate = input.draftAction.candidates.find((candidate) => candidate.id === candidateId && candidate.type === input.candidateType);
  if (!candidateId || !slot || !selectedCandidate) {
    return unavailableClarificationDraft(input.draftAction, "Selected candidate is not valid for this clarification.");
  }
  const resolution = {
    ...(clarification.resolved ?? {}),
    ...(input.candidateType === "person" ? { personId: candidateId } : { organizationId: candidateId })
  };
  const resolvedDraft = await draftFromParsedCrmRecordChange(actor, input.draftAction.evidence[0] ?? input.draftAction.title, clarification.intent, resolution);
  if (!resolvedDraft) return unavailableClarificationDraft(input.draftAction, "The original action is no longer supported.");
  return resolvedDraft;
}

async function draftFromParsedCrmRecordChange(
  actor: WorkspaceActor,
  evidenceText: string,
  parsed: CrmRecordChangeParseResult,
  resolution: CrmRecordChangeResolution = {}
) {
  if (parsed.kind === "create_contact") return draftCreateContactAction(actor, evidenceText, parsed, resolution);
  if (parsed.kind === "update_contact") return draftUpdateContactAction(actor, evidenceText, parsed, resolution);
  if (parsed.kind === "create_organization") return draftCreateOrganizationAction(actor, evidenceText, parsed, resolution);
  if (parsed.kind === "update_organization") return draftUpdateOrganizationAction(actor, evidenceText, parsed, resolution);
  if (parsed.kind === "link_contact_organization") return draftLinkContactOrganizationAction(actor, evidenceText, parsed, resolution);
  return null;
}

async function draftCreateContactAction(
  actor: WorkspaceActor,
  cleaned: string,
  parsed: Extract<CrmRecordChangeParseResult, { kind: "create_contact" }>,
  resolution: CrmRecordChangeResolution = {}
): Promise<AssistantDraftAction> {
  const organizationMatch = resolution.organizationId
    ? await matchResolvedOrganization(actor, resolution.organizationId)
    : parsed.organizationName ? await matchOrganizations(actor, parsed.organizationName) : emptyMatch();
  const duplicateCandidates = await findDuplicateContactCandidates(actor, {
    email: parsed.email,
    firstName: parsed.firstName,
    lastName: parsed.lastName
  });
  const selectedOrganization = organizationMatch.selected;
  const fields: AssistantDraftActionField[] = [
    { label: "First name", value: parsed.firstName || "Missing" },
    { label: "Last name", value: parsed.lastName || "Not provided" },
    { label: "Email", value: parsed.email || "Not provided" },
    { label: "Phone", value: parsed.phone || "Not provided" }
  ];
  if (selectedOrganization) fields.push({ label: "Organization", value: selectedOrganization.label });

  const missingInfo = [
    ...(parsed.firstName ? [] : ["Contact first name is missing."]),
    ...(parsed.organizationName && !selectedOrganization ? ["The requested organization was not resolved to one existing workspace record."] : [])
  ];
  const warnings = [
    ...organizationMatch.warnings,
    ...duplicateCandidates.map((candidate) => `Possible duplicate contact: ${candidate.label}. Review before creating a new contact.`),
    ...(parsed.unsupportedFields.length > 0 ? [`Unsupported contact field ignored: ${parsed.unsupportedFields.join(", ")}.`] : [])
  ];

  return {
    applyState: "disabled",
    candidates: [...duplicateCandidates, ...organizationMatch.candidates],
    clarification: clarificationForDraft(parsed, resolution, [
      ...(parsed.organizationName && organizationMatch.confidence === "needs_clarification"
        ? [{ candidateType: "organization" as const, key: "organization" as const, label: `Choose the organization for ${parsed.fullName || "this contact"}` }]
        : [])
    ]),
    confidence: missingInfo.length === 0 && duplicateCandidates.length === 0 && organizationMatch.confidence !== "needs_clarification" ? "high" : "needs_clarification",
    evidence: [`User-provided request: ${cleaned}`],
    fields,
    id: "draft-contact-create",
    kind: "contact_create",
    missingInfo,
    proposal: {
      fields: {
        email: parsed.email || null,
        firstName: parsed.firstName,
        lastName: parsed.lastName || null,
        organizationId: selectedOrganization?.id ?? null,
        phone: parsed.phone || null
      },
      operation: "create_contact"
    },
    reviewLabel: "Draft only",
    targetKind: "Contact",
    targetLabel: parsed.fullName || "New contact",
    title: "Propose creating contact",
    warnings
  };
}

async function draftUpdateContactAction(
  actor: WorkspaceActor,
  cleaned: string,
  parsed: Extract<CrmRecordChangeParseResult, { kind: "update_contact" }>,
  resolution: CrmRecordChangeResolution = {}
): Promise<AssistantDraftAction> {
  const personMatch = resolution.personId
    ? await matchResolvedPerson(actor, resolution.personId)
    : parsed.targetName ? await matchPeople(actor, parsed.targetName) : emptyMatch();
  const selectedPerson = personMatch.selected ? await loadPersonProposalSnapshot(actor, personMatch.selected.id) : null;
  const supportedFields = selectedPerson ? supportedContactUpdateFields(parsed, selectedPerson) : {};
  const fields = selectedPerson
    ? contactProposalFields(supportedFields, selectedPerson)
    : [{ label: "Requested change", value: parsed.requestedValue || "No supported value detected." }];
  const missingInfo = [
    ...(parsed.targetName ? [] : ["Contact name or id is missing."]),
    ...(personMatch.confidence === "high" && selectedPerson ? [] : ["One clear contact target is required."]),
    ...(Object.keys(supportedFields).length > 0 ? [] : ["No supported contact field change was detected."])
  ];
  const warnings = [
    ...personMatch.warnings,
    ...(parsed.unsupportedFields.length > 0 ? [`Unsupported contact field ignored: ${parsed.unsupportedFields.join(", ")}.`] : [])
  ];

  return {
    applyState: "disabled",
    candidates: personMatch.candidates,
    clarification: clarificationForDraft(parsed, resolution, [
      ...(parsed.targetName && personMatch.confidence === "needs_clarification"
        ? [{ candidateType: "person" as const, key: "person" as const, label: `Choose the contact to update for ${parsed.targetName}` }]
        : [])
    ]),
    confidence: missingInfo.length === 0 ? "high" : "needs_clarification",
    evidence: [`User-provided request: ${cleaned}`],
    fields,
    id: "draft-contact-update",
    kind: "contact_update",
    missingInfo,
    proposal: selectedPerson ? {
      expectedCurrentValues: contactExpectedValues(supportedFields, selectedPerson),
      fields: supportedFields,
      operation: "update_contact",
      targetRecordId: selectedPerson.id
    } : undefined,
    reviewLabel: "Draft only",
    targetHref: selectedPerson ? `/contacts/${selectedPerson.id}` : undefined,
    targetKind: "Contact",
    targetLabel: selectedPerson ? formatPersonName(selectedPerson) ?? selectedPerson.email ?? "Unnamed contact" : parsed.targetName || "Contact requires review",
    title: "Propose updating contact",
    warnings
  };
}

async function draftCreateOrganizationAction(
  actor: WorkspaceActor,
  cleaned: string,
  parsed: Extract<CrmRecordChangeParseResult, { kind: "create_organization" }>,
  resolution: CrmRecordChangeResolution = {}
): Promise<AssistantDraftAction> {
  const duplicateCandidates = await findDuplicateOrganizationCandidates(actor, { domain: parsed.domain, name: parsed.name });
  const personMatch = resolution.personId
    ? await matchResolvedPerson(actor, resolution.personId)
    : parsed.linkPersonName ? await matchPeople(actor, parsed.linkPersonName) : emptyMatch();
  const selectedPerson = personMatch.selected ? await loadPersonProposalSnapshot(actor, personMatch.selected.id) : null;
  const fields: AssistantDraftActionField[] = [
    { label: "Organization name", value: parsed.name || "Missing" },
    { label: "Domain", value: parsed.domain || "Not provided" }
  ];
  if (selectedPerson) fields.push({ currentValue: selectedPerson.organizationName, label: "Link contact", value: formatPersonName(selectedPerson) ?? selectedPerson.email ?? "Unnamed contact" });
  const missingInfo = [
    ...(parsed.name ? [] : ["Organization name is missing."]),
    ...(parsed.linkPersonName && (!selectedPerson || personMatch.confidence !== "high") ? ["One clear contact is required before linking during create."] : [])
  ];
  const warnings = [
    ...duplicateCandidates.map((candidate) => `Possible duplicate organization: ${candidate.label}. Review before creating a new organization.`),
    ...personMatch.warnings,
    ...(parsed.linkPersonName ? ["This proposal creates the organization. Link the contact with a separate reviewed proposal after the organization exists."] : [])
  ];

  return {
    applyState: "disabled",
    candidates: [...duplicateCandidates, ...personMatch.candidates],
    clarification: clarificationForDraft(parsed, resolution, [
      ...(parsed.linkPersonName && personMatch.confidence === "needs_clarification"
        ? [{ candidateType: "person" as const, key: "person" as const, label: `Choose the contact to link after ${parsed.name || "the organization"} exists` }]
        : [])
    ]),
    confidence: missingInfo.length === 0 && duplicateCandidates.length === 0 ? "high" : "needs_clarification",
    evidence: [`User-provided request: ${cleaned}`],
    fields,
    id: "draft-organization-create",
    kind: "organization_create",
    missingInfo,
    proposal: {
      expectedCurrentValues: selectedPerson ? { linkedContactOrganizationId: selectedPerson.organizationId } : undefined,
      fields: {
        domain: parsed.domain || null,
        linkPersonId: selectedPerson?.id ?? null,
        name: parsed.name
      },
      operation: "create_organization"
    },
    reviewLabel: "Draft only",
    targetKind: "Organization",
    targetLabel: parsed.name || "New organization",
    title: "Propose creating organization",
    warnings
  };
}

async function draftUpdateOrganizationAction(
  actor: WorkspaceActor,
  cleaned: string,
  parsed: Extract<CrmRecordChangeParseResult, { kind: "update_organization" }>,
  resolution: CrmRecordChangeResolution = {}
): Promise<AssistantDraftAction> {
  const organizationMatch = resolution.organizationId
    ? await matchResolvedOrganization(actor, resolution.organizationId)
    : parsed.targetName ? await matchOrganizations(actor, parsed.targetName) : emptyMatch();
  const selectedOrganization = organizationMatch.selected ? await loadOrganizationProposalSnapshot(actor, organizationMatch.selected.id) : null;
  const supportedFields = selectedOrganization ? supportedOrganizationUpdateFields(parsed, selectedOrganization) : {};
  const fields = selectedOrganization
    ? organizationProposalFields(supportedFields, selectedOrganization)
    : [{ label: "Requested change", value: parsed.requestedValue || "No supported value detected." }];
  const missingInfo = [
    ...(parsed.targetName ? [] : ["Organization name or id is missing."]),
    ...(organizationMatch.confidence === "high" && selectedOrganization ? [] : ["One clear organization target is required."]),
    ...(Object.keys(supportedFields).length > 0 ? [] : ["No supported organization field change was detected."])
  ];

  return {
    applyState: "disabled",
    candidates: organizationMatch.candidates,
    clarification: clarificationForDraft(parsed, resolution, [
      ...(parsed.targetName && organizationMatch.confidence === "needs_clarification"
        ? [{ candidateType: "organization" as const, key: "organization" as const, label: `Choose the organization to update for ${parsed.targetName}` }]
        : [])
    ]),
    confidence: missingInfo.length === 0 ? "high" : "needs_clarification",
    evidence: [`User-provided request: ${cleaned}`],
    fields,
    id: "draft-organization-update",
    kind: "organization_update",
    missingInfo,
    proposal: selectedOrganization ? {
      expectedCurrentValues: organizationExpectedValues(supportedFields, selectedOrganization),
      fields: supportedFields,
      operation: "update_organization",
      targetRecordId: selectedOrganization.id
    } : undefined,
    reviewLabel: "Draft only",
    targetHref: selectedOrganization ? `/organizations/${selectedOrganization.id}` : undefined,
    targetKind: "Organization",
    targetLabel: selectedOrganization?.name ?? parsed.targetName ?? "Organization requires review",
    title: "Propose updating organization",
    warnings: organizationMatch.warnings
  };
}

async function draftLinkContactOrganizationAction(
  actor: WorkspaceActor,
  cleaned: string,
  parsed: Extract<CrmRecordChangeParseResult, { kind: "link_contact_organization" }>,
  resolution: CrmRecordChangeResolution = {}
): Promise<AssistantDraftAction> {
  const [personMatch, organizationMatch] = await Promise.all([
    resolution.personId ? matchResolvedPerson(actor, resolution.personId) : parsed.personName ? matchPeople(actor, parsed.personName) : Promise.resolve(emptyMatch()),
    resolution.organizationId ? matchResolvedOrganization(actor, resolution.organizationId) : parsed.organizationName ? matchOrganizations(actor, parsed.organizationName) : Promise.resolve(emptyMatch())
  ]);
  const [selectedPerson, selectedOrganization] = await Promise.all([
    personMatch.selected ? loadPersonProposalSnapshot(actor, personMatch.selected.id) : Promise.resolve(null),
    organizationMatch.selected ? loadOrganizationProposalSnapshot(actor, organizationMatch.selected.id) : Promise.resolve(null)
  ]);
  const personLabel = selectedPerson ? formatPersonName(selectedPerson) ?? selectedPerson.email ?? "Unnamed contact" : parsed.personName || "Contact requires review";
  const organizationLabel = selectedOrganization?.name ?? (parsed.organizationName || "Missing");
  const fields: AssistantDraftActionField[] = [
    { currentValue: selectedPerson?.organizationName ?? null, label: "Organization", value: organizationLabel }
  ];
  const missingInfo = [
    ...(parsed.personName ? [] : ["Contact name or id is missing."]),
    ...(parsed.organizationName ? [] : ["Organization name or id is missing."]),
    ...(personMatch.confidence === "high" && selectedPerson ? [] : ["One clear contact target is required."]),
    ...(organizationMatch.confidence === "high" && selectedOrganization ? [] : ["One clear organization target is required."])
  ];

  return {
    applyState: "disabled",
    candidates: [...personMatch.candidates, ...organizationMatch.candidates],
    clarification: clarificationForDraft(parsed, resolution, [
      ...(parsed.personName && personMatch.confidence === "needs_clarification"
        ? [{ candidateType: "person" as const, key: "person" as const, label: `Choose the contact for ${parsed.personName}` }]
        : []),
      ...(parsed.organizationName && organizationMatch.confidence === "needs_clarification"
        ? [{ candidateType: "organization" as const, key: "organization" as const, label: `Choose the organization for ${parsed.organizationName}` }]
        : [])
    ]),
    confidence: missingInfo.length === 0 ? "high" : "needs_clarification",
    evidence: [`User-provided request: ${cleaned}`],
    fields,
    id: "draft-contact-organization-link",
    kind: "contact_organization_link",
    missingInfo,
    proposal: selectedPerson && selectedOrganization ? {
      expectedCurrentValues: { organizationId: selectedPerson.organizationId },
      fields: { organizationId: selectedOrganization.id },
      operation: "link_contact_organization",
      secondaryRecordId: selectedOrganization.id,
      targetRecordId: selectedPerson.id
    } : undefined,
    reviewLabel: "Draft only",
    targetHref: selectedPerson ? `/contacts/${selectedPerson.id}` : undefined,
    targetKind: "Contact",
    targetLabel: personLabel,
    title: "Propose linking contact to organization",
    warnings: [...personMatch.warnings, ...organizationMatch.warnings]
  };
}

async function draftAiPreferenceAction(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const [current, draft] = await Promise.all([
    getAiPreferences(actor),
    Promise.resolve(draftAiPreferenceChangesFromText(cleaned))
  ]);
  const proposedChanges = { ...draft.proposedChanges };
  if (/\b(casual|conversational)\b/i.test(cleaned)) {
    proposedChanges.naturalLanguageInstructions = "Email replies should be casual and concise.";
  }
  const fields = Object.entries(proposedChanges).map(([key, value]) => ({
    currentValue: formatPreferenceValue(current[key as keyof typeof current]),
    label: preferenceLabel(key),
    value: formatPreferenceValue(value)
  }));

  return {
    applyState: "disabled",
    candidates: [],
    confidence: fields.length > 0 ? "medium" : "needs_clarification",
    evidence: [cleaned],
    fields: fields.length > 0 ? fields : [{ label: "Requested guidance", value: "No clear supported AI preference change detected." }],
    id: "draft-ai-preference-update",
    kind: "ai_preference_update",
    missingInfo: fields.length > 0 ? [] : ["Specify the tone, summary length, detail level, memory usage, diagnostics detail, or suggestion level to change."],
    reviewLabel: "Draft only",
    targetKind: "AI preferences",
    targetLabel: "Current user's AI preferences",
    title: "Draft AI preference change",
    warnings: ["Settings are not saved from Assistant drafts in this slice."]
  };
}

function parseContactRelationshipCommand(input: string) {
  const match = input.match(/\bupdate\s+(.+?)(?:'s|’s)?\s+(?:profile|relationship(?:\s+memory)?|contact profile)\s+(?:to include|with|that)\s+(.+)$/i);
  if (match) {
    return {
      fact: cleanTrailingPunctuation(match[2] ?? ""),
      target: cleanPossessive(match[1] ?? "")
    };
  }
  const fallback = input.match(/\b(?:profile|relationship(?:\s+memory)?)\s+for\s+(.+?)\s+(?:to include|with|that)\s+(.+)$/i);
  return {
    fact: cleanTrailingPunctuation(fallback?.[2] ?? ""),
    target: cleanPossessive(fallback?.[1] ?? "")
  };
}

function parseOrganizationContactCommand(input: string) {
  const noteSplit = input.split(/\bfrom\s+(?:this\s+)?note:\s*/i);
  const command = noteSplit[0] ?? input;
  const note = sanitizeEvidence(noteSplit.slice(1).join(" from note: "));
  const organizationName = cleanTrailingPunctuation(
    command.match(/\borganization\s+(?:for|called|named)\s+(.+?)(?:\s+and\s+add|\s+with|\s*$)/i)?.[1] ?? ""
  );
  const addMatch = command.match(/\badd\s+(.+?)(?:\s+as\s+(.+?))?(?:\s+from\b|\s+to\b|\s*$)/i);
  return {
    note,
    organizationName,
    personName: cleanTrailingPunctuation(addMatch?.[1] ?? ""),
    role: cleanTrailingPunctuation(addMatch?.[2] ?? "")
  };
}

export type CrmRecordChangeParseResult =
  | {
      email: string;
      firstName: string;
      fullName: string;
      kind: "create_contact";
      lastName: string;
      organizationName: string;
      phone: string;
      unsupportedFields: string[];
    }
  | {
      email: string;
      field: "email" | "firstName" | "lastName" | "phone" | "title" | "unsupported";
      kind: "update_contact";
      phone: string;
      requestedValue: string;
      targetName: string;
      unsupportedFields: string[];
    }
  | {
      domain: string;
      kind: "create_organization";
      linkPersonName: string;
      name: string;
    }
  | {
      domain: string;
      field: "domain" | "name" | "unsupported";
      kind: "update_organization";
      name: string;
      requestedValue: string;
      targetName: string;
    }
  | {
      kind: "link_contact_organization";
      organizationName: string;
      personName: string;
    }
  | { kind: "unsupported" };

type CrmRecordChangeResolution = {
  organizationId?: string;
  personId?: string;
};

function parseCrmRecordChangeCommand(input: string): CrmRecordChangeParseResult {
  const cleaned = cleanTrailingPunctuation(input);
  const link = parseLinkContactOrganizationCommand(cleaned);
  if (link) return link;
  const createContact = parseCreateContactCommand(cleaned);
  if (createContact) return createContact;
  const createOrganization = parseCreateOrganizationCommand(cleaned);
  if (createOrganization) return createOrganization;
  const updateOrganization = parseUpdateOrganizationCommand(cleaned);
  if (updateOrganization) return updateOrganization;
  const updateContact = parseUpdateContactCommand(cleaned);
  if (updateContact) return updateContact;
  return { kind: "unsupported" };
}

function parseCreateContactCommand(input: string): Extract<CrmRecordChangeParseResult, { kind: "create_contact" }> | null {
  const match = input.match(/\bcreate\s+(?:a\s+)?contact\s+(?:for|named|called)?\s*(.+?)(?:\s+(?:at|with)\s+(.+?))?(?:\s+with\b|$)/i);
  if (!match) return null;
  const name = cleanPersonName(match[1] ?? "");
  const parsedName = parsePersonName(name);
  return {
    email: extractEmail(input),
    firstName: parsedName.firstName,
    fullName: name,
    kind: "create_contact",
    lastName: parsedName.lastName,
    organizationName: cleanOrganizationName(match[2] ?? ""),
    phone: extractPhone(input),
    unsupportedFields: unsupportedContactFields(input)
  };
}

function parseUpdateContactCommand(input: string): Extract<CrmRecordChangeParseResult, { kind: "update_contact" }> | null {
  const possessive = input.match(/\bupdate\s+(.+?)(?:'s|’s)\s+(.+?)\s+(?:to|as)\s+(.+)$/i);
  const direct = input.match(/\b(?:update|set|change|add)\s+(.+?)(?:'s|’s)?\s+(?:contact\s+)?(email|phone|first name|last name|name|title|role)\s+(?:to|as|with)\s+(.+)$/i);
  const addPhone = input.match(/\badd\s+(?:the\s+)?phone(?:\s+number)?\s+(.+?)\s+to\s+(.+?)(?:'s|’s)?\s+contact$/i);
  const match = possessive ?? direct;
  if (addPhone) {
    return {
      email: "",
      field: "phone",
      kind: "update_contact",
      phone: extractPhone(addPhone[1] ?? input) || cleanTrailingPunctuation(addPhone[1] ?? ""),
      requestedValue: extractPhone(addPhone[1] ?? input) || cleanTrailingPunctuation(addPhone[1] ?? ""),
      targetName: cleanPersonName(addPhone[2] ?? ""),
      unsupportedFields: []
    };
  }
  if (!match) return null;
  const rawField = cleanTrailingPunctuation(match[2] ?? "");
  const rawRequestedValue = cleanTrailingPunctuation(match[3] ?? "");
  const field = contactFieldFromText(rawField);
  const requestedValue = normalizedContactRequestedValue(field, rawRequestedValue);
  return {
    email: field === "email" ? extractEmail(rawRequestedValue) || requestedValue : "",
    field,
    kind: "update_contact",
    phone: field === "phone" ? extractPhone(rawRequestedValue) || requestedValue : "",
    requestedValue,
    targetName: cleanPersonName(match[1] ?? ""),
    unsupportedFields: field === "unsupported" ? [rawField] : []
  };
}

function normalizedContactRequestedValue(
  field: Extract<CrmRecordChangeParseResult, { kind: "update_contact" }>["field"],
  value: string
) {
  if (field === "phone") return extractPhone(value) || sanitizeEvidence(value);
  if (field === "email") return extractEmail(value) || sanitizeEvidence(value);
  return sanitizeEvidence(value);
}

function parseCreateOrganizationCommand(input: string): Extract<CrmRecordChangeParseResult, { kind: "create_organization" }> | null {
  const match = input.match(/\bcreate\s+(?:an?\s+)?organization\s+(?:for|called|named)?\s*(.+?)(?:\s+and\s+(?:link|add)\s+(.+?)(?:\s+to\s+it)?$|\s+with\b|$)/i);
  if (!match) return null;
  return {
    domain: extractDomain(input),
    kind: "create_organization",
    linkPersonName: cleanLinkedPersonName(match[2] ?? ""),
    name: cleanOrganizationName(match[1] ?? "")
  };
}

function parseUpdateOrganizationCommand(input: string): Extract<CrmRecordChangeParseResult, { kind: "update_organization" }> | null {
  const possessive = input.match(/\bupdate\s+(.+?)(?:'s|’s)\s+(domain|name)\s+(?:to|as)\s+(.+)$/i);
  const direct = input.match(/\b(?:update|set|change)\s+(.+?)\s+(?:organization\s+)?(domain|name)\s+(?:to|as)\s+(.+)$/i);
  const match = possessive ?? direct;
  if (!match) return null;
  const field = organizationFieldFromText(match[2] ?? "");
  const requestedValue = cleanTrailingPunctuation(match[3] ?? "");
  return {
    domain: field === "domain" ? extractDomain(requestedValue) || requestedValue : "",
    field,
    kind: "update_organization",
    name: field === "name" ? requestedValue : "",
    requestedValue,
    targetName: cleanOrganizationName(match[1] ?? "")
  };
}

function parseLinkContactOrganizationCommand(input: string): Extract<CrmRecordChangeParseResult, { kind: "link_contact_organization" }> | null {
  const match = input.match(/\b(?:link|attach|connect|add)\s+(.+?)(?:'s|’s)?(?:\s+contact)?\s+(?:to|with|at)\s+(.+)$/i);
  if (!match) return null;
  const personName = cleanPersonName(match[1] ?? "");
  const organizationName = cleanOrganizationName(match[2] ?? "");
  if (!personName || !organizationName) return null;
  return { kind: "link_contact_organization", organizationName, personName };
}

function supportedContactUpdateFields(
  parsed: Extract<CrmRecordChangeParseResult, { kind: "update_contact" }>,
  current: PersonProposalSnapshot
): Record<string, string | null> {
  if (parsed.field === "email") return changedProposalFieldRecord("email", parsed.email || parsed.requestedValue, current.email);
  if (parsed.field === "phone") return changedProposalFieldRecord("phone", parsed.phone || parsed.requestedValue, current.phone);
  if (parsed.field === "firstName") return changedProposalFieldRecord("firstName", parsed.requestedValue, current.firstName);
  if (parsed.field === "lastName") return changedProposalFieldRecord("lastName", parsed.requestedValue || null, current.lastName);
  if (parsed.field === "title") return changedProposalFieldRecord("title", parsed.requestedValue, current.title);
  return {};
}

function supportedOrganizationUpdateFields(
  parsed: Extract<CrmRecordChangeParseResult, { kind: "update_organization" }>,
  current: OrganizationProposalSnapshot
): Record<string, string | null> {
  if (parsed.field === "domain") return changedProposalFieldRecord("domain", parsed.domain || parsed.requestedValue || null, current.domain);
  if (parsed.field === "name") return changedProposalFieldRecord("name", parsed.name || parsed.requestedValue, current.name);
  return {};
}

function changedProposalFieldRecord(key: string, value: string | null, currentValue: string | null): Record<string, string | null> {
  const normalizedValue = normalizeComparableFieldValue(value);
  if (normalizedValue && normalizedValue === normalizeComparableFieldValue(currentValue)) return {};
  return { [key]: value };
}

function contactProposalFields(fields: Record<string, string | null>, current: PersonProposalSnapshot): AssistantDraftActionField[] {
  return Object.entries(fields).map(([key, value]) => ({
    currentValue: contactCurrentValue(key, current),
    label: contactFieldLabel(key),
    value: value || "Blank"
  }));
}

function organizationProposalFields(fields: Record<string, string | null>, current: OrganizationProposalSnapshot): AssistantDraftActionField[] {
  return Object.entries(fields).map(([key, value]) => ({
    currentValue: organizationCurrentValue(key, current),
    label: organizationFieldLabel(key),
    value: value || "Blank"
  }));
}

function contactExpectedValues(fields: Record<string, string | null>, current: PersonProposalSnapshot): Record<string, string | null> {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, contactCurrentValue(key, current)]));
}

function organizationExpectedValues(fields: Record<string, string | null>, current: OrganizationProposalSnapshot): Record<string, string | null> {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, organizationCurrentValue(key, current)]));
}

function contactCurrentValue(key: string, current: PersonProposalSnapshot) {
  if (key === "email") return current.email;
  if (key === "firstName") return current.firstName;
  if (key === "lastName") return current.lastName;
  if (key === "organizationId") return current.organizationId;
  if (key === "phone") return current.phone;
  if (key === "title") return current.title;
  return null;
}

function organizationCurrentValue(key: string, current: OrganizationProposalSnapshot) {
  if (key === "domain") return current.domain;
  if (key === "name") return current.name;
  return null;
}

function contactFieldLabel(key: string) {
  if (key === "email") return "Email";
  if (key === "firstName") return "First name";
  if (key === "lastName") return "Last name";
  if (key === "organizationId") return "Organization";
  if (key === "phone") return "Phone";
  if (key === "title") return "Title";
  return "Unsupported field";
}

function organizationFieldLabel(key: string) {
  if (key === "domain") return "Domain";
  if (key === "name") return "Organization name";
  return "Unsupported field";
}

function contactFieldFromText(value: string): Extract<CrmRecordChangeParseResult, { kind: "update_contact" }>["field"] {
  const normalized = normalize(value);
  if (normalized === "email" || normalized === "email address") return "email";
  if (normalized === "phone" || normalized === "phone number") return "phone";
  if (normalized === "first name") return "firstName";
  if (normalized === "last name") return "lastName";
  if (normalized === "title" || normalized === "role" || normalized === "job title") return "title";
  if (normalized === "name") return "firstName";
  return "unsupported";
}

function organizationFieldFromText(value: string): Extract<CrmRecordChangeParseResult, { kind: "update_organization" }>["field"] {
  const normalized = normalize(value);
  if (normalized === "domain" || normalized === "website") return "domain";
  if (normalized === "name" || normalized === "organization name") return "name";
  return "unsupported";
}

function unsupportedContactFields(input: string) {
  const fields: string[] = [];
  return fields;
}

function parsePersonName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [firstName = "", ...rest] = parts;
  return {
    firstName,
    lastName: rest.join(" ")
  };
}

function extractEmail(value: string) {
  return value.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? "";
}

function extractPhone(value: string) {
  return value.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b|\b\d{3}[-.\s]\d{4}\b/)?.[0]?.trim() ?? "";
}

function extractDomain(value: string) {
  const withoutEmail = value.replace(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, " ");
  return withoutEmail.match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i)?.[1]?.toLowerCase() ?? "";
}

function cleanPersonName(value: string) {
  return cleanTrailingPunctuation(value)
    .replace(/\b(?:with|email|phone|number|domain|website)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLinkedPersonName(value: string) {
  return cleanPersonName(value)
    .replace(/\s+\bas\b.+$/i, "")
    .replace(/\s+\bfrom\b.+$/i, "")
    .replace(/\s+\bin\b.+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOrganizationName(value: string) {
  return cleanTrailingPunctuation(value)
    .replace(/\b(?:and\s+(?:link|add)|with|domain|website|email|phone)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNoteCommand(input: string) {
  const colonMatch = input.match(/\b(?:add|create|draft|log|save)\s+(?:a\s+)?note\s+(?:for|to|on|about)\s+(.+?)\s*:\s*(.+)$/i);
  if (colonMatch) {
    return {
      body: cleanTrailingPunctuation(colonMatch[2] ?? ""),
      target: cleanTrailingPunctuation(colonMatch[1] ?? "")
    };
  }
  const thatMatch = input.match(/\b(?:add|create|draft|log|save)\s+(?:a\s+)?note\s+(?:for|to|on|about)\s+(.+?)\s+(?:that|saying|with)\s+(.+)$/i);
  if (thatMatch) {
    return {
      body: cleanTrailingPunctuation(thatMatch[2] ?? ""),
      target: cleanTrailingPunctuation(thatMatch[1] ?? "")
    };
  }
  const fromMatch = input.match(/\b(?:add|create|draft|log|save)\s+(?:this\s+)?note\s+(.+?)\s+(?:for|to|on|about)\s+(.+)$/i);
  if (fromMatch) {
    return {
      body: cleanTrailingPunctuation(fromMatch[1] ?? ""),
      target: cleanTrailingPunctuation(fromMatch[2] ?? "")
    };
  }
  return { body: "", target: "" };
}

function extractActivityRelatedTarget(input: string) {
  const followUpMatch = input.match(/\bfollow\s+up\s+with\s+(.+?)(?:\s+(?:next|tomorrow|today|in\s+\d+|on\s+\d|by\s+\d|this\s+\w+)|[.!?]|$)/i);
  if (followUpMatch) return cleanTrailingPunctuation(followUpMatch[1] ?? "");
  const match = input.match(/\b(?:with|for|to)\s+(.+?)(?:\s+(?:next|tomorrow|today|in\s+\d+|on\s+\d|by\s+\d|this\s+\w+)|[.!?]|$)/i);
  return cleanTrailingPunctuation(match?.[1] ?? "");
}

function activityTitle(input: string, relatedTarget: string) {
  const withoutPrefix = input
    .replace(/^\s*(?:please\s+)?(?:remind me to|create (?:a )?(?:task|activity) to|draft (?:a )?(?:task|activity) to)\s+/i, "")
    .replace(/\s+(?:next\s+\w+|tomorrow|today|in\s+\d+\s+(?:day|days|week|weeks)|on\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?).*$/i, "")
    .trim();
  const title = withoutPrefix || (relatedTarget ? `Follow up with ${relatedTarget}` : "Follow up");
  return sentenceCase(cleanTrailingPunctuation(title)).slice(0, 120);
}

function activityType(input: string) {
  if (/\b(call|phone)\b/i.test(input)) return "Call";
  if (/\b(email|reply|message)\b/i.test(input)) return "Email";
  return "Task";
}

function noteBodyFallback(input: string, target: string) {
  const withoutPrefix = input.replace(/^\s*(?:please\s+)?(?:add|create|draft|log|save)\s+(?:a\s+|this\s+)?note\s*/i, "");
  const withoutTarget = target
    ? withoutPrefix.replace(new RegExp(`\\b(?:for|to|on|about)\\s+${escapeRegExp(target)}\\b`, "i"), "")
    : withoutPrefix;
  return cleanTrailingPunctuation(withoutTarget.replace(/^(?:that|saying|with)\s+/i, "")).slice(0, 600);
}

function parseDueDate(input: string, now: Date) {
  const lower = input.toLowerCase();
  if (/\btoday\b/.test(lower)) return startOfLocalDay(now);
  if (/\btomorrow\b/.test(lower)) return addDays(startOfLocalDay(now), 1);
  const inMatch = lower.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/);
  if (inMatch) {
    const amount = Number(inMatch[1]);
    const multiplier = inMatch[2].startsWith("week") ? 7 : 1;
    return addDays(startOfLocalDay(now), amount * multiplier);
  }
  const weekdayMatch = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) return nextWeekday(now, weekdayMatch[1]);
  const dateMatch = lower.match(/\bon\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dateMatch) {
    const month = Number(dateMatch[1]) - 1;
    const day = Number(dateMatch[2]);
    const year = dateMatch[3] ? normalizeYear(Number(dateMatch[3])) : now.getFullYear();
    return new Date(year, month, day);
  }
  return null;
}

async function matchAnyRecord(actor: WorkspaceActor, target: string) {
  const [people, organizations, deals, leads] = await Promise.all([
    matchPeople(actor, target),
    matchOrganizations(actor, target),
    matchDeals(actor, target),
    matchLeads(actor, target)
  ]);
  const candidates = [...people.candidates, ...organizations.candidates, ...deals.candidates, ...leads.candidates];
  const highCandidates = candidates.filter((candidate) => normalize(candidate.label) === normalize(target));
  if (highCandidates.length === 1) {
    return { candidates, confidence: "high" as const, selected: highCandidates[0], warnings: [] };
  }
  if (candidates.length === 1) {
    return { candidates, confidence: "medium" as const, selected: candidates[0], warnings: [] };
  }
  if (candidates.length > 1) {
    return {
      candidates,
      confidence: "needs_clarification" as const,
      selected: undefined,
      warnings: ["Multiple possible related records matched. Pick the target before applying this draft."]
    };
  }
  return { candidates, confidence: "low" as const, selected: undefined, warnings: ["No confident related CRM record match was found."] };
}

async function matchPeople(actor: WorkspaceActor, target: string) {
  const cleaned = normalizeTarget(target);
  if (!cleaned) return emptyMatch();
  const explicit = await explicitPersonCandidate(actor, cleaned);
  if (explicit) return { candidates: [explicit], confidence: "high" as const, selected: explicit, warnings: [] };
  const terms = searchTerms(cleaned);
  const people = await prisma.person.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
      organization: { select: { name: true } },
      owner: { select: userDisplaySelect },
      phone: true
    },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      OR: personSearchWhere(cleaned, terms)
    }
  });
  const candidates = people.map(personCandidate);
  return matchResult(candidates, cleaned, "contact");
}

async function matchOrganizations(actor: WorkspaceActor, target: string) {
  const cleaned = normalizeTarget(target);
  if (!cleaned) return emptyMatch();
  const explicit = await explicitOrganizationCandidate(actor, cleaned);
  if (explicit) return { candidates: [explicit], confidence: "high" as const, selected: explicit, warnings: [] };
  const organizations = await prisma.organization.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { domain: true, id: true, name: true, owner: { select: userDisplaySelect } },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      OR: [
        { name: { contains: cleaned, mode: "insensitive" } },
        { domain: { contains: cleaned, mode: "insensitive" } }
      ]
    }
  });
  const candidates = organizations.map(organizationCandidate);
  return matchResult(candidates, cleaned, "organization");
}

async function matchDeals(actor: WorkspaceActor, target: string) {
  const cleaned = normalizeTarget(target);
  if (!cleaned) return emptyMatch();
  const deals = await prisma.deal.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, title: true },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      title: { contains: cleaned, mode: "insensitive" }
    }
  });
  const candidates = deals.map((deal): AssistantDraftActionCandidate => ({
    href: `/deals/${deal.id}`,
    id: deal.id,
    label: deal.title,
    type: "deal"
  }));
  return matchResult(candidates, cleaned, "deal");
}

async function matchLeads(actor: WorkspaceActor, target: string) {
  const cleaned = normalizeTarget(target);
  if (!cleaned) return emptyMatch();
  const leads = await prisma.lead.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, source: true, title: true },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      title: { contains: cleaned, mode: "insensitive" }
    }
  });
  const candidates = leads.map((lead): AssistantDraftActionCandidate => ({
    detail: lead.source ?? undefined,
    href: `/leads/${lead.id}`,
    id: lead.id,
    label: lead.title,
    type: "lead"
  }));
  return matchResult(candidates, cleaned, "lead");
}

type PersonProposalSnapshot = {
  email: string | null;
  firstName: string;
  id: string;
  lastName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  phone: string | null;
  title: string | null;
};

type OrganizationProposalSnapshot = {
  domain: string | null;
  id: string;
  name: string;
};

async function explicitPersonCandidate(actor: WorkspaceActor, target: string): Promise<AssistantDraftActionCandidate | null> {
  const id = explicitRecordId(target, "contacts");
  if (!id) return null;
  const person = await prisma.person.findFirst({
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
      organization: { select: { name: true } },
      owner: { select: userDisplaySelect },
      phone: true
    },
    where: { id, workspaceId: actor.workspaceId, ...activeWhere }
  });
  if (!person) return null;
  return personCandidate(person);
}

async function explicitOrganizationCandidate(actor: WorkspaceActor, target: string): Promise<AssistantDraftActionCandidate | null> {
  const id = explicitRecordId(target, "organizations");
  if (!id) return null;
  const organization = await prisma.organization.findFirst({
    select: { domain: true, id: true, name: true, owner: { select: userDisplaySelect } },
    where: { id, workspaceId: actor.workspaceId, ...activeWhere }
  });
  if (!organization) return null;
  return organizationCandidate(organization);
}

async function matchResolvedPerson(actor: WorkspaceActor, personId: string) {
  const candidate = await explicitPersonCandidate(actor, personId);
  if (!candidate) {
    return {
      candidates: [] as AssistantDraftActionCandidate[],
      confidence: "needs_clarification" as const,
      selected: undefined,
      warnings: ["Selected contact is no longer available. Choose another candidate before continuing."]
    };
  }
  return { candidates: [candidate], confidence: "high" as const, selected: candidate, warnings: [] };
}

async function matchResolvedOrganization(actor: WorkspaceActor, organizationId: string) {
  const candidate = await explicitOrganizationCandidate(actor, organizationId);
  if (!candidate) {
    return {
      candidates: [] as AssistantDraftActionCandidate[],
      confidence: "needs_clarification" as const,
      selected: undefined,
      warnings: ["Selected organization is no longer available. Choose another candidate before continuing."]
    };
  }
  return { candidates: [candidate], confidence: "high" as const, selected: candidate, warnings: [] };
}

async function loadPersonProposalSnapshot(actor: WorkspaceActor, personId: string): Promise<PersonProposalSnapshot | null> {
  const person = await prisma.person.findFirst({
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
      organization: { select: { name: true, workspaceId: true, deletedAt: true } },
      organizationId: true,
      phone: true,
      title: true
    },
    where: { id: personId, workspaceId: actor.workspaceId, ...activeWhere }
  });
  if (!person) return null;
  return {
    email: person.email,
    firstName: person.firstName,
    id: person.id,
    lastName: person.lastName,
    organizationId: person.organizationId,
    organizationName: person.organization?.workspaceId === actor.workspaceId && !person.organization.deletedAt ? person.organization.name : null,
    phone: person.phone,
    title: person.title
  };
}

async function loadOrganizationProposalSnapshot(actor: WorkspaceActor, organizationId: string): Promise<OrganizationProposalSnapshot | null> {
  return prisma.organization.findFirst({
    select: { domain: true, id: true, name: true },
    where: { id: organizationId, workspaceId: actor.workspaceId, ...activeWhere }
  });
}

async function findDuplicateContactCandidates(
  actor: WorkspaceActor,
  input: { email: string; firstName: string; lastName: string }
): Promise<AssistantDraftActionCandidate[]> {
  const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  if (!input.email && !fullName) return [];
  const people = await prisma.person.findMany({
    orderBy: [{ updatedAt: "desc" }],
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
      organization: { select: { name: true } },
      owner: { select: userDisplaySelect },
      phone: true
    },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      OR: [
        ...(input.email ? [{ email: { equals: input.email, mode: "insensitive" as const } }] : []),
        ...(input.firstName && input.lastName
          ? [{ firstName: { equals: input.firstName, mode: "insensitive" as const }, lastName: { equals: input.lastName, mode: "insensitive" as const } }]
          : input.firstName
            ? [{ firstName: { equals: input.firstName, mode: "insensitive" as const }, lastName: null }]
            : [])
      ]
    }
  });
  return people.map(personCandidate);
}

async function findDuplicateOrganizationCandidates(
  actor: WorkspaceActor,
  input: { domain: string; name: string }
): Promise<AssistantDraftActionCandidate[]> {
  if (!input.name && !input.domain) return [];
  const organizations = await prisma.organization.findMany({
    orderBy: [{ updatedAt: "desc" }],
    select: { domain: true, id: true, name: true, owner: { select: userDisplaySelect } },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      OR: [
        ...(input.name ? [{ name: { equals: input.name, mode: "insensitive" as const } }] : []),
        ...(input.domain ? [{ domain: { equals: input.domain, mode: "insensitive" as const } }] : [])
      ]
    }
  });
  return organizations.map(organizationCandidate);
}

function personCandidate(person: {
  email: string | null;
  firstName: string;
  id: string;
  lastName: string | null;
  organization?: { name: string } | null;
  owner?: { email: string; name: string | null } | null;
  phone?: string | null;
}): AssistantDraftActionCandidate {
  const label = formatPersonName(person) ?? person.email ?? "Unnamed contact";
  return {
    detail: [person.email, person.phone, person.organization?.name, userLabel(person.owner)].filter(Boolean).join(" · ") || undefined,
    href: `/contacts/${person.id}`,
    id: person.id,
    label,
    type: "person"
  };
}

function organizationCandidate(organization: { domain: string | null; id: string; name: string; owner?: { email: string; name: string | null } | null }): AssistantDraftActionCandidate {
  return {
    detail: [organization.domain, userLabel(organization.owner)].filter(Boolean).join(" · ") || undefined,
    href: `/organizations/${organization.id}`,
    id: organization.id,
    label: organization.name,
    type: "organization"
  };
}

function userLabel(user: { email: string; name: string | null } | null | undefined) {
  return user ? `Owner: ${user.name || user.email}` : "";
}

function matchResult(candidates: AssistantDraftActionCandidate[], target: string, label: string) {
  const exactCandidates = candidates.filter((candidate) => normalize(candidate.label) === normalize(target));
  if (exactCandidates.length === 1) return { candidates, confidence: "high" as const, selected: exactCandidates[0], warnings: [] };
  if (candidates.length === 1) return { candidates, confidence: "medium" as const, selected: candidates[0], warnings: [] };
  if (candidates.length > 1) {
    return {
      candidates,
      confidence: "needs_clarification" as const,
      selected: undefined,
      warnings: [`Multiple ${label} matches found. Review candidates before applying this draft.`]
    };
  }
  return { candidates, confidence: "low" as const, selected: undefined, warnings: [] };
}

function personSearchWhere(target: string, terms: string[]): Prisma.PersonWhereInput[] {
  return [
    { email: { contains: target, mode: "insensitive" } },
    { firstName: { contains: target, mode: "insensitive" } },
    { lastName: { contains: target, mode: "insensitive" } },
    ...terms.flatMap((term): Prisma.PersonWhereInput[] => [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } }
    ])
  ];
}

function summarizeRelationshipFact(fact: string, target: string | undefined) {
  const cleaned = cleanTrailingPunctuation(fact.replace(/^that\s+/i, ""));
  if (!cleaned) return "";
  const firstName = target?.split(/\s+/)[0] ?? "They";
  const lower = cleaned.toLowerCase();
  const travelMatch = lower.match(/\b(?:she|he|they|is|are)?\s*(?:is|are)?\s*going\s+on\s+vacation\s+to\s+(.+?)(?:\s+in\s+(\d+)\s+weeks?)?(?:\s+with\s+(?:her|his|their)\s+family)?$/i);
  if (travelMatch) {
    const place = sentenceCase(travelMatch[1] ?? "").replace(/\s+with\s+family$/i, "");
    const weeks = travelMatch[2] ? ` in about ${numberWord(Number(travelMatch[2]))} weeks` : "";
    const family = /\bwith\s+(?:her|his|their)\s+family\b/i.test(cleaned) ? " with family" : "";
    return `${firstName} mentioned ${pronounFor(cleaned)} will be traveling to ${place}${family}${weeks}.`;
  }
  const normalized = cleaned
    .replace(/\bI\s+/g, `${firstName} `)
    .replace(/\bmy\s+/g, "their ")
    .replace(/\s+/g, " ");
  return `${firstName} mentioned ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}.`;
}

function emptyMatch() {
  return {
    candidates: [] as AssistantDraftActionCandidate[],
    confidence: "low" as const,
    selected: undefined as AssistantDraftActionCandidate | undefined,
    warnings: [] as string[]
  };
}

function clarificationForDraft(
  intent: CrmRecordChangeParseResult,
  resolved: CrmRecordChangeResolution,
  slots: AssistantDraftClarificationSlot[]
): AssistantDraftActionClarification | undefined {
  const resolvedSlots = slots;
  if (resolvedSlots.length === 0 && !resolved.personId && !resolved.organizationId) return undefined;
  return {
    intent,
    resolved: Object.keys(resolved).length > 0 ? resolved : undefined,
    resolutionKey: resolutionKeyForIntent(intent, resolved),
    slots: resolvedSlots,
    status: resolvedSlots.some((slot) => !slot.selectedRecordId) ? "needs_selection" : "resolved"
  };
}

function unavailableClarificationDraft(draft: AssistantDraftAction, message: string): AssistantDraftAction {
  return {
    applyState: "disabled",
    candidates: [],
    clarification: draft.clarification ? { ...draft.clarification, status: "needs_selection" } : undefined,
    confidence: "needs_clarification",
    evidence: draft.evidence,
    fields: draft.fields.length > 0 ? draft.fields : [{ label: "Requested change", value: draft.title }],
    id: `${draft.id}-clarification-unavailable`,
    kind: draft.kind,
    missingInfo: [message],
    reviewLabel: "Draft only",
    targetHref: undefined,
    targetKind: draft.targetKind,
    targetLabel: draft.targetLabel,
    title: draft.title,
    warnings: ["No CRM Change Proposal was created."]
  };
}

function resolutionKeyForIntent(intent: CrmRecordChangeParseResult, resolved: CrmRecordChangeResolution) {
  return `assistant-clarification:${createHash("sha256").update(JSON.stringify({ intent, resolved })).digest("hex")}`;
}

function sanitizeEvidence(value: string) {
  return redactSensitiveText(value).trim().replace(/\s+/g, " ").slice(0, 500);
}

function normalizeTarget(value: string) {
  return sanitizeEvidence(value).slice(0, 120);
}

function explicitRecordId(value: string, resource: "contacts" | "organizations") {
  const directId = value.match(/^[A-Za-z0-9_-]{8,80}$/)?.[0] ?? "";
  const pathId = value.match(new RegExp(`/${resource}/([A-Za-z0-9_-]{8,80})(?:\\b|$)`))?.[1] ?? "";
  return pathId || directId;
}

function searchTerms(value: string) {
  return value.split(/\s+/).map((term) => cleanTrailingPunctuation(term)).filter((term) => term.length >= 2).slice(0, 5);
}

function cleanPossessive(value: string) {
  return cleanTrailingPunctuation(value.replace(/(?:'s|’s)$/i, ""));
}

function cleanTrailingPunctuation(value: string) {
  return value.trim().replace(/^[\s"'“”]+|[\s"'“”.!?;:,]+$/g, "");
}

function sentenceCase(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeComparableFieldValue(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function nextWeekday(now: Date, weekday: string) {
  const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekday);
  const start = startOfLocalDay(now);
  const delta = ((target - start.getDay() + 7) % 7) || 7;
  return addDays(start, delta);
}

function normalizeYear(value: number) {
  return value < 100 ? 2000 + value : value;
}

function formatDraftDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(value);
}

function formatPreferenceValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value).replace(/_/g, " ");
}

function preferenceLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function pronounFor(value: string) {
  if (/\bhe\b/i.test(value)) return "he";
  if (/\bthey\b/i.test(value)) return "they";
  return "she";
}

function numberWord(value: number) {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][value] ?? String(value);
}
