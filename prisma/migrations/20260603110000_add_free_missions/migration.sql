DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FreeMissionStatus') THEN
    CREATE TYPE "FreeMissionStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
  END IF;
END $$;

ALTER TYPE "PlanningWorkLocationType" ADD VALUE IF NOT EXISTS 'FREE_MISSION';

CREATE TABLE IF NOT EXISTS "FreeMission" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "assigneeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "action" TEXT NOT NULL,
  "objectiveText" TEXT,
  "status" "FreeMissionStatus" NOT NULL DEFAULT 'ASSIGNED',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "FreeMission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FreeMission"
  ADD CONSTRAINT "FreeMission_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FreeMission"
  ADD CONSTRAINT "FreeMission_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FreeMission"
  ADD CONSTRAINT "FreeMission_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "FreeMission_projectId_idx" ON "FreeMission"("projectId");
CREATE INDEX IF NOT EXISTS "FreeMission_assigneeId_idx" ON "FreeMission"("assigneeId");
CREATE INDEX IF NOT EXISTS "FreeMission_date_idx" ON "FreeMission"("date");
CREATE INDEX IF NOT EXISTS "FreeMission_createdById_idx" ON "FreeMission"("createdById");
CREATE INDEX IF NOT EXISTS "FreeMission_deletedAt_idx" ON "FreeMission"("deletedAt");

ALTER TABLE "ClockInRecord" ADD COLUMN IF NOT EXISTS "freeMissionId" TEXT;
ALTER TABLE "ClockInRecord" ALTER COLUMN "siteId" DROP NOT NULL;
ALTER TABLE "ClockInRecord"
  ADD CONSTRAINT "ClockInRecord_freeMissionId_fkey"
  FOREIGN KEY ("freeMissionId") REFERENCES "FreeMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ClockInRecord_freeMissionId_idx" ON "ClockInRecord"("freeMissionId");
CREATE INDEX IF NOT EXISTS "ClockInRecord_userId_freeMissionId_clockInDate_idx" ON "ClockInRecord"("userId", "freeMissionId", "clockInDate");

ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "freeMissionId" TEXT;
ALTER TABLE "Report" ALTER COLUMN "siteId" DROP NOT NULL;
ALTER TABLE "Report"
  ADD CONSTRAINT "Report_freeMissionId_fkey"
  FOREIGN KEY ("freeMissionId") REFERENCES "FreeMission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Report_freeMissionId_idx" ON "Report"("freeMissionId");

ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "freeMissionId" TEXT;
ALTER TABLE "Photo" ALTER COLUMN "siteId" DROP NOT NULL;
ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_freeMissionId_fkey"
  FOREIGN KEY ("freeMissionId") REFERENCES "FreeMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Photo_freeMissionId_idx" ON "Photo"("freeMissionId");
