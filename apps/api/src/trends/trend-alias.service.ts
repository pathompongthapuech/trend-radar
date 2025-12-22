import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";

type AliasMap = Map<string, string>; // rawKey -> canonicalKey

@Injectable()
export class TrendAliasService {
  private cache: { map: AliasMap; expiresAt: number } | null = null;

  constructor(private prisma: PrismaService, private config: ConfigService) {}

  private async loadMapFromDb(): Promise<AliasMap> {
    const rows = await this.prisma.trendAlias.findMany({
      where: { enabled: true },
      select: { rawKey: true, canonicalKey: true },
    });

    const map: AliasMap = new Map();
    for (const r of rows) map.set(r.rawKey, r.canonicalKey);
    return map;
  }

  private get ttlMs() {
    return Number(this.config.get("trend.alias.cacheTtlMs") ?? 60000);
  }

  async getMap(): Promise<AliasMap> {
    const enabled = Boolean(this.config.get("trend.alias.enabled") ?? true);
    if (!enabled) return new Map();

    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) return this.cache.map;

    const map = await this.loadMapFromDb();
    this.cache = { map, expiresAt: now + this.ttlMs };
    return map;
  }

  async resolveCanonicalKey(rawKey: string): Promise<string> {
    const map = await this.getMap();
    return map.get(rawKey) ?? rawKey;
  }

  async resolveMany(rawKeys: string[]): Promise<Map<string, string>> {
    const map = await this.getMap();
    const out = new Map<string, string>();
    for (const k of rawKeys) out.set(k, map.get(k) ?? k);
    return out;
  }
}
