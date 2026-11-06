CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

INSERT INTO "OrderItem" ("id", "orderId", "productId", "quantity")
SELECT "id", "id", "productId", "quantity"
FROM "Order";

ALTER TABLE "Order" DROP CONSTRAINT "Order_productId_fkey";
ALTER TABLE "Order" DROP COLUMN "productId";
ALTER TABLE "Order" DROP COLUMN "quantity";

CREATE UNIQUE INDEX "OrderItem_orderId_productId_key"
ON "OrderItem"("orderId", "productId");

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
