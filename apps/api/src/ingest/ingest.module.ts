// apps/api/src/ingest/ingest.module.ts
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ConfigModule } from "@nestjs/config";

import { PrismaService } from "../prisma.service";
import { IngestService } from "./ingest.service";
import { SourceRegistry } from "./source.registry";

// Adapters
import { GoogleTrendsAdapter } from "./adapters/google-trends.adapter";
import { GdeltAdapter } from "./adapters/gdelt.adapter";
import { XTrendListAdapter } from "./adapters/x-trendlist.adapter";

import { IngestController } from "./ingest.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
  ],
  controllers: [IngestController],
  providers: [
    PrismaService,
    IngestService,
    SourceRegistry,

    // Adapters (Phase 1-B)
    GoogleTrendsAdapter,
    GdeltAdapter,
    XTrendListAdapter,
  ],
  exports: [
    IngestService,
    SourceRegistry,
  ],
})
export class IngestModule {}
