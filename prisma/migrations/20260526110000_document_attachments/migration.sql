-- CreateTable
CREATE TABLE "DocumentAttachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "siteId" TEXT,
    "reportId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDeletionLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "deletedById" TEXT NOT NULL,
    "originalAuthorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAttachment_storageKey_key" ON "DocumentAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "DocumentAttachment_projectId_idx" ON "DocumentAttachment"("projectId");

-- CreateIndex
CREATE INDEX "DocumentAttachment_siteId_idx" ON "DocumentAttachment"("siteId");

-- CreateIndex
CREATE INDEX "DocumentAttachment_reportId_idx" ON "DocumentAttachment"("reportId");

-- CreateIndex
CREATE INDEX "DocumentAttachment_uploadedById_idx" ON "DocumentAttachment"("uploadedById");

-- CreateIndex
CREATE INDEX "DocumentAttachment_deletedById_idx" ON "DocumentAttachment"("deletedById");

-- CreateIndex
CREATE INDEX "DocumentAttachment_isDeleted_idx" ON "DocumentAttachment"("isDeleted");

-- CreateIndex
CREATE INDEX "DocumentDeletionLog_documentId_idx" ON "DocumentDeletionLog"("documentId");

-- CreateIndex
CREATE INDEX "DocumentDeletionLog_deletedById_idx" ON "DocumentDeletionLog"("deletedById");

-- CreateIndex
CREATE INDEX "DocumentDeletionLog_originalAuthorId_idx" ON "DocumentDeletionLog"("originalAuthorId");

-- AddForeignKey
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDeletionLog" ADD CONSTRAINT "DocumentDeletionLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDeletionLog" ADD CONSTRAINT "DocumentDeletionLog_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDeletionLog" ADD CONSTRAINT "DocumentDeletionLog_originalAuthorId_fkey" FOREIGN KEY ("originalAuthorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
