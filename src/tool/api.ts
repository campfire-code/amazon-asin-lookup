// Creators API 客户端：换令牌（OAuth 2.0 client_credentials）→ 分批 GetItems。网络函数由外部注入，测试用录制响应。
import {
  GAP_MS, GET_ITEMS_URL, MAX_IDS, REGIONS, abortError, apiHeaders, backoffMs, chunk, explainError, getItemsBody, mergeRows, parseBatch, realClock, tokenBody,
  type BatchResult, type Clock, type Credentials, type Item, type Marketplace, type ResultRow,
} from './core';

export interface FetchRes { status: number; text(): Promise<string>; headers: { get(name: string): string | null } }
export type Fetcher = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<FetchRes>;
export type Progress = (p: { done: number; total: number; note?: string }) => void;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const MAX_RETRY = 4;

export class CreatorsClient {
  private token: { value: string; until: number } | null = null;
  constructor(private cred: Credentials, private m: Marketplace, private fetcher: Fetcher, private clock: Clock = realClock) {}

  /** 令牌有效期官方说明为 3600 秒，提前 60 秒刷新 */
  async accessToken(signal?: AbortSignal): Promise<string> {
    const now = this.clock.now();
    if (this.token && this.token.until > now) return this.token.value;
    const res = await this.fetcher(REGIONS[this.m.region].tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: tokenBody(this.cred), signal });
    const text = await res.text();
    if (res.status !== 200) throw new ApiError(res.status, explainError(res.status, text));
    const j = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new ApiError(res.status, '授权服务没有返回访问令牌');
    this.token = { value: j.access_token, until: now + Math.max(60, (j.expires_in ?? 3600) - 60) * 1000 };
    return j.access_token;
  }

  async getItems(ids: string[], signal?: AbortSignal): Promise<BatchResult> {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      const token = await this.accessToken(signal);
      const res = await this.fetcher(GET_ITEMS_URL, { method: 'POST', headers: apiHeaders(token, this.m), body: getItemsBody(ids, this.m, this.cred.partnerTag), signal });
      const text = await res.text();
      if (res.status === 200) return parseBatch(JSON.parse(text), ids);
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRY) { await this.clock.sleep(backoffMs(attempt), signal); continue; }
      if (res.status === 401 && attempt === 0) { this.token = null; continue; }
      throw new ApiError(res.status, explainError(res.status, text));
    }
  }
}

/** 逐批查询：某批整体失败（如网络错误）只标记该批 ASIN 失败；凭据/权限类错误（401/403）直接终止，避免重复请求 */
export async function lookupAll(client: CreatorsClient, asins: string[], clock: Clock, progress: Progress, signal?: AbortSignal): Promise<ResultRow[]> {
  const found: Item[] = [];
  const errors: BatchResult['errors'] = [];
  const failed = new Map<string, string>();
  const batches = chunk(asins, MAX_IDS);
  for (let i = 0; i < batches.length; i++) {
    if (signal?.aborted) throw abortError();
    progress({ done: i * MAX_IDS, total: asins.length });
    try {
      const r = await client.getItems(batches[i], signal);
      found.push(...r.items);
      errors.push(...r.errors);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 400)) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      batches[i].forEach((a) => failed.set(a, msg));
    }
    if (i < batches.length - 1) await clock.sleep(GAP_MS, signal);
  }
  progress({ done: asins.length, total: asins.length });
  return mergeRows(asins, found, errors, failed);
}
