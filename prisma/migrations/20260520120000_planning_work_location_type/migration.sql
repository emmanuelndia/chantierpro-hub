-- Add a work-location marker to planning tasks.
-- ON_SITE keeps the current field behavior.
-- OFFICE represents coordination/admin work that does not require physical presence on site.
CREATE TYPE "PlanningWorkLocationType" AS ENUM ('ON_SITE', 'OFFICE');

ALTER TABLE "PlanningAssignment"
ADD COLUMN "workLocationType" "PlanningWorkLocationType" NOT NULL DEFAULT 'ON_SITE';
