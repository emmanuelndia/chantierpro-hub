-- Replace the old one-assignment-per-resource-per-day rule with the turnover rule:
-- a resource can be assigned to several sites on the same day, but not twice to
-- the same active site assignment.
DROP INDEX IF EXISTS "PlanningAssignment_supervisor_date_active_key";

CREATE UNIQUE INDEX "PlanningAssignment_supervisor_date_site_active_key"
ON "PlanningAssignment"("supervisorId", "date", "siteId")
WHERE "deletedAt" IS NULL;
