-- Link chantier photos to optional mobile planning assignments.
ALTER TABLE "Photo" ADD COLUMN "planningAssignmentId" TEXT;

CREATE INDEX "Photo_planningAssignmentId_idx" ON "Photo"("planningAssignmentId");

ALTER TABLE "Photo"
ADD CONSTRAINT "Photo_planningAssignmentId_fkey"
FOREIGN KEY ("planningAssignmentId") REFERENCES "PlanningAssignment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
