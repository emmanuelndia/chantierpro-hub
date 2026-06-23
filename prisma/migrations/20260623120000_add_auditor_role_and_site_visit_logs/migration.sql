DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'AUDITOR';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SiteVisitLog" (
  "id" TEXT NOT NULL,
  "auditorId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "comment" TEXT,
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "accuracy" DECIMAL(8,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteVisitLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SiteVisitLog_auditorId_visitedAt_idx" ON "SiteVisitLog"("auditorId", "visitedAt");
CREATE INDEX IF NOT EXISTS "SiteVisitLog_projectId_visitedAt_idx" ON "SiteVisitLog"("projectId", "visitedAt");
CREATE INDEX IF NOT EXISTS "SiteVisitLog_siteId_visitedAt_idx" ON "SiteVisitLog"("siteId", "visitedAt");

DO $$ BEGIN
  ALTER TABLE "SiteVisitLog" ADD CONSTRAINT "SiteVisitLog_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SiteVisitLog" ADD CONSTRAINT "SiteVisitLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SiteVisitLog" ADD CONSTRAINT "SiteVisitLog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
