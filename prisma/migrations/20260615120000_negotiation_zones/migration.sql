CREATE TABLE "NegotiationZone" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "city" TEXT,
  "region" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NegotiationZone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NegotiationZone_projectId_normalizedName_key" ON "NegotiationZone"("projectId", "normalizedName");
CREATE INDEX "NegotiationZone_projectId_idx" ON "NegotiationZone"("projectId");
CREATE INDEX "NegotiationZone_normalizedName_idx" ON "NegotiationZone"("normalizedName");

ALTER TABLE "NegotiationZone"
  ADD CONSTRAINT "NegotiationZone_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NegotiationBuilding" ADD COLUMN "zoneId" TEXT;
CREATE INDEX "NegotiationBuilding_zoneId_idx" ON "NegotiationBuilding"("zoneId");
ALTER TABLE "NegotiationBuilding"
  ADD CONSTRAINT "NegotiationBuilding_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "NegotiationZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NegotiationAssignment" ADD COLUMN "zoneId" TEXT;
CREATE INDEX "NegotiationAssignment_zoneId_idx" ON "NegotiationAssignment"("zoneId");
ALTER TABLE "NegotiationAssignment"
  ADD CONSTRAINT "NegotiationAssignment_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "NegotiationZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
