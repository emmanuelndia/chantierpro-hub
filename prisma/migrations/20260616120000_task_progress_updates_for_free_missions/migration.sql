ALTER TABLE "TaskProgressUpdate"
ALTER COLUMN "assignmentId" DROP NOT NULL;

ALTER TABLE "TaskProgressUpdate"
ADD COLUMN IF NOT EXISTS "freeMissionId" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TaskProgressUpdate_freeMissionId_fkey'
    ) THEN
        ALTER TABLE "TaskProgressUpdate"
            ADD CONSTRAINT "TaskProgressUpdate_freeMissionId_fkey"
            FOREIGN KEY ("freeMissionId") REFERENCES "FreeMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TaskProgressUpdate_freeMissionId_idx" ON "TaskProgressUpdate"("freeMissionId");
