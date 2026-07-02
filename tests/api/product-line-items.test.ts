import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const productService = readFileSync(
  join(process.cwd(), "lib/services/product-service.ts"),
  "utf8",
);
const crmBarrel = readFileSync(
  join(process.cwd(), "lib/services/crm.ts"),
  "utf8",
);
const workspaceRoute = readFileSync(
  join(
    process.cwd(),
    "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts",
  ),
  "utf8",
);
const validators = readFileSync(
  join(process.cwd(), "lib/validators/crm.ts"),
  "utf8",
);
const productLimits = readFileSync(
  join(process.cwd(), "lib/product-limits.ts"),
  "utf8",
);
const primaryNav = readFileSync(
  join(process.cwd(), "components/primary-nav.tsx"),
  "utf8",
);
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const productsPage = readFileSync(
  join(process.cwd(), "app/products/page.tsx"),
  "utf8",
);
const productForm = readFileSync(
  join(process.cwd(), "components/product-create-form.tsx"),
  "utf8",
);
const productStatusButton = readFileSync(
  join(process.cwd(), "components/product-status-button.tsx"),
  "utf8",
);
const dealPage = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/page.tsx"),
  "utf8",
);
const lineItemsPanel = readFileSync(
  join(process.cwd(), "components/deal-line-items-panel.tsx"),
  "utf8",
);
const commercialPanel = readFileSync(
  join(process.cwd(), "components/commercial-workflow-panel.tsx"),
  "utf8",
);
const lockedPanelNotice = readFileSync(
  join(process.cwd(), "components/locked-panel-notice.tsx"),
  "utf8",
);
const panelTitleRow = readFileSync(
  join(process.cwd(), "components/panel-title-row.tsx"),
  "utf8",
);
const compactTitleRow = readFileSync(
  join(process.cwd(), "components/compact-title-row.tsx"),
  "utf8",
);
const tableScroll = readFileSync(
  join(process.cwd(), "components/table-scroll.tsx"),
  "utf8",
);
const globalStyles = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8",
);
const currentStatus = readFileSync(
  join(process.cwd(), "docs/current-status.md"),
  "utf8",
);
const architecture = readFileSync(
  join(process.cwd(), "docs/architecture.md"),
  "utf8",
);

describe("product catalog and deal line items MVP", () => {
  it("adds workspace-scoped product and deal line item models", () => {
    expect(schema).toContain("model Product");
    expect(schema).toContain("model DealLineItem");
    expect(schema).toMatch(/unitPriceCents\s+Int/);
    expect(schema).toMatch(/lineTotalCents\s+Int/);
    expect(schema).toMatch(/productName\s+String/);
    expect(schema).toMatch(/lineItems\s+DealLineItem\[\]/);
    expect(schema).toContain("@@index([workspaceId, dealId])");
  });

  it("keeps product and line-item logic workspace-scoped and audited", () => {
    expect(productService).toContain("ensureWorkspaceAccess(actor)");
    expect(productService).toContain("listProducts");
    expect(productService).toContain("createProduct");
    expect(productService).toContain("updateProduct");
    expect(productService).toContain("setProductActive");
    expect(productService).toContain("createDealLineItem");
    expect(productService).toContain("removeDealLineItem");
    expect(productService).toContain(
      "const lineTotalCents = product.unitPriceCents * lineItemInput.quantity",
    );
    expect(productService).toContain("lineTotalCents");
    expect(productService).toContain("productIntColumnMax");
    expect(productService).toContain("Line item quantity is too large.");
    expect(productService).toContain("Line item total is too large.");
    expect(productService).toContain("normalizeLineItemInput(input)");
    expect(productService).toContain("const input = objectInput(data)");
    expect(productService).toContain(
      "normalizeLineItemRelationId(input.dealId)",
    );
    expect(productService).toContain("Line item relation ids must be text.");
    expect(productService).toContain(
      "normalizeProductUnitPriceCents(input.unitPriceCents)",
    );
    expect(productService).toContain("Product unit price is too large.");
    expect(productService).toContain("normalizeProductActiveFlag(active)");
    expect(productService).toContain(
      "Product active flag must be true or false.",
    );
    expect(productService).toContain(
      "if (!productUpdateChanges(data, existing))",
    );
    expect(productService).toContain("productUpdateChanges(");
    expect(productService).toContain(
      "if (existing.active === activeFlag) return existing;",
    );
    expect(productService).toContain("productName: product.name");
    expect(productService).toContain(
      "where: { id: lineItemInput.productId, workspaceId: actor.workspaceId, active: true",
    );
    expect(productService).toContain(
      "deal: { workspaceId: actor.workspaceId, ...activeWhere }",
    );
    expect(productService).toContain("ensureDealIsOpen(lineItem.deal.status)");
    expect(productService).toContain("normalizeProductName(input.name)");
    expect(productService).toContain(
      "normalizeProductDescription(input.description)",
    );
    expect(productService).toContain("normalizeCurrency(input.currency)");
    expect(productService).toContain(
      "normalizeLineItemDescription(lineItemInput.description, product.description)",
    );
    expect(productService).toContain("Product description must be text.");
    expect(productService).toContain("Line item description must be text.");
    expect(productService).not.toContain("valueCents:");
    expect(productService).toContain("deal_line_item.created");
    expect(productService).toContain("deal_line_item.removed");
    expect(productService).toContain("product.updated");
    expect(productService).toContain("product.deactivated");
    expect(productService).toContain("product.reactivated");
    expect(crmBarrel).toContain("product-service");
  });

  it("routes product and line-item mutations through the workspace API", () => {
    expect(workspaceRoute).toContain('resource === "products"');
    expect(workspaceRoute).toContain("listProducts(actor)");
    expect(workspaceRoute).toContain(
      "createProduct(actor, createProductSchema.parse",
    );
    expect(workspaceRoute).toContain(
      "updateProduct(actor, idOrNested, updateProductSchema.parse",
    );
    expect(workspaceRoute).toContain(
      "setProductActive(actor, idOrNested, false)",
    );
    expect(workspaceRoute).toContain(
      "setProductActive(actor, idOrNested, true)",
    );
    expect(workspaceRoute).toContain('nestedResource === "line-items"');
    expect(workspaceRoute).toContain(
      "createDealLineItem(actor, { dealId: idOrNested",
    );
    expect(workspaceRoute).toContain('resource === "deal-line-items"');
    expect(workspaceRoute).toContain("removeDealLineItem(actor, idOrNested)");
    expect(validators).toContain("createProductSchema");
    expect(validators).toContain("createDealLineItemSchema");
    expect(validators).toContain("productIntColumnMax");
    expect(productLimits).toContain("intColumnMax = 2_147_483_647");
    expect(productLimits).toContain("productIntColumnMax = intColumnMax");
  });

  it("adds simple product and deal-detail line-item UI without syncing deal value", () => {
    expect(primaryNav).toContain("appShellNavigationManifest");
    expect(navigation).toContain('label: "Products"');
    expect(navigation).toContain('href: "/products"');
    expect(productsPage).toContain("<ProductCreateForm");
    expect(productsPage).toContain("<ProductStatusButton");
    expect(productsPage).toContain("Product Catalog");
    expect(productsPage).toContain("ListExportLink");
    expect(productsPage).toContain("Export products");
    expect(productsPage).toContain("matchingCount={products.length}");
    expect(productsPage).toContain('resource="products"');
    expect(productsPage).toContain("searchParams={{}}");
    expect(productsPage).toContain("workspaceId={workspace.id}");
    expect(productsPage).toContain(
      "Manage reusable pricing inputs for deal line items without rewriting historical quotes.",
    );
    expect(productsPage).toContain('className="panel section-separated"');
    expect(productsPage).toContain("PanelTitleRow");
    expect(productsPage).toContain('title="Create Product"');
    expect(productsPage).toContain(
      'description="Products provide snapshot pricing for deal line items.',
    );
    expect(productsPage).toContain(
      'actions={<span className="badge">{products.length} total</span>}',
    );
    expect(productsPage).toContain('title="Product Catalog"');
    expect(productsPage).toContain("EmptyState");
    expect(productsPage).toContain('title="No products yet"');
    expect(productsPage).toContain(
      'description="Create a product to add reusable pricing to deal line items and quote drafts."',
    );
    expect(productsPage).not.toContain(
      '<div className="empty-state empty-state-compact">',
    );
    expect(productsPage).not.toContain("panel-intro-copy");
    expect(productsPage).toContain("product-catalog-grid");
    expect(productsPage).toContain("product-catalog-card");
    expect(productsPage).toContain("product-card-actions");
    expect(productsPage).toContain(
      "const productActionsLabel = `${product.name} product actions`",
    );
    expect(productsPage).toContain("productName={product.name}");
    expect(productsPage).toContain("import { ActionGroup }");
    expect(productsPage).toContain('<ActionGroup className="product-card-actions" label={productActionsLabel}>');
    expect(productStatusButton).toContain("productName: string");
    expect(productStatusButton).toContain(
      "const actionLabel = active ? `Deactivate product ${productName}` : `Reactivate product ${productName}`",
    );
    expect(productStatusButton).toContain("aria-label={actionLabel}");
    expect(productStatusButton).toContain("title={actionLabel}");
    expect(compactTitleRow).toContain("export function CompactTitleRow");
    expect(productsPage).toContain("CompactTitleRow");
    expect(productsPage).toContain(
      'description={product.description ?? "No description"}',
    );
    expect(productsPage).toContain("actions={");
    expect(productsPage).toContain('className="badge"');
    expect(productsPage).toContain('product.active ? "Active" : "Inactive"');
    expect(productsPage).not.toContain(
      '<h3 className="compact-title">{product.name}</h3>',
    );
    expect(productsPage).toContain('variant="compact"');
    expect(productForm).toContain('variant?: "card" | "compact"');
    expect(productForm).toContain("product-edit-form");
    expect(productForm).toContain("FormActionBar");
    expect(productForm).toContain("import { FormFieldLabel }");
    expect(productForm).toContain(
      "<FormFieldLabel required>Name</FormFieldLabel>",
    );
    expect(productForm).toContain(
      "<FormFieldLabel required>Unit price</FormFieldLabel>",
    );
    expect(productForm).toContain(
      "<FormFieldLabel required>Currency</FormFieldLabel>",
    );
    expect(productForm).toContain(
      "<FormFieldLabel>Description</FormFieldLabel>",
    );
    expect(productForm).toContain('compact={variant === "compact"}');
    expect(productForm).toContain(
      "submitDisabled={!name.trim() || !unitPrice.trim()}",
    );
    expect(productForm).toContain(
      'submitLabel={mode === "create" ? "Create product" : "Save product"}',
    );
    expect(productForm).not.toContain('<div className="form-actions">');
    expect(globalStyles).toContain(".product-catalog-grid");
    expect(globalStyles).toContain(".product-catalog-card");
    expect(globalStyles).toContain(".product-card-actions");
    expect(globalStyles).toContain(".product-edit-form .form-grid");
    expect(productForm).toContain("/api/v1/workspaces/${workspaceId}/products");
    expect(productForm).toContain('mode === "create" ? "POST" : "PATCH"');
    expect(productStatusButton).toContain("import { FormErrorMessage }");
    expect(productStatusButton).toContain("/products/${productId}/${action}");
    expect(productStatusButton).toContain(
      "{error ? <FormErrorMessage compact>{error}</FormErrorMessage> : null}",
    );
    expect(productStatusButton).not.toContain(
      '<div className="compact-error">{error}</div>',
    );
    expect(dealPage).toContain("<DealLineItemsPanel");
    expect(dealPage).toContain('canEdit={deal.status === "OPEN"}');
    expect(dealPage).toContain('href: "#line-items" as Route');
    expect(dealPage).toContain("count: deal.lineItems.length");
    expect(dealPage).toContain('countLabel: { singular: "line item", plural: "line items" }');
    expect(dealPage).toContain("<DealCommercialSummaryPanel");
    expect(dealPage).toContain("summarizeDealCommercialReadiness");
    expect(dealPage).toContain("listProducts(actor)");
    expect(lineItemsPanel).toContain(
      "Line items snapshot active product pricing when added.",
    );
    expect(lineItemsPanel).toContain(
      "They stay separate from deal value, reporting totals, and Forecasting v1 until an accepted quote is manually synced.",
    );
    expect(lineItemsPanel).toContain("canEdit = true");
    expect(lineItemsPanel).toContain("if (!canEdit)");
    expect(lineItemsPanel).toContain("LockedPanelNotice");
    expect(lineItemsPanel).toContain(
      "Closed deals are locked. Line items are read-only.",
    );
    expect(lockedPanelNotice).toContain(
      'className="locked-panel-notice"',
    );
    expect(lockedPanelNotice).toContain("titleAttribute={title}");
    expect(lineItemsPanel).toContain('import { Badge } from "@/components/badge"');
    expect(lineItemsPanel).toContain('<Badge label={`Line item ${lineItem.productName} is locked`}>Locked</Badge>');
    expect(lineItemsPanel).toContain("Line item total");
    expect(lineItemsPanel).toContain('className="data-card section-spaced"');
    expect(lineItemsPanel).toContain('id="line-items"');
    expect(lineItemsPanel).toContain("PanelTitleRow");
    expect(lineItemsPanel).toContain('actions={<Badge label={`Line item total: ${totalLabel}`}>{totalLabel}</Badge>}');
    expect(lineItemsPanel).toContain(
      'description="Line items snapshot active product pricing when added.',
    );
    expect(lineItemsPanel).toContain('title="Line Items"');
    expect(lineItemsPanel).not.toContain("panel-intro-copy");
    expect(panelTitleRow).toContain("description?: ReactNode");
    expect(lineItemsPanel).toContain('aria-label="Deal line items table"');
    expect(lineItemsPanel).toContain("TableScroll");
    expect(tableScroll).toContain(
      'className={["table-scroll", className].filter(Boolean).join(" ")}',
    );
    expect(lineItemsPanel).toContain('className="table crm-list-table"');
    for (const dataLabel of [
      "Item",
      "Qty",
      "Unit price",
      "Total",
      "Action",
      "Line items",
    ]) {
      expect(lineItemsPanel).toContain(`data-label="${dataLabel}"`);
    }
    expect(lineItemsPanel).toContain('className="table-actions-cell"');
    expect(lineItemsPanel).toContain('className="table-primary-cell"');
    expect(lineItemsPanel).toContain('className="table-secondary-text"');
    expect(lineItemsPanel).toContain("import { InlineEmptyStateText }");
    expect(lineItemsPanel).toContain(
      "<InlineEmptyStateText>No line items have been added.</InlineEmptyStateText>",
    );
    expect(lineItemsPanel).toContain(
      "const removeLineItemLabel = `Remove line item ${lineItem.productName}`",
    );
    expect(lineItemsPanel).toContain("aria-label={removeLineItemLabel}");
    expect(lineItemsPanel).toContain("title={removeLineItemLabel}");
    expect(lineItemsPanel).toContain("EmptyState");
    expect(lineItemsPanel).toContain('title="No active products available"');
    expect(lineItemsPanel).toContain("deal-line-items-empty");
    expect(lineItemsPanel).toContain(
      "Create or reactivate a product before adding line items to this deal.",
    );
    expect(lineItemsPanel).not.toContain(
      '<p className="empty-copy section-spaced">',
    );
    expect(lineItemsPanel).toContain("import { FormFieldLabel }");
    expect(lineItemsPanel).toContain(
      "<FormFieldLabel required>Product</FormFieldLabel>",
    );
    expect(lineItemsPanel).toContain(
      "<FormFieldLabel required>Quantity</FormFieldLabel>",
    );
    expect(lineItemsPanel).toContain(
      "<FormFieldLabel>Description override</FormFieldLabel>",
    );
    expect(lineItemsPanel).toContain("/deals/${dealId}/line-items");
    expect(lineItemsPanel).toContain("/deal-line-items/${lineItemId}");
    expect(lineItemsPanel).toContain("FormActionBar");
    expect(lineItemsPanel).toContain('pendingLabel="Adding..."');
    expect(lineItemsPanel).toContain("submitDisabled={!selectedProduct}");
    expect(lineItemsPanel).toContain('submitLabel="Add line item"');
    expect(commercialPanel).toContain("Commercial Readiness");
    expect(commercialPanel).toContain("PanelTitleRow");
    expect(commercialPanel).toContain('eyebrow="Commercial workflow"');
    expect(commercialPanel).toContain('title="Commercial Readiness"');
    expect(commercialPanel).toContain('eyebrow="Quote readiness"');
    expect(commercialPanel).toContain('title="Send Review"');
    expect(commercialPanel).toContain("description={description}");
    expect(commercialPanel).not.toContain("panel-intro-copy");
    expect(commercialPanel).toContain("Review line items");
    expect(commercialPanel).toContain("Review quotes");
    expect(commercialPanel).toContain("Review SOW");
    expect(panelTitleRow).toContain("export function PanelTitleRow");
  });

  it("documents the current catalog limitations", () => {
    expect(currentStatus).toContain("Product Catalog");
    expect(currentStatus).toContain("deactivation/reactivation");
    expect(currentStatus).toContain(
      "Line item totals do not overwrite deal value",
    );
    expect(currentStatus).toContain(
      "Product prices, quantities, and computed line-item totals are validated against current integer storage limits.",
    );
    expect(currentStatus).toContain(
      "Forecasting v1 is open-deal-only and current-state-only",
    );
    expect(architecture).toContain("Products are workspace-scoped");
    expect(architecture).toContain(
      "Products can be edited, deactivated/reactivated, and exported",
    );
    expect(architecture).toContain(
      "Deal line items snapshot product name, price, and currency",
    );
    expect(architecture).toContain(
      "Product prices, line-item quantities, and computed line-item totals are rejected before they can overflow current integer storage.",
    );
  });
});
