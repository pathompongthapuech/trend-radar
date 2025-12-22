SELECT
  (SELECT COUNT(*) FROM "Signal") AS signal_rows,
  (SELECT COUNT(*) FROM "Post")   AS post_rows,
  (SELECT COUNT(*) FROM "IngestCursor") AS cursor_rows;
