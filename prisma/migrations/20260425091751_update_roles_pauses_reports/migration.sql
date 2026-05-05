/*
  Warnings:

  - The values [TECHNICIAN] on the enum `Role` will be removed. This migration
    remaps existing rows to SUPERVISOR before replacing the enum.
*/

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM (
    'SUPERVISOR',
    'COORDINATOR',
    'GENERAL_SUPERVISOR',
    'PROJECT_MANAGER',
    'DIRECTION',
    'HR',
    'ADMIN'
);
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User"
ALTER COLUMN "role" TYPE "Role_new"
USING (
    CASE
        WHEN "role"::text = 'TECHNICIAN' THEN 'SUPERVISOR'
        ELSE "role"::text
    END
)::"Role_new";
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
COMMIT;

-- AlterEnum
ALTER TYPE "ClockInType" ADD VALUE IF NOT EXISTS 'PAUSE_START';
ALTER TYPE "ClockInType" ADD VALUE IF NOT EXISTS 'PAUSE_END';

-- AlterTable
ALTER TABLE "ClockInRecord" ADD COLUMN "comment" TEXT;

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clockInRecordId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Report_clockInRecordId_key" ON "Report"("clockInRecordId");

-- CreateIndex
CREATE INDEX "Report_siteId_idx" ON "Report"("siteId");

-- CreateIndex
CREATE INDEX "Report_userId_idx" ON "Report"("userId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_clockInRecordId_fkey" FOREIGN KEY ("clockInRecordId") REFERENCES "ClockInRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
