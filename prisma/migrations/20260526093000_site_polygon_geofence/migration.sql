-- Add optional polygon geofencing for sites while keeping radius as the default.
CREATE TYPE "SiteGeofenceType" AS ENUM ('RADIUS', 'POLYGON');

ALTER TABLE "Site"
ADD COLUMN "geofenceType" "SiteGeofenceType" NOT NULL DEFAULT 'RADIUS',
ADD COLUMN "geofencePolygon" JSONB;
