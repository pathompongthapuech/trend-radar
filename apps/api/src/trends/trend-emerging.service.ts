import { Injectable } from "@nestjs/common";
import { TrendCandidatesService, Candidate } from "./trend-candidates.service";

export type TrendPhase = "emerging" | "rising" | "peaking" | "fading";

export type PhasedTrend = Candidate & {
  phase: TrendPhase;
  confidence: number; // 0..100
  reasons: string[];
};

type EmergingConfig = {
  gate: {
    minHitsBuckets: number;       // trendlistHits (10m buckets in window)
    minRecent60m: number;         // recentHits60m (0..6)
  };
  phase: {
    emerging: { maxAgeHours: number; minHits: number; minRecent60m: number };
    rising: { maxAgeHours: number; minRecent60m: number; minMomentum: number };
    fading: { maxRecent60m: number; maxMomentum: number };
  };
  confidence: {
    // ปรับ scale ได้
    momentumFull: number; // mom=0.30 => 1.0
    persistenceFullBuckets: number; // hits=60 => 1.0 (ประมาณ 10 ชม)
    gdeltBonusMinHits: number;
    gdeltBonus: number; // +0.05
  };
};

const DEFAULT_CFG: EmergingConfig = {
  gate: {
    minHitsBuckets: 2,
    minRecent60m: 0, // ถ้าจะเข้มขึ้นค่อยปรับเป็น 1
  },
  phase: {
    emerging: { maxAgeHours: 6, minHits: 2, minRecent60m: 1 },
    rising: { maxAgeHours: 24, minRecent60m: 2, minMomentum: 0.03 },
    fading: { maxRecent60m: 0, maxMomentum: -0.05 },
  },
  confidence: {
    momentumFull: 0.30,
    persistenceFullBuckets: 60,
    gdeltBonusMinHits: 3,
    gdeltBonus: 0.05,
  },
};

@Injectable()
export class TrendEmergingService {
  private readonly cfg: EmergingConfig = DEFAULT_CFG;

  constructor(private candidates: TrendCandidatesService) {}

  async getEmerging(hours = 24, limit = 20): Promise<PhasedTrend[]> {
    const list = await this.candidates.getCandidates(hours, 300);
    const out: PhasedTrend[] = [];

    for (const c of list) {
      if (!c.sources?.includes("x_trendlist")) continue;

      const hits = c.metrics?.trendlistHits ?? 0;       // 10-min buckets in window
      const bestRank = c.metrics?.trendlistRankBest ?? 999;
      const recent60m = c.metrics?.recentHits60m ?? 0;  // 0..6
      const age = c.metrics?.ageHours ?? 999;
      const mom = c.metrics?.momentum ?? 0;
      const gdelt = c.metrics?.gdeltHits ?? 0;

      // -------------------------
      // Gate (soft)
      // -------------------------
      // เดิม hits<2 ตัดทิ้งเลย อาจทำให้ว่างได้ถ้าข้อมูลยังบาง
      // ยังคง default = 2 แต่ทำเป็น config และเช็ค recent60m ด้วย
      if (hits < this.cfg.gate.minHitsBuckets) continue;
      if (recent60m < this.cfg.gate.minRecent60m) continue;

      const reasons: string[] = [];
      reasons.push(`trendlist persistence ${hits} buckets (10m)`);
      if (bestRank !== 999) reasons.push(`best rank ${bestRank}`);
      if (age !== 999) reasons.push(`age ${age.toFixed(1)}h`);
      reasons.push(`recent activity ${recent60m} buckets in 60m`);
      reasons.push(`momentum ${mom.toFixed(3)}`);
      if (gdelt >= this.cfg.confidence.gdeltBonusMinHits) {
        reasons.push(`news confirmation ${gdelt} hits (gdelt)`);
      }

      // =========================
      // Phase rules (lifecycle)
      // =========================
      const isFading =
        recent60m <= this.cfg.phase.fading.maxRecent60m &&
        mom <= this.cfg.phase.fading.maxMomentum;

      const isRising =
        age <= this.cfg.phase.rising.maxAgeHours &&
        recent60m >= this.cfg.phase.rising.minRecent60m &&
        mom >= this.cfg.phase.rising.minMomentum;

      const isEmerging =
        age <= this.cfg.phase.emerging.maxAgeHours &&
        hits >= this.cfg.phase.emerging.minHits &&
        recent60m >= this.cfg.phase.emerging.minRecent60m;

      // ✅ precedence ที่ถูกกว่า: fading -> rising -> emerging -> peaking
      let phase: TrendPhase = "peaking";
      if (isFading) phase = "fading";
      else if (isRising) phase = "rising";
      else if (isEmerging) phase = "emerging";
      else phase = "peaking";

      if (phase === "emerging") reasons.push("phase=emerging: new + repeated appearance");
      if (phase === "rising") reasons.push("phase=rising: recent activity + positive momentum");
      if (phase === "peaking") reasons.push("phase=peaking: sustained but not accelerating");
      if (phase === "fading") reasons.push("phase=fading: no recent activity + negative momentum");

      // =========================
      // Confidence (0..100)
      // =========================

      // rankStrength: ถ้าไม่รู้ rank จริง ๆ (999) ให้ 0 และลดการพึ่ง rank ในสูตรด้วย
      const hasRank = bestRank !== 999;
      const rankStrength =
        !hasRank ? 0 :
        bestRank <= 3 ? 1 :
        bestRank <= 5 ? 0.9 :
        bestRank <= 10 ? 0.75 :
        bestRank <= 20 ? 0.55 :
        bestRank <= 30 ? 0.35 : 0.2;

      const persistenceStrength = clamp01(hits / this.cfg.confidence.persistenceFullBuckets);
      const recencyStrength = clamp01(recent60m / 6);
      const momentumStrength = clamp01(mom / this.cfg.confidence.momentumFull);

      const ageFresh =
        age <= 2 ? 1 :
        age <= 6 ? 0.9 :
        age <= 24 ? 0.7 :
        age <= 48 ? 0.45 : 0.3;

      let conf01 = 0;

      if (phase === "emerging") {
        // ถ้าไม่มี rank ให้ redistribute weight ไปที่ recency/persistence
        const wRank = hasRank ? 0.15 : 0.0;
        const wExtra = hasRank ? 0.0 : 0.15;

        conf01 =
          0.35 * ageFresh +
          (0.30 + wExtra * 0.60) * recencyStrength +
          (0.20 + wExtra * 0.40) * persistenceStrength +
          wRank * rankStrength;
      } else if (phase === "rising") {
        const wRank = hasRank ? 0.20 : 0.0;
        const wExtra = hasRank ? 0.0 : 0.20;

        conf01 =
          0.30 * recencyStrength +
          0.30 * momentumStrength +
          0.20 * ageFresh +
          wRank * rankStrength +
          wExtra * persistenceStrength;
      } else if (phase === "peaking") {
        const wRank = hasRank ? 0.40 : 0.0;
        const wExtra = hasRank ? 0.0 : 0.40;

        conf01 =
          wRank * rankStrength +
          0.35 * persistenceStrength +
          0.15 * recencyStrength +
          0.10 * ageFresh +
          wExtra * persistenceStrength;
      } else {
        // fading
        const lowRecency = recent60m === 0 ? 1 : recent60m <= 1 ? 0.6 : 0.2;
        const negMom = mom <= -0.2 ? 1 : mom <= -0.05 ? 0.7 : 0.3;
        conf01 = 0.55 * lowRecency + 0.45 * negMom;
      }

      if (gdelt >= this.cfg.confidence.gdeltBonusMinHits) {
        conf01 = Math.min(1, conf01 + this.cfg.confidence.gdeltBonus);
      }

      const confidence = Math.max(0, Math.min(100, Math.round(conf01 * 100)));
      out.push({ ...c, phase, confidence, reasons });
    }

    // จัดอันดับ: score เป็นหลัก + boost เล็กน้อยให้ emerging/rising ที่มั่นใจ
    return out
      .sort((a, b) => {
        const boost = (t: PhasedTrend) =>
          (t.phase === "emerging" ? 25 : t.phase === "rising" ? 20 : t.phase === "peaking" ? 10 : 0) +
          t.confidence * 0.1;
        return (b.score + boost(b)) - (a.score + boost(a));
      })
      .slice(0, limit);
  }
}

/* ===================== helpers ===================== */

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
