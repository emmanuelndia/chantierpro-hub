CREATE TYPE "OfficeClockInLocation" AS ENUM ('OFFICE');

CREATE TYPE "UserNotificationAudience" AS ENUM ('ALL', 'ROLE', 'USERS');

ALTER TABLE "User" ADD COLUMN "matricule" TEXT;

ALTER TABLE "ClockInRecord"
  ADD COLUMN "officeClockInLocation" "OfficeClockInLocation",
  ADD COLUMN "isLate" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlanningAssignment"
  ADD COLUMN "plannedDurationMinutes" INTEGER;

CREATE TABLE "PlanningTaskTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetProgress" INTEGER,
  "targetQuantity" DECIMAL(12,2),
  "targetUnit" TEXT,
  "objectiveText" TEXT,
  "plannedDurationMinutes" INTEGER,
  "workLocationType" "PlanningWorkLocationType" NOT NULL DEFAULT 'ON_SITE',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanningTaskTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserNotification" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "audience" "UserNotificationAudience" NOT NULL,
  "targetRole" "Role",
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserNotificationRecipient" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotificationRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_matricule_key" ON "User"("matricule");
CREATE INDEX "ClockInRecord_officeClockInLocation_idx" ON "ClockInRecord"("officeClockInLocation");
CREATE INDEX "ClockInRecord_userId_officeClockInLocation_clockInDate_idx" ON "ClockInRecord"("userId", "officeClockInLocation", "clockInDate");
CREATE INDEX "ClockInRecord_isLate_idx" ON "ClockInRecord"("isLate");
CREATE INDEX "PlanningTaskTemplate_createdById_idx" ON "PlanningTaskTemplate"("createdById");
CREATE INDEX "PlanningTaskTemplate_workLocationType_idx" ON "PlanningTaskTemplate"("workLocationType");
CREATE INDEX "UserNotification_createdById_idx" ON "UserNotification"("createdById");
CREATE INDEX "UserNotification_targetRole_idx" ON "UserNotification"("targetRole");
CREATE INDEX "UserNotification_createdAt_idx" ON "UserNotification"("createdAt");
CREATE UNIQUE INDEX "UserNotificationRecipient_notificationId_userId_key" ON "UserNotificationRecipient"("notificationId", "userId");
CREATE INDEX "UserNotificationRecipient_userId_readAt_idx" ON "UserNotificationRecipient"("userId", "readAt");
CREATE INDEX "UserNotificationRecipient_notificationId_idx" ON "UserNotificationRecipient"("notificationId");

ALTER TABLE "PlanningTaskTemplate"
  ADD CONSTRAINT "PlanningTaskTemplate_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserNotification"
  ADD CONSTRAINT "UserNotification_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserNotificationRecipient"
  ADD CONSTRAINT "UserNotificationRecipient_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "UserNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserNotificationRecipient"
  ADD CONSTRAINT "UserNotificationRecipient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
