CREATE TABLE "FleetVehicle" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetVehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FleetVehicleAssignment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "apprenticeUserId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetVehicleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetVehicle_registrationNumber_key" ON "FleetVehicle"("registrationNumber");
CREATE INDEX "FleetVehicleAssignment_vehicleId_isActive_idx" ON "FleetVehicleAssignment"("vehicleId", "isActive");
CREATE INDEX "FleetVehicleAssignment_driverUserId_isActive_idx" ON "FleetVehicleAssignment"("driverUserId", "isActive");
CREATE INDEX "FleetVehicleAssignment_apprenticeUserId_isActive_idx" ON "FleetVehicleAssignment"("apprenticeUserId", "isActive");
CREATE INDEX "FleetVehicleAssignment_startDate_idx" ON "FleetVehicleAssignment"("startDate");

ALTER TABLE "FleetVehicleAssignment" ADD CONSTRAINT "FleetVehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetVehicleAssignment" ADD CONSTRAINT "FleetVehicleAssignment_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetVehicleAssignment" ADD CONSTRAINT "FleetVehicleAssignment_apprenticeUserId_fkey" FOREIGN KEY ("apprenticeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
