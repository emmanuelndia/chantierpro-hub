ALTER TABLE "NegotiationVisit" ADD COLUMN IF NOT EXISTS "actualZone" TEXT;

CREATE INDEX IF NOT EXISTS "NegotiationVisit_actualZone_idx" ON "NegotiationVisit"("actualZone");
