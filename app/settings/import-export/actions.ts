"use server";

import { revalidatePath } from "next/cache";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { redactSensitiveText } from "@/lib/security/redaction";
import type { WorkspaceActor } from "@/lib/services/workspace-access";
import {
  importDealsFromCsv,
  importContactsFromCsv,
  importLeadsFromCsv,
  importOrganizationsFromCsv,
  previewDealImport,
  type DealImportPreview,
  type DealImportResult,
  previewContactImport,
  type ContactImportPreview,
  type ContactImportResult,
  previewLeadImport,
  type LeadImportPreview,
  type LeadImportResult,
  previewOrganizationImport,
  type OrganizationImportPreview,
  type OrganizationImportResult
} from "@/lib/services/crm";

export type DealImportPreviewActionState = {
  csvText: string;
  preview?: DealImportPreview;
  result?: DealImportResult;
  error?: string;
};

export type ContactImportPreviewActionState = {
  csvText: string;
  preview?: ContactImportPreview;
  result?: ContactImportResult;
  error?: string;
};

export type OrganizationImportPreviewActionState = {
  csvText: string;
  preview?: OrganizationImportPreview;
  result?: OrganizationImportResult;
  error?: string;
};

export type LeadImportPreviewActionState = {
  csvText: string;
  preview?: LeadImportPreview;
  result?: LeadImportResult;
  error?: string;
};

type ImportActionState<TPreview, TResult> = {
  csvText: string;
  preview?: TPreview;
  result?: TResult;
  error?: string;
};

type ImportActionConfig<TPreview, TResult extends { preview: TPreview }> = {
  csvFieldName: string;
  failureMessage: string;
  revalidatePaths: string[];
  preview: (actor: WorkspaceActor, csvText: string) => Promise<TPreview>;
  importCsv: (actor: WorkspaceActor, csvText: string) => Promise<TResult>;
};

export async function previewDealImportAction(
  _previousState: DealImportPreviewActionState,
  formData: FormData
): Promise<DealImportPreviewActionState> {
  return runImportPreviewAction<DealImportPreview, DealImportResult>(formData, {
    csvFieldName: "dealCsv",
    failureMessage: "Deal import preview failed.",
    revalidatePaths: ["/deals", "/pipeline", "/settings/import-export"],
    preview: (actor, csvText) => previewDealImport(actor, csvText),
    importCsv: (actor, csvText) => importDealsFromCsv(actor, csvText)
  });
}

export async function previewOrganizationImportAction(
  _previousState: OrganizationImportPreviewActionState,
  formData: FormData
): Promise<OrganizationImportPreviewActionState> {
  return runImportPreviewAction<OrganizationImportPreview, OrganizationImportResult>(formData, {
    csvFieldName: "organizationCsv",
    failureMessage: "Organization import preview failed.",
    revalidatePaths: ["/organizations", "/settings/import-export"],
    preview: (actor, csvText) => previewOrganizationImport(actor, csvText),
    importCsv: (actor, csvText) => importOrganizationsFromCsv(actor, csvText)
  });
}

export async function previewContactImportAction(
  _previousState: ContactImportPreviewActionState,
  formData: FormData
): Promise<ContactImportPreviewActionState> {
  return runImportPreviewAction<ContactImportPreview, ContactImportResult>(formData, {
    csvFieldName: "contactCsv",
    failureMessage: "Contact import preview failed.",
    revalidatePaths: ["/contacts", "/settings/import-export"],
    preview: (actor, csvText) => previewContactImport(actor, csvText),
    importCsv: (actor, csvText) => importContactsFromCsv(actor, csvText)
  });
}

export async function previewLeadImportAction(
  _previousState: LeadImportPreviewActionState,
  formData: FormData
): Promise<LeadImportPreviewActionState> {
  return runImportPreviewAction<LeadImportPreview, LeadImportResult>(formData, {
    csvFieldName: "leadCsv",
    failureMessage: "Lead import preview failed.",
    revalidatePaths: ["/leads", "/settings/import-export"],
    preview: (actor, csvText) => previewLeadImport(actor, csvText),
    importCsv: (actor, csvText) => importLeadsFromCsv(actor, csvText)
  });
}

async function runImportPreviewAction<TPreview, TResult extends { preview: TPreview }>(
  formData: FormData,
  config: ImportActionConfig<TPreview, TResult>
): Promise<ImportActionState<TPreview, TResult>> {
  const csvText = String(formData.get(config.csvFieldName) ?? "");
  const intent = String(formData.get("intent") ?? "preview");

  try {
    const { actor } = await getCurrentWorkspaceContext();
    if (intent === "import") {
      const result = await config.importCsv(actor, csvText);
      for (const path of config.revalidatePaths) revalidatePath(path);
      return {
        csvText,
        preview: result.preview,
        result
      };
    }

    return {
      csvText,
      preview: await config.preview(actor, csvText)
    };
  } catch (error) {
    return {
      csvText,
      error: formatImportActionError(error, config.failureMessage)
    };
  }
}

function formatImportActionError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  return redactSensitiveText(error.message) || fallback;
}
