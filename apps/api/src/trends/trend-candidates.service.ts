import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

export type Candidate = {
  key: string;
  score: number;
  sources: string[];
  metrics: {
    trendlistRankBest?: number;
    trendlistHits?: number; // bucketed hits (10-min buckets)
    recentHits60m?: number; // bucketed hits in last 60m (0..6)
    momentum?: number; // clamped to [-1, 1]
    ageHours?: number;
    gdeltHits?: number;
  };
};

type SqlRow = {
  key: string;
  sources: string[] | null;
  trendlist_rank_best: number | null;
  trendlist_hits: number | null; // int
  recent_hits_60m: number | null; // int
  prev_hits_60m: number | null; // int
  momentum: number | string | null; // float8 (may come back as string)
  age_hours: number | string | null; // float8 (may come back as string)
  gdelt_hits: number | null; // int
};

@Injectable()
export class TrendCandidatesService {
  constructor(private prisma: PrismaService) {}

  async getCandidates(hours = 24, limit = 20, scope?: string): Promise<Candidate[]> {
    const rows = await this.prisma.$queryRaw<SqlRow[]>`
WITH base AS (
  SELECT
    "key" AS key,
    "source" AS source,
    "ts" AS ts,
    "meta" AS meta,
    (
      date_trunc('hour', "ts")
      + (floor(extract(minute from "ts") / 10) * interval '10 minutes')
    ) AS bucket_ts
  FROM "Signal"
  WHERE "ts" >= NOW() - (${hours}::int * interval '1 hour')
),
x AS (
  SELECT
    key,
    array_agg(DISTINCT source) AS sources,

    -- ✅ rank ต้องมาจาก x_trendlist เท่านั้น
    MIN(NULLIF((meta->>'rank')::int, 0)) FILTER (WHERE source = 'x_trendlist') AS trendlist_rank_best,

    CAST(COUNT(DISTINCT bucket_ts) FILTER (WHERE source = 'x_trendlist') AS int) AS trendlist_hits,

    CAST(COUNT(DISTINCT bucket_ts) FILTER (
      WHERE source = 'x_trendlist' AND ts >= NOW() - interval '60 minutes'
    ) AS int) AS recent_hits_60m,

    CAST(COUNT(DISTINCT bucket_ts) FILTER (
      WHERE source = 'x_trendlist'
        AND ts < NOW() - interval '60 minutes'
        AND ts >= NOW() - interval '120 minutes'
    ) AS int) AS prev_hits_60m,

    -- ✅ age_hours จาก MIN(ts) ของ key (โอเค)
    (EXTRACT(EPOCH FROM (NOW() - MIN(ts))) / 3600.0)::double precision AS age_hours
  FROM base
  GROUP BY key
),
g AS (
  SELECT
    key,
    CAST(COUNT(*) FILTER (WHERE source = 'gdelt') AS int) AS gdelt_hits
  FROM base
  GROUP BY key
)
SELECT
  x.key AS key,
  x.sources AS sources,
  x.trendlist_rank_best AS trendlist_rank_best,
  x.trendlist_hits AS trendlist_hits,
  x.recent_hits_60m AS recent_hits_60m,
  x.prev_hits_60m AS prev_hits_60m,

  -- ✅ momentum ให้สเกลอยู่ใน [-1, 1] แบบ “ตั้งแต่ใน SQL”
  -- ใช้ ratio ที่นิ่งกว่า:
  -- 1) ถ้า prev=0: ใช้ recent/6 (0..1) ไม่ใช่ recent (0..6)
  -- 2) ถ้า prev>0: (recent-prev)/prev
  (
    CASE
      WHEN x.prev_hits_60m IS NULL THEN 0
      WHEN x.prev_hits_60m = 0 THEN (x.recent_hits_60m::double precision / 6.0)
      ELSE ((x.recent_hits_60m - x.prev_hits_60m)::double precision / NULLIF(x.prev_hits_60m, 0)::double precision)
    END
  )::double precision AS momentum,

  x.age_hours AS age_hours,
  COALESCE(g.gdelt_hits, 0) AS gdelt_hits
FROM x
LEFT JOIN g ON g.key = x.key
ORDER BY (COALESCE(x.trendlist_hits,0) + COALESCE(g.gdelt_hits,0)) DESC
LIMIT ${limit}::int;
`;

    const toNum = (v: unknown, fallback = 0) => {
      if (v === null || v === undefined) return fallback;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    const out: Candidate[] = rows
      .map((r) => {
        const sources = (r.sources ?? []).filter(Boolean);

        const bestRank = r.trendlist_rank_best ?? undefined;
        const hits = toNum(r.trendlist_hits, 0);
        const recent = toNum(r.recent_hits_60m, 0);
        const momRaw = toNum(r.momentum, 0);
        const age = r.age_hours == null ? undefined : toNum(r.age_hours, 0);
        const gdelt = toNum(r.gdelt_hits, 0);

        // ===== scoring (MVP stable) =====
        const rankScore =
          bestRank == null ? 0 :
          bestRank <= 3 ? 1.0 :
          bestRank <= 5 ? 0.9 :
          bestRank <= 10 ? 0.75 :
          bestRank <= 20 ? 0.55 :
          bestRank <= 30 ? 0.35 : 0.2;

        // persistence: 60 buckets = 10h
        const persistenceScore = Math.min(1, hits / 60);

        // recency: 6 buckets = 60m
        const recencyScore = Math.min(1, recent / 6);

        // ✅ clamp momentum to [-1, 1]
        const momentumScore = Math.max(-1, Math.min(1, momRaw));

        const ageDecay =
          age == null ? 1 :
          age <= 6 ? 1 :
          age <= 24 ? 0.9 :
          age <= 48 ? 0.7 :
          age <= 72 ? 0.5 : 0.3;

        const gdeltScore = Math.min(1, gdelt / 5);

        const score =
          ageDecay *
          (
            120 * rankScore +
            80 * persistenceScore +
            60 * recencyScore +
            40 * Math.max(0, momentumScore) +
            30 * gdeltScore
          );

        return {
          key: r.key,
          score,
          sources,
          metrics: {
            trendlistRankBest: bestRank,
            trendlistHits: hits,
            recentHits60m: recent,
            momentum: momentumScore,
            ageHours: age,
            gdeltHits: gdelt,
          },
        };
      })
      .filter((c) => (c.key ?? "").trim().length >= 3);

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }
}
