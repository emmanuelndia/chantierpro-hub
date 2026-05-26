ALTER TABLE "PlanningAssignment" ADD COLUMN IF NOT EXISTS "objectiveText" TEXT;

CREATE TABLE IF NOT EXISTS "TaskProgressUpdate" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "progress" INTEGER,
    "comment" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskProgressUpdate_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TaskProgressUpdate_assignmentId_fkey'
    ) THEN
        ALTER TABLE "TaskProgressUpdate"
            ADD CONSTRAINT "TaskProgressUpdate_assignmentId_fkey"
            FOREIGN KEY ("assignmentId") REFERENCES "PlanningAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TaskProgressUpdate_createdById_fkey'
    ) THEN
        ALTER TABLE "TaskProgressUpdate"
            ADD CONSTRAINT "TaskProgressUpdate_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TaskProgressUpdate_assignmentId_idx" ON "TaskProgressUpdate"("assignmentId");
CREATE INDEX IF NOT EXISTS "TaskProgressUpdate_createdById_idx" ON "TaskProgressUpdate"("createdById");
CREATE INDEX IF NOT EXISTS "TaskProgressUpdate_createdAt_idx" ON "TaskProgressUpdate"("createdAt");
