/*
  Warnings:

  - The values [ACCOUNT_DELETE] on the enum `OtpPurpose` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `expected_phone_hmac` on the `tests` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OtpPurpose_new" AS ENUM ('PASSWORD_RESET', 'SIGN_IN', 'SIGN_UP', 'PHONE_CHANGE', 'INVITATION_ACCEPTANCE', 'PAYOUT_CONFIRMATION');
ALTER TABLE "otp_challenges" ALTER COLUMN "purpose" TYPE "OtpPurpose_new" USING ("purpose"::text::"OtpPurpose_new");
ALTER TYPE "OtpPurpose" RENAME TO "OtpPurpose_old";
ALTER TYPE "OtpPurpose_new" RENAME TO "OtpPurpose";
DROP TYPE "public"."OtpPurpose_old";
COMMIT;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "recipient_verified_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "tests" DROP COLUMN "expected_phone_hmac";

-- CreateTable
CREATE TABLE "user_phones" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone_hmac" VARCHAR(128) NOT NULL,
    "phone_enc" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_expected_phones" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "phone_hmac" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_expected_phones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_phones_user_id_verified_at_idx" ON "user_phones"("user_id", "verified_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_phones_user_id_phone_hmac_key" ON "user_phones"("user_id", "phone_hmac");

-- CreateIndex
CREATE INDEX "test_expected_phones_test_id_idx" ON "test_expected_phones"("test_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_expected_phones_test_id_phone_hmac_key" ON "test_expected_phones"("test_id", "phone_hmac");

-- AddForeignKey
ALTER TABLE "user_phones" ADD CONSTRAINT "user_phones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_expected_phones" ADD CONSTRAINT "test_expected_phones_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
