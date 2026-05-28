ALTER TABLE "User" ADD COLUMN "username" TEXT;

WITH normalized AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(
        regexp_replace(
          lower(split_part(COALESCE("email", "id"), '@', 1)),
          '[^a-z0-9._-]+',
          '',
          'g'
        ),
        ''
      ),
      lower("id")
    ) AS base_username
  FROM "User"
),
numbered AS (
  SELECT
    "id",
    base_username,
    row_number() OVER (PARTITION BY base_username ORDER BY "id") AS duplicate_index
  FROM normalized
)
UPDATE "User"
SET "username" = CASE
  WHEN numbered.duplicate_index = 1 THEN numbered.base_username
  ELSE numbered.base_username || '-' || numbered.duplicate_index::text
END
FROM numbered
WHERE "User"."id" = numbered."id";

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
