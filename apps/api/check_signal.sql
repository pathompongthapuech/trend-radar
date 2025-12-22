SELECT
  COUNT(*) AS rows_24h,
  COUNT(DISTINCT "ts") AS distinct_ts_24h,
  MIN("ts") AS min_ts,
  MAX("ts") AS max_ts
FROM "Signal"
WHERE "source" = 'x_trendlist'
  AND "ts" >= NOW() - INTERVAL '24 hours';