export type SourceName = "x_trendlist" | "x_official" | "pantip" | "gdelt" | "google_trends";

export interface NormalizedPost {
  source: SourceName;
  source_ref: string;
  url?: string;
  published_at: string;
  collected_at: string;
  lang: "th";
  text: string;
  title?: string;
  author_hash?: string;
  metrics?: {
    likes?: number; replies?: number; reposts?: number; views?: number;
    comments?: number; upvotes?: number;
  };
  context?: {
    hashtags?: string[];
    keywords?: string[];
    channel?: string;
    geo?: "TH";
  };
}

export interface NormalizedSignal {
  source: SourceName;
  ts: string;
  geo: "TH";
  key: string;
  kind: "interest" | "rank" | "count";
  value: number;
  meta?: Record<string, any>;
}
