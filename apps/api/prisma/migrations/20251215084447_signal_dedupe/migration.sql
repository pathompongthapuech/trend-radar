/*
  Warnings:

  - A unique constraint covering the columns `[source,ts,key,kind,geo]` on the table `Signal` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Signal_source_ts_key_kind_geo_key" ON "Signal"("source", "ts", "key", "kind", "geo");
