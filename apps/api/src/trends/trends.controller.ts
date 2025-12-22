import { Controller, Get, Query } from "@nestjs/common";
import { TrendCandidatesService } from "./trend-candidates.service";
import { TrendEmergingService } from "./trend-emerging.service";
import { TrendHotService } from "./trend-hot.service";
import { TrendForecastService } from "./trend-forecast.service";

@Controller("trends")
export class TrendsController {
  constructor(
    private candidates: TrendCandidatesService,
    private emerging: TrendEmergingService,
    private hot: TrendHotService,
    private forecast: TrendForecastService,
  ) {}

  @Get("candidates")
  async getCandidates(
    @Query("hours") hours = "24",
    @Query("limit") limit = "20",
  ) {
    return this.candidates.getCandidates(Number(hours), Number(limit));
  }

  @Get("emerging")
  async getEmerging(
    @Query("hours") hours = "24",
    @Query("limit") limit = "10",
  ) {
    return this.emerging.getEmerging(Number(hours), Number(limit));
  }

  @Get("hot")
  async getHot(
    @Query("hours") hours = "24",
    @Query("limit") limit = "20",
  ) {
    return this.hot.getHot(Number(hours), Number(limit));
  }

  @Get("forecast")
  async forecastTrends(
    @Query("hours") hours?: string,
    @Query("limit") limit?: string,
    @Query("minutes") minutes?: string,
  ) {
    const h = hours ? Number(hours) : 24;
    const l = limit ? Number(limit) : 20;
    const m = minutes ? Number(minutes) : 10;

    if (m !== 10) {
      // MVP รองรับแค่ 10 นาที (bucket เดียว) ก่อน
      return { ok: false, error: "MVP supports only minutes=10 for now" };
    }

    const data = await this.forecast.forecast10m(h, l);
    return { ok: true, minutes: 10, results: data };
  }
}
