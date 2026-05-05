CREATE TYPE "RhExportFormat" AS ENUM ('CSV', 'XLSX');

CREATE TABLE "RhExportHistory" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "format" "RhExportFormat" NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RhExportHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RhExportHistory_createdById_idx" ON "RhExportHistory"("createdById");
CREATE INDEX "RhExportHistory_createdAt_idx" ON "RhExportHistory"("createdAt");

ALTER TABLE "RhExportHistory" ADD CONSTRAINT "RhExportHistory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
