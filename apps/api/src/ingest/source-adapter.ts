import { NormalizedPost, NormalizedSignal, SourceName } from "@core";

export type Cursor = string | null;

export interface FetchResult {
  cursor: Cursor;
  posts?: NormalizedPost[];
  signals?: NormalizedSignal[];
}

export interface SourceAdapter {
  name: SourceName;
  fetch(sinceISO: string, cursor?: Cursor): Promise<FetchResult>;
  healthcheck(): Promise<{ ok: boolean; note?: string }>;
}
