-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "startPage" INTEGER NOT NULL,
    "endPage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "topicNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "estimatedTime" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "currentChapterId" TEXT,
    "currentTopicId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'greeting',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chapter_fileId_idx" ON "Chapter"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_fileId_chapterNumber_key" ON "Chapter"("fileId", "chapterNumber");

-- CreateIndex
CREATE INDEX "Topic_chapterId_idx" ON "Topic"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_chapterId_topicNumber_key" ON "Topic"("chapterId", "topicNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSession_sessionKey_key" ON "LearningSession"("sessionKey");

-- CreateIndex
CREATE INDEX "LearningSession_fileId_idx" ON "LearningSession"("fileId");

-- CreateIndex
CREATE INDEX "LearningSession_sessionKey_idx" ON "LearningSession"("sessionKey");

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
