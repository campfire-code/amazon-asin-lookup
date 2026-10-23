// 查询流程：校验 → 查询 → 写出 Excel。文件读写由外部注入。
import { CreatorsClient, lookupAll, type Fetcher, type Progress } from './api';
import { COLS, credReady, exportFileName, marketplaceByCode, rowToRecord, summary, type Clock, type Credentials, type ResultRow } from './core';
import { realClock } from './core';
import { writeXlsx } from './xlsx';

export interface Io {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  join(...parts: string[]): Promise<string>;
}
export interface Outcome { path: string; rows: ResultRow[]; sum: ReturnType<typeof summary> }

export function validate(cred: Credentials, market: string, asins: string[], demo: boolean): string | null {
  if (!demo && !credReady(cred)) return '请先填写 Credential ID、Credential Secret 和 Partner Tag（见「怎么申请」）';
  if (!marketplaceByCode(market)) return '请选择站点';
  if (!asins.length) return '请先输入或导入至少一个有效的 ASIN';
  return null;
}

export async function runLookup(a: {
  cred: Credentials; market: string; asins: string[]; fetcher: Fetcher; clock?: Clock; io: Io; outDir: string; now: Date; progress: Progress; signal?: AbortSignal; demo?: boolean;
}): Promise<Outcome> {
  const err = validate(a.cred, a.market, a.asins, !!a.demo);
  if (err) throw new Error(err);
  const m = marketplaceByCode(a.market)!;
  const clock = a.clock ?? realClock;
  const rows = await lookupAll(new CreatorsClient(a.cred, m, a.fetcher, clock), a.asins, clock, a.progress, a.signal);
  const sum = summary(rows);
  const info: (string | number)[][] = [
    ['查询时间', a.now.toLocaleString('zh-CN')], ['站点', `${m.name}（${m.code}，${m.domain}）`],
    ['数据来源', '亚马逊官方 Creators API（GetItems），未抓取网页'],
    ['结果', `共 ${sum.total} 个，查到 ${sum.ok}，未返回 ${sum.missing}，失败 ${sum.failed}`],
    ['说明', '价格以接口返回为准，可能与页面实时价格有差异；价格字段结构未经官方文档核实'],
  ];
  if (a.demo) info.push(['注意', '演示数据（虚构），不是真实商品']);
  const bytes = await writeXlsx([
    { name: '查询结果', header: COLS.map((c) => c[1]), rows: rows.map((r) => { const rec = rowToRecord(r); return COLS.map((c) => rec[c[0]] ?? ''); }), formats: ['text', 'text', 'money', 'text', 'text', 'text', 'text', 'text', 'text', 'text'] },
    { name: '说明', header: ['项目', '内容'], rows: info as never },
  ]);
  await a.io.mkdir(a.outDir);
  const path = await a.io.join(a.outDir, exportFileName(a.demo ? 'DEMO' : m.code, a.now));
  await a.io.writeFile(path, bytes);
  return { path, rows, sum };
}
