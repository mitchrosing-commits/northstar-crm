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
        <h2 className="panel-title">Product Catalog</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Unit price</th>
              <th>Status</th>
              <th>Created</th>
              <th>Edit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {products.length > 0 ? (
              products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                  </td>
                  <td>{product.description ?? ""}</td>
                  <td>{formatMoney(product.unitPriceCents, product.currency)}</td>
                  <td>
                    <span className="badge">{product.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td>{formatDate(product.createdAt)}</td>
                  <td style={{ minWidth: 360 }}>
                    <ProductCreateForm
                      initialProduct={{
                        id: product.id,
                        name: product.name,
                        description: product.description,
                        unitPriceCents: product.unitPriceCents,
                        currency: product.currency
                      }}
                      mode="edit"
                      workspaceId={workspace.id}
                    />
                  </td>
                  <td>
                    <ProductStatusButton active={product.active} productId={product.id} workspaceId={workspace.id} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No products have been created. Create one to add deal line items.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
