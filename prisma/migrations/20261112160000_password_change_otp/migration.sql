CREATE TABLE "PasswordChangeChallenge" (
    "userId" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "currentPasswordHash" TEXT NOT NULL,
    "newPasswordHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordChangeChallenge_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "PasswordChangeChallenge"
ADD CONSTRAINT "PasswordChangeChallenge_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
