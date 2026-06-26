-- Add workspace-scoped product catalog and deal line items.
CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "unitPriceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DealLineItem" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "productId" TEXT,
  "productName" TEXT NOT NULL,
  "description" TEXT,
  "quantity" INTEGER NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "lineTotalCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DealLineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Product_workspaceId_active_idx" ON "Product"("workspaceId", "active");
CREATE INDEX "Product_workspaceId_name_idx" ON "Product"("workspaceId", "name");
CREATE INDEX "DealLineItem_workspaceId_dealId_idx" ON "DealLineItem"("workspaceId", "dealId");
CREATE INDEX "DealLineItem_workspaceId_productId_idx" ON "DealLineItem"("workspaceId", "productId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DealLineItem" ADD CONSTRAINT "DealLineItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DealLineItem" ADD CONSTRAINT "DealLineItem_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DealLineItem" ADD CONSTRAINT "DealLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
