ALTER TABLE "ClockInRecord" ADD COLUMN "planningAssignmentId" TEXT;

CREATE INDEX "ClockInRecord_planningAssignmentId_idx" ON "ClockInRecord"("planningAssignmentId");

ALTER TABLE "ClockInRecord"
  ADD CONSTRAINT "ClockInRecord_planningAssignmentId_fkey"
  FOREIGN KEY ("planningAssignmentId")
  REFERENCES "PlanningAssignment"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
