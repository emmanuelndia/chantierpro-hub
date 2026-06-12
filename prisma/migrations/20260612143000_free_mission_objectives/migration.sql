ALTER TABLE "FreeMission"
ADD COLUMN "targetProgress" INTEGER,
ADD COLUMN "targetQuantity" DECIMAL(12, 2),
ADD COLUMN "targetUnit" TEXT,
ADD COLUMN "plannedDurationMinutes" INTEGER;
