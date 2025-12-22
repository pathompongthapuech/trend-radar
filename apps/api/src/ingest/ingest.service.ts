import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma.service";
import { SourceRegistry } from "./source.registry";
import { NormalizedPost, NormalizedSignal } from "@core";
import { ok } from "node:assert";

type SourcesYml = {
  sources: Array<{ name: string; enabled: boolean; schedule_cron: string; weight: number; config?: any }>;
  feature_flags?: Record<string, any>;
};

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly cfgPath = path.join(process.cwd(), "sources.yml");

  constructor(private prisma: PrismaService, private registry: SourceRegistry) {}

  // MVP: cron เดียว “ทุก 5 นาที” แล้วค่อยแยกตาม schedule_cron ในสเต็ปถัดไป
  @Cron("*/5 * * * *")
  async runTick() {
    const cfg = this.loadConfig();
    const enabled = cfg.sources.filter(s => s.enabled);

    const results: Array<any> = [];

    for (const s of enabled) {
      const adapter = this.registry.byName(s.name);
      if (!adapter) {
        results.push({ source: s.name, ok: false, error: "adapter not found" });
        continue;
      }

      try {
        const cursorRow = await this.prisma.ingestCursor.upsert({
          where: { id: s.name },
          update: {},
          create: {
            id: s.name,
            cursor: null,
            lastSinceISO: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          },
        });

        const res = await adapter.fetch(cursorRow.lastSinceISO, cursorRow.cursor);

        const postsN = res.posts?.length ?? 0;
        const signalsN = res.signals?.length ?? 0;

        if (postsN) await this.savePosts(res.posts!);
        if (signalsN) await this.saveSignals(res.signals!);

        // อัปเดต cursor เสมอเมื่อสำเร็จ
        await this.prisma.ingestCursor.update({
          where: { id: s.name },
          data: {
            cursor: res.cursor ?? null,
            // แนะนำ: ถ้าไม่มีอะไรเลย ให้ "อย่าเลื่อน since" เพื่อไม่พลาด (กันแหล่งที่ส่งช้า)
            lastSinceISO: (postsN || signalsN)
              ? new Date().toISOString()
              : cursorRow.lastSinceISO,
          },
        });

        this.logger.log(`Ingested ${s.name}: posts=${postsN} signals=${signalsN}`);

        results.push({ source: s.name, posts: postsN, signals: signalsN, ok: true });
      } catch (err: any) {
        this.logger.error(`Ingest failed for ${s.name}: ${err?.message || err}`, err?.stack);
        results.push({ source: s.name, error: err?.message || "unknown error", ok: false });
        // ไม่ throw เพื่อให้ source อื่นยังทำงานต่อ
        continue;
      }
    }

    return { ok: true, results };
  }

  private loadConfig(): SourcesYml {
    const raw = fs.readFileSync(this.cfgPath, "utf-8");
    return yaml.load(raw) as SourcesYml;
  }

  private async savePosts(posts: NormalizedPost[]) {
    for (const p of posts) {
      await this.prisma.post.upsert({
        where: { source_sourceRef: { source: p.source, sourceRef: p.source_ref } },
        update: {
          url: p.url,
          publishedAt: new Date(p.published_at),
          collectedAt: new Date(p.collected_at),
          lang: p.lang,
          title: p.title,
          text: p.text,
          authorHash: p.author_hash,
          metrics: p.metrics ?? undefined,
          context: p.context ?? undefined,
        },
        create: {
          source: p.source,
          sourceRef: p.source_ref,
          url: p.url,
          publishedAt: new Date(p.published_at),
          collectedAt: new Date(p.collected_at),
          lang: p.lang,
          title: p.title,
          text: p.text,
          authorHash: p.author_hash,
          metrics: p.metrics ?? undefined,
          context: p.context ?? undefined,
        },
      });
    }
  }

  private async saveSignals(signals: any[]) {
    if (!signals.length) return;

    await this.prisma.signal.createMany({
      data: signals.map(s => ({
        source: s.source,
        ts: s.ts instanceof Date ? s.ts : new Date(s.ts),
        geo: s.geo ?? "TH",
        key: s.key,
        kind: s.kind,
        value: s.value ?? null,
        meta: s.meta ?? {},
      })),
      skipDuplicates: true,
    });
  }
}
