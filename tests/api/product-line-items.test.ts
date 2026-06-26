import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const productService = readFileSync(join(process.cwd(), "lib/services/product-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const workspaceRoute = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const validators = readFileSync(join(process.cwd(), "lib/validators/crm.ts"), "utf8");
const appShell = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
const productsPage = readFileSync(join(process.cwd(), "app/products/page.tsx"), "utf8");
const productForm = readFileSync(join(process.cwd(), "components/product-create-form.tsx"), "utf8");
const productStatusButton = readFileSync(join(process.cwd(), "components/product-status-button.tsx"), "utf8");
const dealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const lineItemsPanel = readFileSync(join(process.cwd(), "components/deal-line-items-panel.tsx"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");

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
    expect(productService).toContain("lineTotalCents: product.unitPriceCents * input.quantity");
    expect(productService).toContain("productName: product.name");
    expect(productService).toContain("where: { id: input.productId, workspaceId: actor.workspaceId, active: true");
    expect(productService).toContain("description: input.description?.trim() || product.description");
    expect(productService).not.toContain("valueCents:");
    expect(productService).toContain("deal_line_item.created");
    expect(productService).toContain("deal_line_item.removed");
    expect(productService).toContain("product.updated");
    expect(productService).toContain("product.deactivated");
    expect(productService).toContain("product.reactivated");
    expect(crmBarrel).toContain("product-service");
  });

  it("routes product and line-item mutations through the workspace API", () => {
    expect(workspaceRoute).toContain("resource === \"products\"");
    expect(workspaceRoute).toContain("listProducts(actor)");
    expect(workspaceRoute).toContain("createProduct(actor, createProductSchema.parse");
    expect(workspaceRoute).toContain("updateProduct(actor, idOrNested, updateProductSchema.parse");
    expect(workspaceRoute).toContain("setProductActive(actor, idOrNested, false)");
    expect(workspaceRoute).toContain("setProductActive(actor, idOrNested, true)");
    expect(workspaceRoute).toContain("nestedResource === \"line-items\"");
    expect(workspaceRoute).toContain("createDealLineItem(actor, { dealId: idOrNested");
    expect(workspaceRoute).toContain("resource === \"deal-line-items\"");
    expect(workspaceRoute).toContain("removeDealLineItem(actor, idOrNested)");
    expect(validators).toContain("createProductSchema");
    expect(validators).toContain("createDealLineItemSchema");
  });

  it("adds simple product and deal-detail line-item UI without syncing deal value", () => {
    expect(appShell).toContain("label: \"Products\"");
    expect(appShell).toContain("href: \"/products\"");
    expect(productsPage).toContain("<ProductCreateForm");
    expect(productsPage).toContain("<ProductStatusButton");
    expect(productsPage).toContain("Product Catalog");
    expect(productForm).toContain("/api/v1/workspaces/${workspaceId}/products");
    expect(productForm).toContain("mode === \"create\" ? \"POST\" : \"PATCH\"");
    expect(productStatusButton).toContain("/products/${productId}/${action}");
    expect(dealPage).toContain("<DealLineItemsPanel");
    expect(dealPage).toContain("listProducts(actor)");
    expect(lineItemsPanel).toContain("Line items snapshot active product pricing when added.");
    expect(lineItemsPanel).toContain("They stay separate from deal value, reporting totals, and Forecasting v1 until an accepted quote is manually synced.");
    expect(lineItemsPanel).toContain("Line item total");
    expect(lineItemsPanel).toContain("Create or reactivate a product before adding line items to this deal.");
    expect(lineItemsPanel).toContain("/deals/${dealId}/line-items");
    expect(lineItemsPanel).toContain("/deal-line-items/${lineItemId}");
  });

  it("documents the current catalog limitations", () => {
    expect(currentStatus).toContain("Product Catalog");
    expect(currentStatus).toContain("deactivation/reactivation");
    expect(currentStatus).toContain("Line item totals do not overwrite deal value");
    expect(currentStatus).toContain("Forecasting v1 is open-deal-only and current-state-only");
    expect(architecture).toContain("Products are workspace-scoped");
    expect(architecture).toContain("Products can be edited and deactivated/reactivated");
    expect(architecture).toContain("Deal line items snapshot product name, price, and currency");
  });
});
