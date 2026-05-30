CREATE TABLE "CoordinatorProjectManagerScope" (
    "id" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "projectManagerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoordinatorProjectManagerScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoordinatorProjectManagerScope_coordinatorId_projectManagerId_key" ON "CoordinatorProjectManagerScope"("coordinatorId", "projectManagerId");
CREATE INDEX "CoordinatorProjectManagerScope_coordinatorId_idx" ON "CoordinatorProjectManagerScope"("coordinatorId");
CREATE INDEX "CoordinatorProjectManagerScope_projectManagerId_idx" ON "CoordinatorProjectManagerScope"("projectManagerId");
CREATE INDEX "CoordinatorProjectManagerScope_createdById_idx" ON "CoordinatorProjectManagerScope"("createdById");

ALTER TABLE "CoordinatorProjectManagerScope" ADD CONSTRAINT "CoordinatorProjectManagerScope_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoordinatorProjectManagerScope" ADD CONSTRAINT "CoordinatorProjectManagerScope_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoordinatorProjectManagerScope" ADD CONSTRAINT "CoordinatorProjectManagerScope_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
