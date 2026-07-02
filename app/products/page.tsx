import { ActionGroup } from "@/components/action-group";
import { AppShell } from "@/components/app-shell";
import { CompactTitleRow } from "@/components/compact-title-row";
import { EmptyState } from "@/components/empty-state";
import { formatDate, formatMoney } from "@/components/format";
import { ListExportLink } from "@/components/list-export-link";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { ProductCreateForm } from "@/components/product-create-form";
import { ProductStatusButton } from "@/components/product-status-button";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { listProducts } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const products = await listProducts(actor);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <ListExportLink
            label="Export products"
            matchingCount={products.length}
            resource="products"
            searchParams={{}}
            workspaceId={workspace.id}
          />
        }
        eyebrow="Catalog"
        subtitle="Manage reusable pricing inputs for deal line items without rewriting historical quotes."
        title="Products"
      />

      <section className="panel section-separated">
        <PanelTitleRow
          description="Products provide snapshot pricing for deal line items. Product changes do not rewrite existing deal line items."
          title="Create Product"
        />
        <ProductCreateForm workspaceId={workspace.id} />
      </section>

      <section className="panel">
        <PanelTitleRow
          actions={<span className="badge">{products.length} total</span>}
          title="Product Catalog"
        />
        {products.length > 0 ? (
          <div className="product-catalog-grid">
            {products.map((product) => {
              const productActionsLabel = `${product.name} product actions`;

              return (
                <article className="product-catalog-card" key={product.id}>
                  <CompactTitleRow
                    actions={
                      <span className="badge">
                        {product.active ? "Active" : "Inactive"}
                      </span>
                    }
                    description={product.description ?? "No description"}
                    title={product.name}
                  />
                  <div className="deal-context-metrics">
                    <div>
                      <span>Unit price</span>
                      <strong>
                        {formatMoney(product.unitPriceCents, product.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>Created</span>
                      <strong>{formatDate(product.createdAt)}</strong>
                    </div>
                  </div>
                  <ProductCreateForm
                    initialProduct={{
                      id: product.id,
                      name: product.name,
                      description: product.description,
                      unitPriceCents: product.unitPriceCents,
                      currency: product.currency,
                    }}
                    mode="edit"
                    variant="compact"
                    workspaceId={workspace.id}
                  />
                  <ActionGroup className="product-card-actions" label={productActionsLabel}>
                    <ProductStatusButton
                      active={product.active}
                      productId={product.id}
                      productName={product.name}
                      workspaceId={workspace.id}
                    />
                  </ActionGroup>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            className="empty-state-compact"
            description="Create a product to add reusable pricing to deal line items and quote drafts."
            title="No products yet"
          />
        )}
      </section>
    </AppShell>
  );
}
