-- PlanningAssignment is now a task line, not a unique site/day assignment.
-- A resource can have several active tasks on the same site on the same day.
DROP INDEX IF EXISTS "PlanningAssignment_supervisor_date_site_active_key";

CREATE INDEX IF NOT EXISTS "PlanningAssignment_supervisor_date_site_idx"
ON "PlanningAssignment"("supervisorId", "date", "siteId");
