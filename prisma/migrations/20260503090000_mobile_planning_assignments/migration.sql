-- CreateEnum
CREATE TYPE "PlanningAssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PlanningAssignment" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetProgress" INTEGER,
    "status" "PlanningAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PlanningAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanningAssignment_date_idx" ON "PlanningAssignment"("date");

-- CreateIndex
CREATE INDEX "PlanningAssignment_siteId_idx" ON "PlanningAssignment"("siteId");

-- CreateIndex
CREATE INDEX "PlanningAssignment_supervisorId_idx" ON "PlanningAssignment"("supervisorId");

-- CreateIndex
CREATE INDEX "PlanningAssignment_createdById_idx" ON "PlanningAssignment"("createdById");

-- CreateIndex
CREATE INDEX "PlanningAssignment_deletedAt_idx" ON "PlanningAssignment"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningAssignment_supervisor_date_active_key"
ON "PlanningAssignment"("supervisorId", "date")
WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "PlanningAssignment"
ADD CONSTRAINT "PlanningAssignment_supervisorId_fkey"
FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningAssignment"
ADD CONSTRAINT "PlanningAssignment_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningAssignment"
ADD CONSTRAINT "PlanningAssignment_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
