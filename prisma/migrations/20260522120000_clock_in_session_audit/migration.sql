-- Add audit flags to clock-in events for remote checkout, auto-closure and HR regularization.
ALTER TABLE "public"."ClockInRecord"
ADD COLUMN "isRemoteCheckout" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isAutoClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isRegularized" BOOLEAN NOT NULL DEFAULT false;

-- Keep a trace of HR/Admin/Direction regularizations.
CREATE TABLE "public"."ClockInRegularization" (
  "id" TEXT NOT NULL,
  "clockInRecordId" TEXT NOT NULL,
  "correctedDepartureTime" TIMESTAMP(3) NOT NULL,
  "authorId" TEXT NOT NULL,
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClockInRegularization_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClockInRegularization_clockInRecordId_idx" ON "public"."ClockInRegularization"("clockInRecordId");
CREATE INDEX "ClockInRegularization_authorId_idx" ON "public"."ClockInRegularization"("authorId");
CREATE INDEX "ClockInRegularization_createdAt_idx" ON "public"."ClockInRegularization"("createdAt");

ALTER TABLE "public"."ClockInRegularization"
ADD CONSTRAINT "ClockInRegularization_clockInRecordId_fkey"
FOREIGN KEY ("clockInRecordId") REFERENCES "public"."ClockInRecord"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ClockInRegularization"
ADD CONSTRAINT "ClockInRegularization_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "public"."User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
