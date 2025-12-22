-- CreateTable
CREATE TABLE "TrendAlias" (
    "id" TEXT NOT NULL,
    "rawKey" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrendAlias_rawKey_idx" ON "TrendAlias"("rawKey");

-- CreateIndex
CREATE INDEX "TrendAlias_canonicalKey_idx" ON "TrendAlias"("canonicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrendAlias_rawKey_canonicalKey_key" ON "TrendAlias"("rawKey", "canonicalKey");
