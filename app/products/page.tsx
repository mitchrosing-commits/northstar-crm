import Link from "next/link";

import { ActionGroup } from "@/components/action-group";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { CountBadge } from "@/components/count-badge";
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
          <>
            <Link className="button-secondary" href="/deals?commercial=valueNoLineItems">
              Find deals to scope
            </Link>
            <ListExportLink
              label="Export products"
              matchingCount={products.length}
              resource="products"
              searchParams={{}}
              workspaceId={workspace.id}
            />
          </>
        }
        eyebrow="Products and services"
        subtitle="Manage the products, services, packages, and reusable pricing your company sells. Reps add these to deals as line items, then quote drafts copy those snapshots without rewriting historical quotes."
        title="Products"
      />

      <section className="panel product-flow-guide" aria-labelledby="product-flow-guide-title">
        <PanelTitleRow
          description="Use this catalog as the source for what your company sells. Deal line items copy the product name, description, price, and currency at the time they are added; quote drafts then freeze those line items for review."
          title="How Products Feed Quotes"
          titleId="product-flow-guide-title"
        />
        <div className="product-flow-steps">
          <div>
            <span>1</span>
            <strong>Catalog</strong>
            <p>Define products, services, packages, and standard pricing.</p>
          </div>
          <div>
            <span>2</span>
            <strong>Deal scope</strong>
            <p>Add active products to open deals as line items.</p>
          </div>
          <div>
            <span>3</span>
            <strong>Quote draft</strong>
            <p>Create an internal quote snapshot from the deal line items.</p>
          </div>
        </div>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          description="Create reusable products, services, or packages for what your company offers. Prices are copied into deal line items as snapshots, so later product changes do not rewrite existing deals or quotes."
          title="Create Product"
        />
        <ProductCreateForm workspaceId={workspace.id} />
      </section>

      <section className="panel">
        <PanelTitleRow
          actions={<CountBadge className="badge">{products.length} total</CountBadge>}
          description="Your sellable catalog for building deal scope, quote line items, and reusable pricing."
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
                      <Badge>
                        {product.active ? "Active" : "Inactive"}
                      </Badge>
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
            description="Create the first product, service, or package your company sells so reps can add reusable pricing to deal line items and quote drafts."
            title="No products yet"
          />
        )}
      </section>
    </AppShell>
  );
}
