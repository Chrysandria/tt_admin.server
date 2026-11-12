ALTER TABLE "Order"
ADD COLUMN "customer_name" TEXT,
ADD COLUMN "delivery_address" TEXT,
ADD COLUMN "customer_phone" TEXT,
ADD COLUMN "delivered_at" TIMESTAMP(3);
