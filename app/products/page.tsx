import { AppShell } from "@/components/app-shell";
import { formatDate, formatMoney } from "@/components/format";
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
      <header className="page-header">
        <div>
          <p className="page-kicker">Catalog</p>
          <h1 className="page-title">Products</h1>
        </div>
      </header>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2 className="panel-title">Create Product</h2>
        <p className="empty-copy" style={{ marginBottom: 16 }}>
          Products provide snapshot pricing for deal line items. Product changes do not rewrite existing deal line items.
        </p>
        <ProductCreateForm workspaceId={workspace.id} />
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">Product Catalog</h2>
          <span className="badge">{products.length} total</span>
        </div>
        {products.length > 0 ? (
          <div className="product-catalog-grid">
            {products.map((product) => (
              <article className="product-catalog-card" key={product.id}>
                <div className="panel-title-row">
                  <div>
                    <h3 className="compact-title">{product.name}</h3>
                    <p className="empty-copy">{product.description ?? "No description"}</p>
                  </div>
                  <span className="badge">{product.active ? "Active" : "Inactive"}</span>
                </div>
                <div className="deal-context-metrics">
                  <div>
                    <span>Unit price</span>
                    <strong>{formatMoney(product.unitPriceCents, product.currency)}</strong>
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
                    currency: product.currency
                  }}
                  mode="edit"
                  variant="compact"
                  workspaceId={workspace.id}
                />
                <div className="form-actions">
                  <ProductStatusButton active={product.active} productId={product.id} workspaceId={workspace.id} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state-compact">
            <h3>No products yet</h3>
            <p>Create a product to add reusable pricing to deal line items and quote drafts.</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
