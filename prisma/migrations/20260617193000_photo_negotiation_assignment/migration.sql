ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "negotiationAssignmentId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Photo_negotiationAssignmentId_fkey'
  ) THEN
    ALTER TABLE "Photo"
      ADD CONSTRAINT "Photo_negotiationAssignmentId_fkey"
      FOREIGN KEY ("negotiationAssignmentId") REFERENCES "NegotiationAssignment"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Photo_negotiationAssignmentId_idx" ON "Photo"("negotiationAssignmentId");
