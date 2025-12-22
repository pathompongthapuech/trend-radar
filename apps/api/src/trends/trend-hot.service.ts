import { Injectable } from "@nestjs/common";
import { TrendCandidatesService, Candidate } from "./trend-candidates.service";

export type Hot = Candidate & {
  phase: "hot";
  reasons: string[];
};

@Injectable()
export class TrendHotService {
  constructor(private candidates: TrendCandidatesService) {}

  async getHot(hours = 24, limit = 20): Promise<Hot[]> {
    const list = await this.candidates.getCandidates(hours, 300);

    const out: Hot[] = [];

    for (const c of list) {
      const hits = c.metrics.trendlistHits ?? 0;
      const best = c.metrics.trendlistRankBest ?? 999;
      const recentHits60m = c.metrics.recentHits60m ?? 0;

      const reasons: string[] = [];

      const hotOk =
        best <= 10 &&
        hits >= 20 &&
        recentHits60m >= 2;

      if (hotOk) {
        reasons.push(`hot: hits=${hits}, bestRank=${best}, recent60m=${recentHits60m}`);
        out.push({ ...c, phase: "hot", reasons });
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
