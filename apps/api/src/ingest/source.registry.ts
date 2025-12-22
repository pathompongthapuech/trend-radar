import { Injectable } from "@nestjs/common";
import { SourceAdapter } from "./source-adapter";
import { GoogleTrendsAdapter } from "./adapters/google-trends.adapter";
import { GdeltAdapter } from "./adapters/gdelt.adapter";
import { XTrendListAdapter } from "./adapters/x-trendlist.adapter";

@Injectable()
export class SourceRegistry {
  constructor(
    private readonly googleTrends: GoogleTrendsAdapter,
    private readonly gdelt: GdeltAdapter,
    private readonly xTrendList: XTrendListAdapter,
  ) {}

  all(): SourceAdapter[] {
    return [this.googleTrends, this.gdelt, this.xTrendList];
  }

  byName(name: string): SourceAdapter | undefined {
    return this.all().find(a => a.name === name);
  }
}
