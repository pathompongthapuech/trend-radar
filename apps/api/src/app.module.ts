import { Module } from "@nestjs/common";
import trendConfig from "./config/trend.config";
import { ConfigModule } from "@nestjs/config";
import { IngestModule } from "./ingest/ingest.module";
import { TrendsModule } from "./trends/trends.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [trendConfig],
    }),
    IngestModule, 
    TrendsModule
  ],
})
export class AppModule {}
