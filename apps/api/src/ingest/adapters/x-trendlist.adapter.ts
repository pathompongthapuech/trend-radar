import { Injectable } from "@nestjs/common";
import { request } from "undici";
import { SourceAdapter } from "../source-adapter";
import { NormalizedSignal } from "@core";

type TrendRow = { rank: number; tag: string };

@Injectable()
export class XTrendListAdapter implements SourceAdapter {
  name = "x_trendlist" as const;

  // รองรับ signature เผื่อ ingest ส่ง since/cursor มา (ไม่ใช้ตอนนี้)
  async fetch(_sinceISO?: string, _cursor?: string | null) {
    const now = new Date();

    // 10-min bucket (snapshot)
    const BUCKET_MS = 10 * 60 * 1000;
    const bucket = new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS);

    const url = process.env.X_TRENDLIST_URL || "https://getdaytrends.com/thailand/";
    const { body, statusCode } = await request(url, {
      headers: { "user-agent": "trend-radar-th/0.1" },
    });

    if (statusCode !== 200) {
      const txt = await body.text();
      throw new Error(`Trendlist HTTP ${statusCode}: ${txt.slice(0, 200)}`);
    }

    const html = await body.text();

    // 1) พยายามดึง "rank + hashtag" จากโครงสร้างหน้า (ถ้า regex นี้แมตช์)
    const ranked = extractRankedTrends(html)
      .map(r => ({ rank: r.rank, tag: cleanHashtag(r.tag) }))
      .filter(r => r.tag && !STOP_TAGS.has(r.tag))
      // กัน rank แปลกๆ
      .filter(r => Number.isFinite(r.rank) && r.rank >= 1 && r.rank <= 100);

    // 2) fallback: ดึง hashtag ตามลำดับที่เจอ (เดิมของคุณ)
    // รองรับไทย: ก-๙, a-z, 0-9, _
    const raw = html.match(/#[A-Za-z0-9_\u0E00-\u0E7F]{2,80}/g) ?? [];
    const tagsFallback = Array.from(new Set(raw.map(cleanHashtag)))
      .filter(Boolean)
      .filter(tag => !STOP_TAGS.has(tag))
      .slice(0, 50);

    // เลือกใช้ ranked ถ้ามีจริง ไม่งั้นใช้ fallback
    const top: TrendRow[] =
      ranked.length >= 10
        ? // ranked มีโอกาสซ้ำ tag หลายที่ -> unique by tag โดยเก็บ rank ดีสุด
          uniqueBestRank(ranked).slice(0, 50)
        : tagsFallback.map((tag, idx) => ({ tag, rank: idx + 1 }));

    const signals: NormalizedSignal[] = top.map((r) => ({
      source: "x_trendlist",
      // ✅ เก็บเป็น ISO เพื่อความนิ่ง + ไม่เพี้ยน timezone
      ts: bucket.toISOString(),
      geo: "TH",
      key: r.tag,
      kind: "rank",
      // value = rank (เลขน้อย=แรง)
      value: r.rank,
      // ✅ สำคัญ: SQL ของคุณอ่าน meta.rank
      meta: { url, rank: r.rank, bucket: bucket.toISOString() },
    }));

    return { cursor: null, signals };
  }

  async healthcheck() {
    return { ok: true };
  }
}

/**
 * พยายาม extract (rank, hashtag) จาก HTML แบบ tolerant
 * ถ้าโครงสร้างหน้าเปลี่ยนบ่อย ยังมี fallback ใน fetch()
 */
function extractRankedTrends(html: string): TrendRow[] {
  const out: TrendRow[] = [];

  // Strategy A: รูปแบบที่เจอบ่อย: ...>1<...>#tag<...
  // ดึง rank ก่อน แล้วตามด้วย hashtag ใกล้ ๆ กัน
  // NOTE: ไม่พึ่ง class ชื่อเฉพาะ เพื่อทนต่อการเปลี่ยน markup
  const reA = /(?:^|>|\s)(\d{1,3})(?:\s*<\/[^>]+>\s*|[^\S\r\n]+)(#[A-Za-z0-9_\u0E00-\u0E7F]{2,80})/g;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(html)) !== null) {
    const rank = Number(m[1]);
    const tag = m[2];
    if (Number.isFinite(rank) && tag) out.push({ rank, tag });
    if (out.length > 300) break;
  }

  // Strategy B: ถ้า A ไม่เจอเลย ลองแบบ “hashtag ก่อน แล้วมี rank ใกล้ๆ”
  if (out.length < 10) {
    const reB = /(#[A-Za-z0-9_\u0E00-\u0E7F]{2,80}).{0,200}?(?:^|>|\s)(\d{1,3})(?:\s*<\/[^>]+>|[^\S\r\n])/g;
    while ((m = reB.exec(html)) !== null) {
      const tag = m[1];
      const rank = Number(m[2]);
      if (Number.isFinite(rank) && tag) out.push({ rank, tag });
      if (out.length > 300) break;
    }
  }

  return out;
}

/**
 * unique by tag โดยเก็บ rank ที่ดีที่สุด (เลขน้อยสุด)
 */
function uniqueBestRank(rows: TrendRow[]): TrendRow[] {
  const best = new Map<string, number>();
  for (const r of rows) {
    if (!r.tag) continue;
    const prev = best.get(r.tag);
    if (prev == null || r.rank < prev) best.set(r.tag, r.rank);
  }
  return Array.from(best.entries())
    .map(([tag, rank]) => ({ tag, rank }))
    .sort((a, b) => a.rank - b.rank);
}

function cleanHashtag(s: string) {
  const t = s
    .replace(/\u200b/g, "")
    .trim()
    .toLowerCase()
    .replace(/[,:;.!?\u2026]+$/g, ""); // ตัด punctuation ท้าย

  // กัน hashtag สั้น/ไม่สื่อความหมาย (ปรับได้)
  if (/^#[a-z0-9_]{1,3}$/i.test(t)) return "";
  if (/^#\d+$/.test(t)) return "";
  return t;
}

const STOP_TAGS = new Set([
  "#terms",
  "#about",
  "#moretrends",
  "#collapsiblemenue",
  "#collapsiblesearch",
]);
