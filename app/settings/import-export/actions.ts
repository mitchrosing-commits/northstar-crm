"use server";

import { revalidatePath } from "next/cache";

import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
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

export async function previewDealImportAction(
  _previousState: DealImportPreviewActionState,
  formData: FormData
): Promise<DealImportPreviewActionState> {
  const csvText = String(formData.get("dealCsv") ?? "");
  const intent = String(formData.get("intent") ?? "preview");

  try {
    const { actor } = await getCurrentWorkspaceContext();
    if (intent === "import") {
      const result = await importDealsFromCsv(actor, csvText);
      revalidatePath("/deals");
      revalidatePath("/pipeline");
      revalidatePath("/settings/import-export");
      return {
        csvText,
        preview: result.preview,
        result
      };
    }

    return {
      csvText,
      preview: await previewDealImport(actor, csvText)
    };
  } catch (error) {
    return {
      csvText,
      error: error instanceof Error ? error.message : "Deal import preview failed."
    };
  }
}

export async function previewOrganizationImportAction(
  _previousState: OrganizationImportPreviewActionState,
  formData: FormData
): Promise<OrganizationImportPreviewActionState> {
  const csvText = String(formData.get("organizationCsv") ?? "");
  const intent = String(formData.get("intent") ?? "preview");

  try {
    const { actor } = await getCurrentWorkspaceContext();
    if (intent === "import") {
      const result = await importOrganizationsFromCsv(actor, csvText);
      revalidatePath("/organizations");
      revalidatePath("/settings/import-export");
      return {
        csvText,
        preview: result.preview,
        result
      };
    }

    return {
      csvText,
      preview: await previewOrganizationImport(actor, csvText)
    };
  } catch (error) {
    return {
      csvText,
      error: error instanceof Error ? error.message : "Organization import preview failed."
    };
  }
}

export async function previewContactImportAction(
  _previousState: ContactImportPreviewActionState,
  formData: FormData
): Promise<ContactImportPreviewActionState> {
  const csvText = String(formData.get("contactCsv") ?? "");
  const intent = String(formData.get("intent") ?? "preview");

  try {
    const { actor } = await getCurrentWorkspaceContext();
    if (intent === "import") {
      const result = await importContactsFromCsv(actor, csvText);
      revalidatePath("/contacts");
      revalidatePath("/settings/import-export");
      return {
        csvText,
        preview: result.preview,
        result
      };
    }

    return {
      csvText,
      preview: await previewContactImport(actor, csvText)
    };
  } catch (error) {
    return {
      csvText,
      error: error instanceof Error ? error.message : "Contact import preview failed."
    };
  }
}

export async function previewLeadImportAction(
  _previousState: LeadImportPreviewActionState,
  formData: FormData
): Promise<LeadImportPreviewActionState> {
  const csvText = String(formData.get("leadCsv") ?? "");
  const intent = String(formData.get("intent") ?? "preview");

  try {
    const { actor } = await getCurrentWorkspaceContext();
    if (intent === "import") {
      const result = await importLeadsFromCsv(actor, csvText);
      revalidatePath("/leads");
      revalidatePath("/settings/import-export");
      return {
        csvText,
        preview: result.preview,
        result
      };
    }

    return {
      csvText,
      preview: await previewLeadImport(actor, csvText)
    };
  } catch (error) {
    return {
      csvText,
      error: error instanceof Error ? error.message : "Lead import preview failed."
    };
  }
}
