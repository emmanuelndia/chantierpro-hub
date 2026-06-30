-- CreateTable
CREATE TABLE "TeamAssignment" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamAssignment_pkey" PRIMARY KEY ("id")
);

-- Backfill existing teams as active assignments.
INSERT INTO "TeamAssignment" (
    "id",
    "teamId",
    "siteId",
    "supervisorId",
    "startDate",
    "endDate",
    "createdById",
    "createdAt"
)
SELECT
    concat('team_assign_', t."id"),
    t."id",
    t."siteId",
    t."teamLeadId",
    COALESCE(MIN(tm."assignmentDate"), t."createdAt"::date),
    NULL,
    t."createdById",
    CURRENT_TIMESTAMP
FROM "Team" t
LEFT JOIN "TeamMember" tm ON tm."teamId" = t."id"
GROUP BY t."id", t."siteId", t."teamLeadId", t."createdById", t."createdAt";

-- CreateIndex
CREATE INDEX "TeamAssignment_teamId_startDate_endDate_idx" ON "TeamAssignment"("teamId", "startDate", "endDate");
CREATE INDEX "TeamAssignment_siteId_startDate_idx" ON "TeamAssignment"("siteId", "startDate");
CREATE INDEX "TeamAssignment_supervisorId_startDate_idx" ON "TeamAssignment"("supervisorId", "startDate");
CREATE INDEX "TeamAssignment_createdById_idx" ON "TeamAssignment"("createdById");

-- AddForeignKey
ALTER TABLE "TeamAssignment" ADD CONSTRAINT "TeamAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamAssignment" ADD CONSTRAINT "TeamAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamAssignment" ADD CONSTRAINT "TeamAssignment_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamAssignment" ADD CONSTRAINT "TeamAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;