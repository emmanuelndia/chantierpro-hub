ALTER TABLE "PlanningAssignment"
ADD COLUMN IF NOT EXISTS "targetQuantity" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "targetUnit" TEXT;

ALTER TABLE "TaskProgressUpdate"
ADD COLUMN IF NOT EXISTS "actualQuantity" DECIMAL(12,2);
