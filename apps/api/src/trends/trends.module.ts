import { Module } from "@nestjs/common";
import { TrendsController } from "./trends.controller";
import { PrismaService } from "../prisma.service";
import { TrendCandidatesService } from "./trend-candidates.service";
import { TrendEmergingService } from "./trend-emerging.service";
import { TrendHotService } from "./trend-hot.service";
import { TrendForecastService } from "./trend-forecast.service";
import { TrendAliasService } from "./trend-alias.service";
import { TrendKeyService } from "./trend-key.service";

@Module({
  controllers: [TrendsController],
  providers: [PrismaService, TrendCandidatesService, TrendEmergingService, TrendHotService, TrendForecastService, TrendKeyService, TrendAliasService],
  exports: [TrendCandidatesService, TrendEmergingService, TrendHotService, TrendForecastService, TrendKeyService, TrendAliasService],
})
export class TrendsModule {}
