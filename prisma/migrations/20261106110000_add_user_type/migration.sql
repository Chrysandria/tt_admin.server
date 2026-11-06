CREATE TYPE "UserType" AS ENUM ('admin', 'user');

ALTER TABLE "User"
ADD COLUMN "type" "UserType" NOT NULL DEFAULT 'user';

UPDATE "User"
SET "type" = 'admin'
WHERE LOWER("profil") = 'admin';
