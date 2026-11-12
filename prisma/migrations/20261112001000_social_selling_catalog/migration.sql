ALTER TABLE "Product"
ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN "facebook_post_id" TEXT,
ADD COLUMN "facebook_published_at" TIMESTAMP(3);

CREATE TABLE "ProductColor" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initial" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    CONSTRAINT "ProductColor_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderItem"
ADD COLUMN "productColorId" TEXT;

CREATE TABLE "FacebookPendingOrder" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FacebookPendingOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductColor_productId_name_key"
ON "ProductColor"("productId", "name");

CREATE UNIQUE INDEX "FacebookPendingOrder_senderId_key"
ON "FacebookPendingOrder"("senderId");

ALTER TABLE "ProductColor"
ADD CONSTRAINT "ProductColor_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_productColorId_fkey"
FOREIGN KEY ("productColorId") REFERENCES "ProductColor"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacebookPendingOrder"
ADD CONSTRAINT "FacebookPendingOrder_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
