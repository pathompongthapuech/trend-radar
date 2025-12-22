-- CreateTable
CREATE TABLE "IngestCursor" (
    "id" TEXT NOT NULL,
    "cursor" TEXT,
    "lastSinceISO" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "geo" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "url" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "lang" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "authorHash" TEXT,
    "metrics" JSONB,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signal_source_ts_idx" ON "Signal"("source", "ts");

-- CreateIndex
CREATE INDEX "Signal_key_ts_idx" ON "Signal"("key", "ts");

-- CreateIndex
CREATE INDEX "Post_source_publishedAt_idx" ON "Post"("source", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_source_sourceRef_key" ON "Post"("source", "sourceRef");
