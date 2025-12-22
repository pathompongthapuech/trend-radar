import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TrendAliasService } from "./trend-alias.service";
import { softNormalizeKey } from "./trend-normalize";

@Injectable()
export class TrendKeyService {
  constructor(private config: ConfigService, private alias: TrendAliasService) {}

  normalize(raw: string) {
    const opt = this.config.get("trend.normalize") as any;
    return softNormalizeKey(raw, opt);
  }

  async canonicalize(raw: string) {
    const norm = this.normalize(raw);
    const canonical = await this.alias.resolveCanonicalKey(norm);
    return { rawKey: raw, normalizedKey: norm, canonicalKey: canonical };
  }

  async canonicalizeMany(keys: string[]) {
    const normKeys = keys.map(k => this.normalize(k));
    const map = await this.alias.resolveMany(normKeys);
    return normKeys.map(k => ({
      normalizedKey: k,
      canonicalKey: map.get(k) ?? k,
    }));
  }
}
