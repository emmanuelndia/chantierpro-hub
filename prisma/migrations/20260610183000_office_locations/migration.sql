-- CreateTable
CREATE TABLE "OfficeLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "radiusKm" DECIMAL(4,2) NOT NULL DEFAULT 0.5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeLocation_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ClockInRecord" ADD COLUMN "officeLocationId" TEXT;

-- CreateIndex
CREATE INDEX "OfficeLocation_isActive_idx" ON "OfficeLocation"("isActive");

-- CreateIndex
CREATE INDEX "OfficeLocation_createdById_idx" ON "OfficeLocation"("createdById");

-- CreateIndex
CREATE INDEX "ClockInRecord_officeLocationId_idx" ON "ClockInRecord"("officeLocationId");

-- CreateIndex
CREATE INDEX "ClockInRecord_userId_officeLocationId_clockInDate_idx" ON "ClockInRecord"("userId", "officeLocationId", "clockInDate");

-- AddForeignKey
ALTER TABLE "OfficeLocation" ADD CONSTRAINT "OfficeLocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockInRecord" ADD CONSTRAINT "ClockInRecord_officeLocationId_fkey" FOREIGN KEY ("officeLocationId") REFERENCES "OfficeLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
