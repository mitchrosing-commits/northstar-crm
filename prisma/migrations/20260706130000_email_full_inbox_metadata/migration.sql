-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN "providerLabels" JSONB;
ALTER TABLE "EmailLog" ADD COLUMN "providerSnippet" TEXT;
