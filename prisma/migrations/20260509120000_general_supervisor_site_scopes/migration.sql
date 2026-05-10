-- CreateEnum
CREATE TYPE "GeneralSupervisorSiteScopeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "GeneralSupervisorSiteScope" (
    "id" TEXT NOT NULL,
    "generalSupervisorId" TEXT NOT NULL,
    "projectManagerId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "GeneralSupervisorSiteScopeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneralSupervisorSiteScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneralSupervisorSiteScope_generalSupervisorId_status_idx" ON "GeneralSupervisorSiteScope"("generalSupervisorId", "status");

-- CreateIndex
CREATE INDEX "GeneralSupervisorSiteScope_projectManagerId_status_idx" ON "GeneralSupervisorSiteScope"("projectManagerId", "status");

-- CreateIndex
CREATE INDEX "GeneralSupervisorSiteScope_siteId_status_idx" ON "GeneralSupervisorSiteScope"("siteId", "status");

-- CreateIndex
CREATE INDEX "GeneralSupervisorSiteScope_startDate_idx" ON "GeneralSupervisorSiteScope"("startDate");

-- CreateIndex
CREATE INDEX "GeneralSupervisorSiteScope_endDate_idx" ON "GeneralSupervisorSiteScope"("endDate");

-- AddForeignKey
ALTER TABLE "GeneralSupervisorSiteScope" ADD CONSTRAINT "GeneralSupervisorSiteScope_generalSupervisorId_fkey" FOREIGN KEY ("generalSupervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralSupervisorSiteScope" ADD CONSTRAINT "GeneralSupervisorSiteScope_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralSupervisorSiteScope" ADD CONSTRAINT "GeneralSupervisorSiteScope_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
