// 亚马逊 ASIN 批量查询：纯函数部分（解析 ASIN、站点、请求体、响应整理、错误说明）。
// 数据来源只有一个：亚马逊官方 Creators API 的 GetItems（需要 Associates 账号下创建的凭据）。本工具不抓取网页。
import type { Cell } from './common';

export type RegionId = 'na' | 'eu' | 'fe';
/** 令牌地址与区域对应关系，来自 Creators API 官方文档「Using cURL」页（NA 3.1 / EU 3.2 / FE 3.3） */
export const REGIONS: Record<RegionId, { name: string; tokenUrl: string }> = {
  na: { name: '北美', tokenUrl: 'https://api.amazon.com/auth/o2/token' },
  eu: { name: '欧洲', tokenUrl: 'https://api.amazon.co.uk/auth/o2/token' },
  fe: { name: '远东', tokenUrl: 'https://api.amazon.co.jp/auth/o2/token' },
};
export const API_BASE = 'https://creatorsapi.amazon';
export const GET_ITEMS_URL = `${API_BASE}/catalog/v1/getItems`;
/** 官方文档：GetItems 的 itemIds 每次最多 10 个 */
export const MAX_IDS = 10;

export interface Marketplace { code: string; name: string; domain: string; region: RegionId }
/** 站点与区域归属来自官方文档（NA：US/CA/MX/BR；EU：UK/DE/FR/IT/ES 等；FE：JP/SG/AU）。域名按亚马逊常规域名填写，未逐个核实，以官方文档为准。 */
export const MARKETPLACES: Marketplace[] = [
  { code: 'US', name: '美国', domain: 'www.amazon.com', region: 'na' },
  { code: 'CA', name: '加拿大', domain: 'www.amazon.ca', region: 'na' },
  { code: 'UK', name: '英国', domain: 'www.amazon.co.uk', region: 'eu' },
  { code: 'DE', name: '德国', domain: 'www.amazon.de', region: 'eu' },
  { code: 'FR', name: '法国', domain: 'www.amazon.fr', region: 'eu' },
  { code: 'IT', name: '意大利', domain: 'www.amazon.it', region: 'eu' },
  { code: 'ES', name: '西班牙', domain: 'www.amazon.es', region: 'eu' },
  { code: 'JP', name: '日本', domain: 'www.amazon.co.jp', region: 'fe' },
  { code: 'AU', name: '澳大利亚', domain: 'www.amazon.com.au', region: 'fe' },
];
export const marketplaceByCode = (c: string) => MARKETPLACES.find((m) => m.code === c);

export interface Credentials { clientId: string; clientSecret: string; partnerTag: string }
export const credReady = (c: Credentials) => Boolean(c.clientId.trim() && c.clientSecret.trim() && c.partnerTag.trim());
export function maskSecret(s: string): string {
  if (!s) return '';
  return s.length <= 8 ? '••••' : `${s.slice(0, 3)}••••${s.slice(-2)}`;
}

// ---------- ASIN 解析 ----------
/** ASIN 是 10 位字母数字（常见规则，亚马逊未在本工具查阅的官方页面里给出形式化定义，故只做格式初筛，最终以接口结果为准） */
const ASIN_RE = /^[A-Z0-9]{10}$/;
const URL_RE = /amazon\.[a-z.]+\/(?:[^\s/]+\/)?(?:dp|gp\/product|gp\/aw\/d)\/([A-Za-z0-9]{10})/gi;

export interface ParsedAsins { asins: string[]; invalid: string[]; duplicates: number }

/** 从粘贴文本里取 ASIN：支持换行、逗号、空格、制表符分隔，也支持商品链接（.../dp/ASIN） */
export function parseAsins(text: string): ParsedAsins {
  const seen = new Set<string>();
  const asins: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  const add = (raw: string) => {
    const a = raw.trim().toUpperCase();
    if (!a) return;
    if (!ASIN_RE.test(a)) { if (!invalid.includes(raw.trim())) invalid.push(raw.trim()); return; }
    if (seen.has(a)) { duplicates++; return; }
    seen.add(a);
    asins.push(a);
  };
  const rest = text.replace(URL_RE, (_m, id: string) => { add(id); return ' '; });
  for (const tok of rest.split(/[\s,，、;；]+/)) add(tok);
  return { asins, invalid, duplicates };
}

/** 把二维表里所有单元格拼成文本，交给 parseAsins（表头等非 ASIN 文字会进入 invalid，由界面忽略表头） */
export function gridToText(grid: Cell[][]): string {
  return grid.map((r) => r.map((c) => (c == null ? '' : String(c))).join('\t')).join('\n');
}

export const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

// ---------- 请求 ----------
export function tokenBody(c: Credentials): string {
  return JSON.stringify({ grant_type: 'client_credentials', client_id: c.clientId.trim(), client_secret: c.clientSecret.trim(), scope: 'creatorsapi::default' });
}
/** 资源名来自官方 GetItems 文档：标题、主图、价格、父 ASIN */
export const RESOURCES = ['itemInfo.title', 'images.primary.medium', 'offersV2.listings.price', 'parentASIN'];
export function getItemsBody(ids: string[], m: Marketplace, partnerTag: string): string {
  return JSON.stringify({ itemIds: ids, itemIdType: 'ASIN', marketplace: m.domain, partnerTag: partnerTag.trim(), resources: RESOURCES });
}
export const apiHeaders = (token: string, m: Marketplace) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-marketplace': m.domain });

// ---------- 响应整理 ----------
export interface Item {
  asin: string; title: string; price: string; currency: string; priceText: string; image: string; url: string; parentAsin: string;
}
type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** 价格结构在官方 GetItems 页的示例里没有给出（未核实）。这里按 offersV2.listings[].price.money 与 price 直接带 amount 两种形态容错读取，读不到就留空，不猜。 */
export function readPrice(listing: unknown): { amount: string; currency: string; text: string } {
  const p = o(o(listing).price);
  const money = o(p.money);
  const src = Object.keys(money).length ? money : p;
  const amount = s(src.amount);
  return { amount, currency: s(src.currency), text: s(src.displayAmount) || s(p.displayAmount) };
}

export function readItem(raw: unknown): Item {
  const it = o(raw);
  const listings = o(it.offersV2).listings;
  const price = readPrice(Array.isArray(listings) ? listings[0] : undefined);
  return {
    asin: s(it.asin).toUpperCase(),
    title: s(o(o(it.itemInfo).title).displayValue),
    price: price.amount, currency: price.currency, priceText: price.text,
    image: s(o(o(o(it.images).primary).medium).url) || s(o(o(o(it.images).primary).small).url),
    url: s(it.detailPageURL), parentAsin: s(it.parentASIN),
  };
}

export interface BatchResult { items: Item[]; errors: { asin: string; message: string }[] }
/** 官方文档对成功响应的容器名前后不一致：参数页写 itemResults，cURL 示例写 itemsResult，两种都读。错误数组的内部结构未核实，只取 message / code 文本，并尝试从文本里认出 ASIN。 */
export function parseBatch(json: unknown, requested: string[]): BatchResult {
  const j = o(json);
  const container = o(j.itemsResult ?? j.itemResults);
  const items = (Array.isArray(container.items) ? container.items : []).map(readItem).filter((i) => i.asin);
  const errors: BatchResult['errors'] = [];
  if (Array.isArray(j.errors)) {
    for (const e of j.errors) {
      const msg = s(o(e).message) || s(o(e).code) || '接口返回了错误';
      const hit = requested.find((a) => msg.toUpperCase().includes(a));
      errors.push({ asin: hit ?? '', message: msg });
    }
  }
  return { items, errors };
}

export type RowStatus = '已查到' | '未返回' | '失败';
export interface ResultRow { asin: string; status: RowStatus; note: string; item?: Item }

/** 合并多批结果：按 asin 匹配（官方说明返回顺序可能与请求不同），按请求顺序输出 */
export function mergeRows(asins: string[], found: Item[], errors: BatchResult['errors'], failedBatches: Map<string, string>): ResultRow[] {
  const by = new Map(found.map((i) => [i.asin, i]));
  return asins.map((a): ResultRow => {
    const it = by.get(a);
    if (it) return { asin: a, status: '已查到', note: it.price || it.priceText ? '' : '接口未返回价格（可能无在售报价，或价格字段未核实）', item: it };
    if (failedBatches.has(a)) return { asin: a, status: '失败', note: failedBatches.get(a)! };
    const e = errors.find((x) => x.asin === a);
    return { asin: a, status: '未返回', note: e?.message ?? '接口没有返回这个 ASIN（可能不存在、不属于该站点或无权限）' };
  });
}

export const COLS: [string, string, number][] = [
  ['asin', 'ASIN', 14], ['title', '标题', 60], ['price', '价格', 10], ['currency', '币种', 8], ['priceText', '价格显示', 14],
  ['status', '状态', 9], ['note', '说明', 36], ['parent', '父ASIN', 14], ['url', '商品链接', 50], ['image', '主图', 40],
];
export function rowToRecord(r: ResultRow): Record<string, string | number> {
  const i = r.item;
  return {
    asin: r.asin, title: i?.title ?? '', price: i?.price && !Number.isNaN(Number(i.price)) ? Number(i.price) : i?.price ?? '', currency: i?.currency ?? '',
    priceText: i?.priceText ?? '', status: r.status, note: r.note, parent: i?.parentAsin ?? '', url: i?.url ?? '', image: i?.image ?? '',
  };
}

export function summary(rows: ResultRow[]) {
  const ok = rows.filter((r) => r.status === '已查到').length;
  return { total: rows.length, ok, missing: rows.filter((r) => r.status === '未返回').length, failed: rows.filter((r) => r.status === '失败').length, priced: rows.filter((r) => r.item?.price || r.item?.priceText).length };
}

export function exportFileName(code: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `亚马逊ASIN查询-${code}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.xlsx`;
}

// ---------- 时钟、退避与错误 ----------
export interface Clock { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }
export const abortError = () => Object.assign(new Error('已停止'), { name: 'AbortError' });
export const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise((res, rej) => {
    if (signal?.aborted) return rej(abortError());
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(abortError()); }, { once: true });
  }),
};
/** 请求间隔与重试等待是本工具的保守取值，不是亚马逊给出的限额（官方限速页未核实） */
export const GAP_MS = 1100;
export const backoffMs = (attempt: number) => Math.min(60_000, 2000 * 2 ** attempt);

export function explainError(status: number, body: string): string {
  let detail = '';
  try { const j = o(JSON.parse(body)); detail = s(j.message) || s(j.error_description) || s(j.error) || s(j.reason); } catch { /* 非 JSON */ }
  const tail = detail ? `（${detail.slice(0, 120)}）` : '';
  if (status === 400) return `请求被拒绝（400）${tail}：检查 ASIN、站点和 Partner Tag 是否匹配`;
  if (status === 401) return `凭据无效或已过期（401）${tail}：检查 Credential ID / Secret，以及凭据版本是否与站点区域一致`;
  if (status === 403) return `没有权限（403）${tail}：Associates 账号可能不满足使用条件，或凭据未授权该站点`;
  if (status === 429) return `请求太频繁（429）${tail}`;
  if (status >= 500) return `亚马逊服务暂时不可用（${status}）${tail}`;
  return `请求失败（${status}）${tail}`;
}
