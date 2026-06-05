-- CreateTable
CREATE TABLE "GeneralSupervisorProjectScope" (
    "id" TEXT NOT NULL,
    "generalSupervisorId" TEXT NOT NULL,
    "projectManagerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "GeneralSupervisorSiteScopeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneralSupervisorProjectScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneralSupervisorProjectScope_generalSupervisorId_projectId_startDate_key" ON "GeneralSupervisorProjectScope"("generalSupervisorId", "projectId", "startDate");

-- CreateIndex
CREATE INDEX "GeneralSupervisorProjectScope_generalSupervisorId_status_idx" ON "GeneralSupervisorProjectScope"("generalSupervisorId", "status");

-- CreateIndex
CREATE INDEX "GeneralSupervisorProjectScope_projectManagerId_status_idx" ON "GeneralSupervisorProjectScope"("projectManagerId", "status");

-- CreateIndex
CREATE INDEX "GeneralSupervisorProjectScope_projectId_status_idx" ON "GeneralSupervisorProjectScope"("projectId", "status");

-- CreateIndex
CREATE INDEX "GeneralSupervisorProjectScope_startDate_idx" ON "GeneralSupervisorProjectScope"("startDate");

-- CreateIndex
CREATE INDEX "GeneralSupervisorProjectScope_endDate_idx" ON "GeneralSupervisorProjectScope"("endDate");

-- AddForeignKey
ALTER TABLE "GeneralSupervisorProjectScope" ADD CONSTRAINT "GeneralSupervisorProjectScope_generalSupervisorId_fkey" FOREIGN KEY ("generalSupervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralSupervisorProjectScope" ADD CONSTRAINT "GeneralSupervisorProjectScope_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralSupervisorProjectScope" ADD CONSTRAINT "GeneralSupervisorProjectScope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
