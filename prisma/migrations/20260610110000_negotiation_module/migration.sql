DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NegotiationAssignmentStatus') THEN
    CREATE TYPE "NegotiationAssignmentStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NegotiationSessionStatus') THEN
    CREATE TYPE "NegotiationSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'ANOMALY');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NegotiationVisitStatus') THEN
    CREATE TYPE "NegotiationVisitStatus" AS ENUM ('OK', 'EN_COURS', 'REFUS', 'ABSENT', 'A_REVISITER', 'LITIGE_TRAVAUX', 'AUTRE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "NegotiationBuilding" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "cluster" TEXT,
  "city" TEXT NOT NULL,
  "commune" TEXT,
  "plaque" TEXT,
  "habitation" TEXT,
  "name" TEXT NOT NULL,
  "contactInfo" TEXT,
  "level" TEXT,
  "targetEl" INTEGER,
  "actualEl" INTEGER,
  "longitude" DECIMAL(10,7),
  "latitude" DECIMAL(10,7),
  "layer" TEXT,
  "color" TEXT,
  "operatorPresence" TEXT,
  "negotiationStatus" TEXT,
  "remark" TEXT,
  "sourceImportName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NegotiationBuilding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NegotiationAssignment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "assigneeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "plannedZone" TEXT,
  "instruction" TEXT,
  "status" "NegotiationAssignmentStatus" NOT NULL DEFAULT 'PLANNED',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "NegotiationAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NegotiationSession" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL,
  "startLatitude" DECIMAL(10,7) NOT NULL,
  "startLongitude" DECIMAL(10,7) NOT NULL,
  "startAccuracy" DECIMAL(7,2),
  "endTime" TIMESTAMP(3),
  "endLatitude" DECIMAL(10,7),
  "endLongitude" DECIMAL(10,7),
  "endAccuracy" DECIMAL(7,2),
  "comment" TEXT,
  "status" "NegotiationSessionStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NegotiationSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NegotiationVisit" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "buildingId" TEXT,
  "projectId" TEXT NOT NULL,
  "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "buildingName" TEXT NOT NULL,
  "city" TEXT,
  "commune" TEXT,
  "contactInfo" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "accuracy" DECIMAL(7,2),
  "status" "NegotiationVisitStatus" NOT NULL,
  "remark" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NegotiationVisit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "negotiationVisitId" TEXT;

ALTER TABLE "NegotiationBuilding"
  ADD CONSTRAINT "NegotiationBuilding_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NegotiationAssignment"
  ADD CONSTRAINT "NegotiationAssignment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NegotiationAssignment"
  ADD CONSTRAINT "NegotiationAssignment_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NegotiationAssignment"
  ADD CONSTRAINT "NegotiationAssignment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NegotiationSession"
  ADD CONSTRAINT "NegotiationSession_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "NegotiationAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NegotiationSession"
  ADD CONSTRAINT "NegotiationSession_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NegotiationSession"
  ADD CONSTRAINT "NegotiationSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NegotiationVisit"
  ADD CONSTRAINT "NegotiationVisit_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "NegotiationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NegotiationVisit"
  ADD CONSTRAINT "NegotiationVisit_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "NegotiationBuilding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NegotiationVisit"
  ADD CONSTRAINT "NegotiationVisit_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NegotiationVisit"
  ADD CONSTRAINT "NegotiationVisit_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_negotiationVisitId_fkey"
  FOREIGN KEY ("negotiationVisitId") REFERENCES "NegotiationVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "NegotiationBuilding_projectId_idx" ON "NegotiationBuilding"("projectId");
CREATE INDEX IF NOT EXISTS "NegotiationBuilding_city_idx" ON "NegotiationBuilding"("city");
CREATE INDEX IF NOT EXISTS "NegotiationBuilding_commune_idx" ON "NegotiationBuilding"("commune");
CREATE INDEX IF NOT EXISTS "NegotiationBuilding_negotiationStatus_idx" ON "NegotiationBuilding"("negotiationStatus");
CREATE INDEX IF NOT EXISTS "NegotiationAssignment_projectId_idx" ON "NegotiationAssignment"("projectId");
CREATE INDEX IF NOT EXISTS "NegotiationAssignment_assigneeId_idx" ON "NegotiationAssignment"("assigneeId");
CREATE INDEX IF NOT EXISTS "NegotiationAssignment_date_idx" ON "NegotiationAssignment"("date");
CREATE INDEX IF NOT EXISTS "NegotiationAssignment_createdById_idx" ON "NegotiationAssignment"("createdById");
CREATE INDEX IF NOT EXISTS "NegotiationAssignment_deletedAt_idx" ON "NegotiationAssignment"("deletedAt");
CREATE INDEX IF NOT EXISTS "NegotiationSession_assignmentId_idx" ON "NegotiationSession"("assignmentId");
CREATE INDEX IF NOT EXISTS "NegotiationSession_projectId_idx" ON "NegotiationSession"("projectId");
CREATE INDEX IF NOT EXISTS "NegotiationSession_userId_idx" ON "NegotiationSession"("userId");
CREATE INDEX IF NOT EXISTS "NegotiationSession_date_idx" ON "NegotiationSession"("date");
CREATE INDEX IF NOT EXISTS "NegotiationSession_status_idx" ON "NegotiationSession"("status");
CREATE INDEX IF NOT EXISTS "NegotiationVisit_sessionId_idx" ON "NegotiationVisit"("sessionId");
CREATE INDEX IF NOT EXISTS "NegotiationVisit_buildingId_idx" ON "NegotiationVisit"("buildingId");
CREATE INDEX IF NOT EXISTS "NegotiationVisit_projectId_idx" ON "NegotiationVisit"("projectId");
CREATE INDEX IF NOT EXISTS "NegotiationVisit_createdById_idx" ON "NegotiationVisit"("createdById");
CREATE INDEX IF NOT EXISTS "NegotiationVisit_status_idx" ON "NegotiationVisit"("status");
CREATE INDEX IF NOT EXISTS "NegotiationVisit_visitedAt_idx" ON "NegotiationVisit"("visitedAt");
CREATE INDEX IF NOT EXISTS "Photo_negotiationVisitId_idx" ON "Photo"("negotiationVisitId");
