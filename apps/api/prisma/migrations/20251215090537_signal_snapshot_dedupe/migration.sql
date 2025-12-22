/*
  Warnings:

  - A unique constraint covering the columns `[source,ts,geo,kind,key]` on the table `Signal` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Signal_source_ts_key_kind_geo_key";

-- CreateIndex
CREATE UNIQUE INDEX "Signal_source_ts_geo_kind_key_key" ON "Signal"("source", "ts", "geo", "kind", "key");
