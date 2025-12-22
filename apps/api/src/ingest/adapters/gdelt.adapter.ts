import { Injectable } from "@nestjs/common";
import { request } from "undici";
import { SourceAdapter } from "../source-adapter";
import { NormalizedPost } from "@core";

type GdeltArt = {
  url: string;
  title?: string;
  seendate?: string;      // "YYYY-MM-DD HH:MM:SS"
  language?: string;
  sourceCountry?: string;
  domain?: string;
};

type GdeltJson = {
  articles?: GdeltArt[];
};

@Injectable()
export class GdeltAdapter implements SourceAdapter {
  name = "gdelt" as const;

  // GDELT 2.1 DOC API endpoint
  private baseUrl = "https://api.gdeltproject.org/api/v2/doc/doc";

  async fetch(sinceISO: string) {
    const since = new Date(sinceISO);

    // บังคับให้ window กว้างอย่างน้อย 6 ชั่วโมง
    const MIN_WINDOW_MS = 6 * 60 * 60 * 1000;

    let startDate = since;
    let endDate = new Date();

    if (endDate.getTime() - startDate.getTime() < MIN_WINDOW_MS) {
    startDate = new Date(endDate.getTime() - MIN_WINDOW_MS);
    }

    // (กันอนาคต/เวลาเพี้ยน)
    if (startDate.getTime() > endDate.getTime()) {
    startDate = new Date(endDate.getTime() - MIN_WINDOW_MS);
    }

    const start = this.toGdeltDT(startDate);
    const end = this.toGdeltDT(endDate);


    let query = process.env.GDELT_QUERY || "(thailand OR ไทย OR กรุงเทพ)";
    const maxrecords = Number(process.env.GDELT_MAXRECORDS || 50);

    // DOC 2.1: mode=ArtList + format=json
    const url = this.buildUrl({
      query,
      mode: "ArtList",
      format: "json",
      startdatetime: start,
      enddatetime: end,
      maxrecords,
      sort: "HybridRel",
    });

    const { body, statusCode } = await request(url, {
      headers: { "user-agent": "trend-radar-th/0.1" },
    });

    const rawText = await body.text();

    if (statusCode !== 200) {
      throw new Error(`GDELT HTTP ${statusCode}: ${rawText.slice(0, 200)}`);
    }

    // กันพัง: ตรวจว่าเป็น JSON ก่อน
    const trimmed = rawText.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      throw new Error(`GDELT returned non-JSON: ${trimmed.slice(0, 200)}`);
    }

    const json = JSON.parse(trimmed) as GdeltJson;
    const articles = json.articles ?? [];

    const now = new Date();

    const posts: NormalizedPost[] = articles
      .filter(a => this.isThaiish(a))
      .map(a => {
        const published = this.parseSeenDate(a.seendate) ?? now;
        const title = (a.title ?? "").trim();

        return {
          source: "gdelt",
          source_ref: a.url,
          url: a.url,
          published_at: published.toISOString(),
          collected_at: now.toISOString(),
          lang: "th",
          title: title.slice(0, 500) || undefined,
          text: this.cleanText(title || a.url),
          context: {
            geo: "TH",
            channel: a.domain || a.sourceCountry || "gdelt",
            keywords: this.extractKeywords(title),
          },
        };
      });

    return { cursor: null, posts };
  }

  async healthcheck() {
    return { ok: true };
  }

  private buildUrl(params: Record<string, string | number>) {
    const u = new URL(this.baseUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private toGdeltDT(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  }

  private parseSeenDate(seendate?: string) {
    if (!seendate) return null;
    const iso = seendate.replace(" ", "T") + "Z";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  private isThaiish(a: GdeltArt) {
    const lang = (a.language || "").toLowerCase();
    const country = (a.sourceCountry || "").toLowerCase();
    const title = (a.title || "").trim();
    if (lang.includes("thai")) return true;
    if (country.includes("thailand")) return true;
    if (/[ก-๙]/.test(title)) return true;
    return false;
  }

  private cleanText(s: string) {
    return s.replace(/\s+/g, " ").trim();
  }

  private extractKeywords(title: string) {
    return title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(w => w.length >= 3)
      .slice(0, 12);
  }
}
