import { describe, expect, it } from 'vitest';
import { runLookup, validate, type Io } from './flow';
import { CreatorsClient, lookupAll, type Fetcher, type FetchRes } from './api';
import { abortError, marketplaceByCode, type Clock } from './core';
import { demoFetcher, DEMO_ASINS } from './demo';
import { readSheets } from './xlsx';
import token from './fixtures/token.json';
import a from './fixtures/getitems-a.json';
import b from './fixtures/getitems-b.json';
import e401 from './fixtures/error-401.json';

const cred = { clientId: 'TEST-ID', clientSecret: 'TEST-SECRET', partnerTag: 'demo-20' };
const res = (status: number, body: unknown): FetchRes => ({ status, text: async () => JSON.stringify(body), headers: { get: () => null } });
type Call = { url: string; headers: Record<string, string>; body: string };
function fake(script: (call: Call, n: number) => FetchRes | undefined = () => undefined) {
  const calls: Call[] = [];
  const f: Fetcher = async (url, init) => {
    const c = { url, headers: init.headers, body: init.body };
    calls.push(c);
    const s = script(c, calls.length);
    if (s) return s;
    if (url.includes('/auth/o2/token')) return res(200, token);
    return res(200, calls.filter((x) => x.url.includes('getItems')).length === 1 ? a : b);
  };
  return { f, calls };
}
const clock = () => { let t = 1_000_000; const sleeps: number[] = []; const c: Clock = { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } }; return { c, sleeps }; };
const memIo = () => { const files = new Map<string, Uint8Array>(); const io: Io = { mkdir: async () => {}, join: async (...p) => p.join('/'), writeFile: async (p, d) => { files.set(p, d); } }; return { io, files }; };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `EXAMPLE${String(i).padStart(3, '0')}`);
const US = marketplaceByCode('US')!;

describe('查询流程', () => {
  it('校验', () => {
    expect(validate({ clientId: '', clientSecret: '', partnerTag: '' }, 'US', ['A'], false)).toContain('Credential ID');
    expect(validate(cred, 'XX', ['A'], false)).toContain('站点');
    expect(validate(cred, 'US', [], false)).toContain('ASIN');
    expect(validate({ clientId: '', clientSecret: '', partnerTag: '' }, 'US', ['A'], true)).toBeNull();
  });
  it('分批请求：12 个 ASIN 分两批，请求头与令牌正确，只换一次令牌', async () => {
    const { f, calls } = fake();
    const { c, sleeps } = clock();
    const rows = await lookupAll(new CreatorsClient(cred, US, f, c), ids(12), c, () => {});
    const api = calls.filter((x) => x.url.includes('getItems'));
    expect(api).toHaveLength(2);
    expect(calls.filter((x) => x.url.includes('/auth/o2/token'))).toHaveLength(1);
    expect(JSON.parse(api[0].body).itemIds).toHaveLength(10);
    expect(JSON.parse(api[1].body).itemIds).toHaveLength(2);
    expect(api[0].headers).toMatchObject({ Authorization: 'Bearer TEST-ACCESS-TOKEN', 'x-marketplace': 'www.amazon.com' });
    expect(api[0].url).toBe('https://creatorsapi.amazon/catalog/v1/getItems');
    expect(sleeps).toEqual([1100]);
    expect(rows).toHaveLength(12);
  });
  it('429 退避后重试成功', async () => {
    let n = 0;
    const { f } = fake((c) => (c.url.includes('getItems') && n++ < 2 ? res(429, {}) : undefined));
    const { c, sleeps } = clock();
    const rows = await lookupAll(new CreatorsClient(cred, US, f, c), ['EXAMPLE004'], c, () => {});
    expect(sleeps).toEqual([2000, 4000]);
    expect(rows[0].status).toBe('已查到');
  });
  it('401 终止并给出说明', async () => {
    const { f } = fake((c) => (c.url.includes('/auth/o2/token') ? res(401, e401) : undefined));
    const { c } = clock();
    await expect(lookupAll(new CreatorsClient(cred, US, f, c), ['EXAMPLE001'], c, () => {})).rejects.toThrow('凭据无效');
  });
  it('某批网络错误只标记该批失败', async () => {
    let n = 0;
    const { f } = fake((c) => { if (c.url.includes('getItems') && ++n === 2) throw new Error('网络断开'); });
    const { c } = clock();
    const rows = await lookupAll(new CreatorsClient(cred, US, f, c), ids(12), c, () => {});
    expect(rows.slice(0, 10).every((r) => r.status !== '失败')).toBe(true);
    expect(rows.slice(10).map((r) => r.status)).toEqual(['失败', '失败']);
    expect(rows[10].note).toBe('网络断开');
  });
  it('停止', async () => {
    const ac = new AbortController();
    const { f } = fake(() => { ac.abort(); return undefined; });
    const { c } = clock();
    await expect(lookupAll(new CreatorsClient(cred, US, f, c), ids(25), c, () => {}, ac.signal)).rejects.toMatchObject({ name: abortError().name });
  });
  it('演示模式端到端：写出 Excel 并读回', async () => {
    const { io, files } = memIo();
    const r = await runLookup({ cred: { clientId: '', clientSecret: '', partnerTag: '' }, market: 'US', asins: DEMO_ASINS.split('\n'), fetcher: demoFetcher, clock: clock().c, io, outDir: '/out', now: new Date(2026, 9, 23, 9, 5), progress: () => {}, demo: true });
    expect(r.path).toBe('/out/亚马逊ASIN查询-DEMO-20261023-0905.xlsx');
    expect(r.sum).toMatchObject({ total: 12, missing: 1 });
    const sheets = await readSheets(files.get(r.path)!, 'x.xlsx');
    expect(sheets.map((s) => s.name)).toEqual(['查询结果', '说明']);
    expect(sheets[0].grid).toHaveLength(13);
    expect(sheets[0].grid[0].slice(0, 3)).toEqual(['ASIN', '标题', '价格']);
    expect(String(sheets[1].grid.flat())).toContain('演示数据');
  });
});
