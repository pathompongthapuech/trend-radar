import { Injectable } from "@nestjs/common";
import { SourceAdapter } from "../source-adapter";

@Injectable()
export class GoogleTrendsAdapter implements SourceAdapter {
  name = "google_trends" as const;

  async fetch(sinceISO: string) {
    // Phase B: ยังไม่ implement จริง (เราจะใส่ใน Step ถัดไป)
    return { cursor: null, signals: [] };
  }

  async healthcheck() { return { ok: true }; }
}
