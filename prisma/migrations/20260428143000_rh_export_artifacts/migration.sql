-- AlterTable
ALTER TABLE "RhExportHistory"
ADD COLUMN "storageKey" TEXT,
ADD COLUMN "fileName" TEXT,
ADD COLUMN "contentType" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3);
