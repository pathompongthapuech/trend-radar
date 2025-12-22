import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { TrendEmergingService, PhasedTrend } from "./trend-emerging.service";
import { TrendKeyService } from "./trend-key.service";

export type TrendType = "fad" | "mega" | "normal";

export type TrendForecast = {
  key: string;
  phase: PhasedTrend["phase"];
  confidence: number;

  prob10m: number; // 0..1
  label: "น่าจะไปต่อ" | "ทรงตัว" | "มีโอกาสแผ่ว" | "มีโอกาสหาย";
  reasons: string[];

  picked?: boolean;
  mode?: "ยังติด" | "กำลังพุ่ง";
  risk?: "low" | "mid" | "high";
  slope?: number;
  inLastBucket?: boolean;

  // ✅ Validation: Fad vs Mega Trend
  trendType?: TrendType;
  validation?: {
    days7d: number;
    days30d: number;
    hits24h: number;
    hits7d: number;
    hits30d: number;
    spikeRatio24hOver7d: number;  // can be > 1
    spikeRatio24hOver30d: number; // can be > 1
    reasons: string[];
  };

  canonicalKey?: string;
  normalizedKey?: string;
};

type SqlRow = {
  key: string;

  present_last_60m: number; // 0..6
  present_prev_60m: number; // 0..6
  last_bucket_ts: Date | null;

  hits_24h: number;

  hits_7d: number;
  hits_30d: number;
  days_7d: number;
  days_30d: number;
};

type ForecastConfig = {
  probCap: number; // e.g. 0.97
  graceMinutesInLastBucket: number; // e.g. 12

  // historyFactor based on hits24h
  history: {
    minFactor: number; // e.g. 0.55
    fullHits24h: number; // e.g. 30 (>= this => factor ~1)
  };

  // classify thresholds (soft)
  fad: {
    minHits24h: number;
    maxDays7d: number;
    maxDays30d: number;
    minSpikeRatio24hOver7d: number;
    minSpikeRatio24hOver30d: number;
  };
  mega: {
    minDays30d: number;
    minHits30d: number;
    maxSpikeRatio24hOver30d: number;
  };

  // fallback when emerging is empty
  fallback: {
    enabled: boolean;
    // pick keys from last N minutes in Signal
    minutesLookback: number; // e.g. 60
    maxKeys: number; // e.g. 50
    defaultPhase: PhasedTrend["phase"]; // e.g. "emerging"
    defaultConfidence: number; // e.g. 55
  };
};

const DEFAULT_CFG: ForecastConfig = {
  probCap: 0.97,
  graceMinutesInLastBucket: 12,
  history: {
    minFactor: 0.55,
    fullHits24h: 30,
  },
  fad: {
    minHits24h: 10,
    maxDays7d: 2,
    maxDays30d: 3,
    minSpikeRatio24hOver7d: 0.55,
    minSpikeRatio24hOver30d: 0.40,
  },
  mega: {
    minDays30d: 14,
    minHits30d: 120,
    maxSpikeRatio24hOver30d: 0.25,
  },
  fallback: {
    enabled: true,
    minutesLookback: 60,
    maxKeys: 50,
    defaultPhase: "emerging",
    defaultConfidence: 55,
  },
};

@Injectable()
export class TrendForecastService {
  private readonly cfg: ForecastConfig = DEFAULT_CFG;

  constructor(
    private prisma: PrismaService,
    private emerging: TrendEmergingService,
    private trendKey: TrendKeyService,
  ) {}

  async forecast10m(hours = 24, limit = 20): Promise<TrendForecast[]> {
    // 1) เอา list ที่มี phase ก่อน
    let phasedRaw = await this.emerging.getEmerging(hours, Math.max(limit, 50));

    // ✅ fallback กัน results=[]
    if (!phasedRaw.length && this.cfg.fallback.enabled) {
      const fallbackKeys = await this.pickRecentKeys(
        this.cfg.fallback.minutesLookback,
        this.cfg.fallback.maxKeys,
      );

      phasedRaw = fallbackKeys.map((k) => ({
        key: k,
        phase: this.cfg.fallback.defaultPhase,
        confidence: this.cfg.fallback.defaultConfidence,
      })) as any;
    }

    if (!phasedRaw.length) return [];

    // 2) normalize + alias -> canonicalize แล้ว merge ให้เหลือ 1 ต่อ canonicalKey
    const inputs = phasedRaw.map((x) => x.key);
    const pairs = await this.trendKey.canonicalizeMany(inputs);
    const normToCanon = new Map(pairs.map((p) => [p.normalizedKey, p.canonicalKey]));

    const phaseRank = (p: PhasedTrend["phase"]) =>
      p === "rising" ? 4 :
      p === "emerging" ? 3 :
      p === "peaking" ? 2 :
      p === "fading" ? 1 : 0;

    const phasedByCanon = new Map<
      string,
      (PhasedTrend & { normalizedKey: string; canonicalKey: string })
    >();

    for (const t of phasedRaw) {
      const normalizedKey = this.trendKey.normalize(t.key);
      const canonicalKey = normToCanon.get(normalizedKey) ?? normalizedKey;

      const prev = phasedByCanon.get(canonicalKey);
      if (!prev) {
        phasedByCanon.set(canonicalKey, { ...t, key: canonicalKey, normalizedKey, canonicalKey });
        continue;
      }

      const merged = {
        ...prev,
        key: canonicalKey,
        canonicalKey,
        normalizedKey: prev.normalizedKey,
        confidence: Math.max((prev as any).confidence ?? 0, (t as any).confidence ?? 0),
        phase: phaseRank((t as any).phase) > phaseRank((prev as any).phase)
          ? (t as any).phase
          : (prev as any).phase,
      };

      phasedByCanon.set(canonicalKey, merged as any);
    }

    const phased = Array.from(phasedByCanon.values());
    const keys = phased.map((x) => x.key);

    // 3) ดึง presence 120m + hits_24h + persistence 7d/30d
    // ✅ IMPORTANT: base เป็น keys เสมอ (กัน key หายเพราะไม่อยู่ใน agg120)
    const rows = await this.prisma.$queryRaw<SqlRow[]>`
WITH
keys_in AS (
  SELECT unnest(${keys}::text[]) AS key
),

base120 AS (
  SELECT
    "key" AS key,
    "ts"  AS ts,
    (
      date_trunc('hour', "ts")
      + (floor(extract(minute from "ts") / 10) * interval '10 minutes')
    ) AS bucket_ts
  FROM "Signal"
  WHERE "source" = 'x_trendlist'
    AND "ts" >= NOW() - interval '120 minutes'
    AND "key" = ANY(${keys}::text[])
),
agg120 AS (
  SELECT
    key,
    MAX(bucket_ts) AS last_bucket_ts,
    CAST(COUNT(DISTINCT bucket_ts) FILTER (
      WHERE ts >= NOW() - interval '60 minutes'
    ) AS int) AS present_last_60m,
    CAST(COUNT(DISTINCT bucket_ts) FILTER (
      WHERE ts < NOW() - interval '60 minutes'
        AND ts >= NOW() - interval '120 minutes'
    ) AS int) AS present_prev_60m
  FROM base120
  GROUP BY key
),

base24h AS (
  SELECT
    "key" AS key,
    (
      date_trunc('hour', "ts")
      + (floor(extract(minute from "ts") / 10) * interval '10 minutes')
    ) AS bucket_ts
  FROM "Signal"
  WHERE "source" = 'x_trendlist'
    AND "ts" >= NOW() - interval '24 hours'
    AND "key" = ANY(${keys}::text[])
),
agg24h AS (
  SELECT
    key,
    CAST(COUNT(DISTINCT bucket_ts) AS int) AS hits_24h
  FROM base24h
  GROUP BY key
),

base7d AS (
  SELECT
    "key" AS key,
    (
      date_trunc('hour', "ts")
      + (floor(extract(minute from "ts") / 10) * interval '10 minutes')
    ) AS bucket_ts,
    date_trunc('day', "ts") AS day_ts
  FROM "Signal"
  WHERE "source" = 'x_trendlist'
    AND "ts" >= NOW() - interval '7 days'
    AND "key" = ANY(${keys}::text[])
),
agg7d AS (
  SELECT
    key,
    CAST(COUNT(DISTINCT bucket_ts) AS int) AS hits_7d,
    CAST(COUNT(DISTINCT day_ts) AS int) AS days_7d
  FROM base7d
  GROUP BY key
),

base30d AS (
  SELECT
    "key" AS key,
    (
      date_trunc('hour', "ts")
      + (floor(extract(minute from "ts") / 10) * interval '10 minutes')
    ) AS bucket_ts,
    date_trunc('day', "ts") AS day_ts
  FROM "Signal"
  WHERE "source" = 'x_trendlist'
    AND "ts" >= NOW() - interval '30 days'
    AND "key" = ANY(${keys}::text[])
),
agg30d AS (
  SELECT
    key,
    CAST(COUNT(DISTINCT bucket_ts) AS int) AS hits_30d,
    CAST(COUNT(DISTINCT day_ts) AS int) AS days_30d
  FROM base30d
  GROUP BY key
)

SELECT
  k.key,
  COALESCE(a.present_last_60m, 0) AS present_last_60m,
  COALESCE(a.present_prev_60m, 0) AS present_prev_60m,
  a.last_bucket_ts,
  COALESCE(h24.hits_24h, 0) AS hits_24h,
  COALESCE(h7.hits_7d, 0)   AS hits_7d,
  COALESCE(h30.hits_30d, 0) AS hits_30d,
  COALESCE(h7.days_7d, 0)   AS days_7d,
  COALESCE(h30.days_30d, 0) AS days_30d
FROM keys_in k
LEFT JOIN agg120 a  ON a.key  = k.key
LEFT JOIN agg24h h24 ON h24.key = k.key
LEFT JOIN agg7d  h7  ON h7.key  = k.key
LEFT JOIN agg30d h30 ON h30.key = k.key;
`;

    const byKey = new Map(rows.map((r) => [r.key, r]));

    // 4) ประเมิน prob10m + label + mode/risk + validate fad/mega
    const evaluated: TrendForecast[] = phased.map((t) => {
      const r = byKey.get(t.key);

      const last60 = clampInt(r?.present_last_60m ?? 0, 0, 6);
      const prev60 = clampInt(r?.present_prev_60m ?? 0, 0, 6);
      const slope = last60 - prev60;

      const inLastBucket = isInLastBucket(r?.last_bucket_ts ?? null, this.cfg.graceMinutesInLastBucket);

      const hits24h = clampInt(r?.hits_24h ?? 0, 0, 999999);
      const hits7d  = clampInt(r?.hits_7d ?? 0, 0, 999999);
      const hits30d = clampInt(r?.hits_30d ?? 0, 0, 999999);
      const days7d  = clampInt(r?.days_7d ?? 0, 0, 999999);
      const days30d = clampInt(r?.days_30d ?? 0, 0, 999999);

      // historyFactor: min..1.00
      const historyFactor = clamp(
        this.cfg.history.minFactor + Math.min(1, hits24h / this.cfg.history.fullHits24h) * (1 - this.cfg.history.minFactor),
        this.cfg.history.minFactor,
        1
      );

      // features
      const recency01 = last60 / 6;
      const slope01 = clamp(slope / 6, -1, 1);

      const phaseBoost =
        (t as any).phase === "rising" ? 0.35 :
        (t as any).phase === "peaking" ? 0.20 :
        (t as any).phase === "emerging" ? 0.25 : -0.20;

      const confBoost = clamp((((t as any).confidence ?? 0) - 50) / 200, -0.05, 0.25);
      const lastBucketBoost = inLastBucket ? 0.20 : -0.10;

      const slopeBoost =
        slope >= 3 ? 0.28 :
        slope >= 2 ? 0.18 :
        slope >= 1 ? 0.10 :
        slope <= -3 ? -0.35 :
        slope <= -2 ? -0.22 :
        slope <= -1 ? -0.12 : 0;

      let uncertaintyPenalty = 0;
      if (last60 === 6 && slope === 0) uncertaintyPenalty += 0.12;
      if (!inLastBucket) uncertaintyPenalty += 0.12;
      if (hits24h <= 6) uncertaintyPenalty += 0.18;
      else if (hits24h <= 12) uncertaintyPenalty += 0.10;
      if ((t as any).phase === "fading") uncertaintyPenalty += 0.25;

      const bias = -1.10;

      const z =
        bias +
        2.30 * recency01 +
        1.80 * slope01 +
        phaseBoost +
        confBoost +
        lastBucketBoost +
        slopeBoost -
        uncertaintyPenalty;

      let p = sigmoid(z);
      p = p * historyFactor;
      p = clamp01(p);
      p = Math.min(this.cfg.probCap, p);

      let label: TrendForecast["label"] = "ทรงตัว";
      if (p >= 0.78) label = "น่าจะไปต่อ";
      else if (p >= 0.52) label = "ทรงตัว";
      else if (p >= 0.30) label = "มีโอกาสแผ่ว";
      else label = "มีโอกาสหาย";

      const mode: "ยังติด" | "กำลังพุ่ง" =
        inLastBucket && slope >= 2 ? "กำลังพุ่ง" : "ยังติด";

      const risk: "low" | "mid" | "high" =
        mode === "กำลังพุ่ง" ? "high" :
        (last60 >= 5 && inLastBucket) ? "low" : "mid";

      // ✅ Validation ratios (do NOT clamp01; allow >1)
      const spikeRatio24hOver7d = hits7d > 0 ? hits24h / hits7d : (hits24h > 0 ? 999 : 0);
      const spikeRatio24hOver30d = hits30d > 0 ? hits24h / hits30d : (hits24h > 0 ? 999 : 0);

      const vReasons: string[] = [
        `persistence: days7d=${days7d}, days30d=${days30d}`,
        `volume: hits24h=${hits24h}, hits7d=${hits7d}, hits30d=${hits30d}`,
        `spikeRatio: 24h/7d=${isFinite(spikeRatio24hOver7d) ? spikeRatio24hOver7d.toFixed(2) : "inf"}, 24h/30d=${isFinite(spikeRatio24hOver30d) ? spikeRatio24hOver30d.toFixed(2) : "inf"}`,
      ];

      const isFad =
        hits24h >= this.cfg.fad.minHits24h &&
        days7d <= this.cfg.fad.maxDays7d &&
        days30d <= this.cfg.fad.maxDays30d &&
        spikeRatio24hOver7d >= this.cfg.fad.minSpikeRatio24hOver7d &&
        spikeRatio24hOver30d >= this.cfg.fad.minSpikeRatio24hOver30d;

      const isMega =
        days30d >= this.cfg.mega.minDays30d &&
        hits30d >= this.cfg.mega.minHits30d &&
        spikeRatio24hOver30d <= this.cfg.mega.maxSpikeRatio24hOver30d;

      let trendType: TrendType = "normal";
      if (isMega) trendType = "mega";
      else if (isFad) trendType = "fad";

      if (trendType === "fad") vReasons.push("classify=fad (short spike + low persistence)");
      else if (trendType === "mega") vReasons.push("classify=mega (high persistence + stable distribution)");
      else vReasons.push("classify=normal");

      const reasons: string[] = [
        `อยู่ใน 60 นาทีล่าสุด ${last60}/6 bucket`,
        `เทียบ 60 นาทีก่อนหน้า ${prev60}/6 bucket (Δ ${slope >= 0 ? "+" : ""}${slope})`,
        `ติด 10 นาทีล่าสุด: ${inLastBucket ? "ใช่" : "ไม่"}`,
        `hits24h=${hits24h}`,
        `phase=${(t as any).phase}, confidence=${(t as any).confidence}`,
        `p≈sigmoid(z) x historyFactor=${historyFactor.toFixed(2)} (cap=${this.cfg.probCap})`,
        `mode=${mode}, risk=${risk}`,
        `validation: ${trendType}`,
      ];

      return {
        key: t.key,
        phase: (t as any).phase,
        confidence: (t as any).confidence,
        prob10m: Number(p.toFixed(2)),
        label,
        reasons,
        mode,
        risk,
        slope,
        inLastBucket,

        trendType,
        validation: {
          days7d,
          days30d,
          hits24h,
          hits7d,
          hits30d,
          // clamp หลวม ๆ กันเพี้ยน (0..10)
          spikeRatio24hOver7d: Number(clamp(spikeRatio24hOver7d, 0, 10).toFixed(2)),
          spikeRatio24hOver30d: Number(clamp(spikeRatio24hOver30d, 0, 10).toFixed(2)),
          reasons: vReasons,
        },

        canonicalKey: (t as any).canonicalKey ?? t.key,
        normalizedKey: (t as any).normalizedKey,
      };
    });

    // 4.1) unique ต่อ key
    const evaluatedUnique = Array.from(
      evaluated.reduce((m, x) => {
        const prev = m.get(x.key);
        if (!prev) m.set(x.key, x);
        else {
          const better =
            (x.prob10m > prev.prob10m) ||
            (x.prob10m === prev.prob10m && (x.confidence ?? 0) > (prev.confidence ?? 0))
              ? x
              : prev;
          m.set(x.key, better);
        }
        return m;
      }, new Map<string, TrendForecast>()).values()
    );

    // 5) เลือก “โอกาส + คุมความเสี่ยง”
    const risingShots = evaluatedUnique
      .filter((x) => x.mode === "กำลังพุ่ง")
      .sort((a, b) => (b.prob10m - a.prob10m) || (b.confidence - a.confidence));

    const steadyCore = evaluatedUnique
      .filter((x) => x.mode === "ยังติด")
      .sort((a, b) => (b.prob10m - a.prob10m) || (b.confidence - a.confidence));

    const pickHigh = Math.max(1, Math.round(limit * 0.30));
    const pickLow = Math.max(0, limit - pickHigh);

    const picked: TrendForecast[] = [
      ...steadyCore.slice(0, pickLow),
      ...risingShots.slice(0, pickHigh),
    ];

    const pickedSet = new Set(picked.map((x) => x.key));

    return evaluatedUnique
      .filter((x) => pickedSet.has(x.key))
      .map((x) => ({ ...x, picked: true }))
      .sort((a, b) => (b.prob10m - a.prob10m) || (b.confidence - a.confidence))
      .slice(0, limit);
  }

  // -------- fallback helper --------
  private async pickRecentKeys(minutes = 60, maxKeys = 50): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ key: string; hits: number }[]>`
      SELECT "key" as key, COUNT(*)::int as hits
      FROM "Signal"
      WHERE "source" = 'x_trendlist'
        AND "ts" >= NOW() - (${minutes}::int * interval '1 minute')
      GROUP BY "key"
      ORDER BY hits DESC
      LIMIT ${maxKeys}::int;
    `;
    return rows.map((r) => r.key);
  }
}

/* ===================== helpers ===================== */

function sigmoid(z: number) {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  } else {
    const ez = Math.exp(z);
    return ez / (1 + ez);
  }
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function clampInt(x: number, lo: number, hi: number) {
  const n = Number.isFinite(x) ? Math.trunc(x) : 0;
  return Math.max(lo, Math.min(hi, n));
}

function isInLastBucket(lastBucketTs: Date | null, graceMinutes = 12) {
  if (!lastBucketTs) return false;
  const now = Date.now();
  const dt = Math.abs(now - new Date(lastBucketTs).getTime());
  return dt <= graceMinutes * 60 * 1000;
}
