// 主界面：左侧填授权、站点和 ASIN，右侧显示进度、汇总和结果。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, FileUp, FolderOpen, KeyRound, Play, ShieldCheck, Square, TriangleAlert } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { defaultOutputDir, httpFetch, openLink, pickFiles, reveal } from '../kit/platform';
import { useDroppedFiles } from '../kit/parts';
import { MARKETPLACES, gridToText, isAbort, maskSecret, parseAsins, type Credentials } from './core';
import { decodeText } from './common';
import { runLookup, validate, type Outcome } from './flow';
import type { Fetcher } from './api';
import { DEMO_ASINS, demoFetcher } from './demo';
import { DEFAULT_PREFS, EMPTY_CRED, loadCred, loadPrefs, saveCred, savePrefs, type Prefs } from './store';
import { PREVIEW, isPreview } from './preview';
import { readSheets } from './xlsx';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
const DOCS = 'https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl';
// check-zh: 忽略（ASIN 格式示例，用来示范 10 位编号写法）
const ASIN_HINT = '每行一个 ASIN，例如：\nB08N5WRWNW\nB07XJ8C8F5';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const realFetcher: Fetcher = (url, init) => httpFetch(url, init) as ReturnType<Fetcher>;

export function Main({ ctx }: { ctx?: Ctx }) {
  const preview = isPreview();
  const [cred, setCred] = useState<Credentials>(EMPTY_CRED);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0 });
  const [out, setOut] = useState<Outcome | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { if (preview) return; void Promise.all([loadCred(), loadPrefs()]).then(([c, p]) => { setCred(c); setPrefs(p); }); }, []);
  const setP = (patch: Partial<Prefs>) => setPrefs((p) => { const n = { ...p, ...patch }; void savePrefs(n); return n; });
  const parsed = useMemo(() => parseAsins(prefs.asins), [prefs.asins]);

  async function importFiles(paths: string[]) {
    if (!ctx) return;
    let text = '';
    try {
      for (const p of paths) {
        const bytes = await ctx.readFile(p);
        if (/\.(xlsx|csv)$/i.test(p)) for (const sh of await readSheets(bytes, p)) text += gridToText(sh.grid) + '\n';
        else text += decodeText(bytes) + '\n';
      }
      const added = parseAsins(text).asins.length;
      setP({ asins: (prefs.asins.trim() ? prefs.asins.trim() + '\n' : '') + text.trim() });
      setNotice(`已从文件读到 ${added} 个 ASIN（表头等非 ASIN 文字会被忽略）`);
    } catch (e) { setError(errText(e)); }
  }
  const hover = useDroppedFiles((p) => void importFiles(p));

  async function start(demoOverride?: boolean) {
    const demo = demoOverride ?? prefs.demo;
    const list = demo && !parsed.asins.length ? parseAsins(DEMO_ASINS).asins : parsed.asins;
    const bad = validate(cred, prefs.market, list, demo);
    if (bad) { setError(bad); return; }
    setError(''); setNotice(''); setOut(null); setBusy(true); setProg({ done: 0, total: list.length });
    abort.current = new AbortController();
    try {
      if (!demo) await saveCred(cred);
      const outDir = preview ? '/示例/下载/亚马逊ASIN批量查询' : await defaultOutputDir('亚马逊ASIN批量查询');
      const io = ctx ?? { mkdir: async () => {}, writeFile: async () => {}, join: async (...p: string[]) => p.join('/') };
      setOut(await runLookup({ cred, market: prefs.market, asins: list, io, outDir, now: new Date(), demo, fetcher: demo ? demoFetcher : realFetcher, progress: setProg, signal: abort.current.signal, clock: demo ? { now: () => Date.now(), sleep: async () => {} } : undefined }));
    } catch (e) { setError(isAbort(e) ? '已停止' : errText(e)); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (preview && PREVIEW.autoRun) { setP({ demo: true, asins: DEMO_ASINS }); setTimeout(() => void start(true), 50); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const credInput = (key: keyof Credentials, label: string, secret: boolean) => (
    <div className="k-field">
      <label className="k-label" htmlFor={`al-${key}`}>{label}</label>
      <input id={`al-${key}`} className="k-input" type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} disabled={busy || prefs.demo}
        value={prefs.demo ? '' : cred[key]} placeholder={prefs.demo ? '演示模式不需要' : secret && cred[key] ? maskSecret(cred[key]) : ''} onChange={(e) => setCred({ ...cred, [key]: e.target.value })} />
    </div>
  );
  const show = out?.rows.slice(0, 48) ?? [];
  const prices = (out?.rows ?? []).map((r) => (r.item?.price ? Number(r.item.price) : NaN)).filter((n) => !Number.isNaN(n));
  const cur = out?.rows.find((r) => r.item?.price)?.item?.currency ?? '';
  const sameCur = (out?.rows ?? []).every((r) => !r.item?.price || r.item.currency === cur);
  const money = (n: number) => `${cur === 'USD' || !cur ? '$' : `${cur} `}${n.toFixed(2)}`;
  const seg = out ? [
    { k: 'ok', n: out.sum.priced, label: '有价格' },
    { k: 'nop', n: out.sum.ok - out.sum.priced, label: '查到但无价格' },
    { k: 'miss', n: out.sum.missing, label: '未返回' },
    { k: 'fail', n: out.sum.failed, label: '失败' },
  ] : [];

  return (
    <div className="al-root">
      <section className="al-desk">
        <div className="al-desk-in">
          <label className="k-label" htmlFor="al-asins">ASIN 清单（每行一个，也可粘贴商品链接）</label>
          <textarea id="al-asins" className="k-input al-asins" rows={4} disabled={busy} value={prefs.asins} placeholder={ASIN_HINT} onChange={(e) => setP({ asins: e.target.value })} />
          <p className="al-count">
            <b className="k-num">{parsed.asins.length}</b> 个有效{parsed.duplicates ? <span className="al-tag">去重 {parsed.duplicates}</span> : null}{parsed.invalid.length ? <span className="al-tag warn">{parsed.invalid.length} 个格式不对（已忽略）</span> : null}
            {hover && <span className="al-tag on">松开即可导入</span>}
          </p>
        </div>
        <div className="al-desk-ctl">
          <div className="al-mk" role="group" aria-label="站点">
            {MARKETPLACES.map((m) => <button key={m.code} type="button" disabled={busy} className={`al-mk-b${prefs.market === m.code ? ' on' : ''}`} aria-pressed={prefs.market === m.code} onClick={() => setP({ market: m.code })}>{m.name}<i>{m.code}</i></button>)}
          </div>
          <label className="k-toggle"><input type="checkbox" checked={prefs.demo} disabled={busy} onChange={(e) => setP({ demo: e.target.checked })} /><span>演示模式（不联网，用虚构数据体验）</span></label>
          <div className="al-actions">
            <button className="k-btn" disabled={busy || !ctx} onClick={() => void pickFiles(['xlsx', 'csv', 'txt'], 'ASIN 列表').then((p) => { if (p.length) void importFiles(p); })}><FileUp size={14} />导入文件</button>
            {busy
              ? <button className="k-btn big" onClick={() => abort.current?.abort()}><Square size={14} />停止</button>
              : <button className="k-btn primary big" onClick={() => void start()}><Play size={14} />开始查询</button>}
          </div>
        </div>
      </section>

      <details className="al-cred" open={!prefs.demo}>
        <summary><KeyRound size={14} />授权凭据<span className="k-muted">{prefs.demo ? '演示模式不需要' : '只保存在本机，只发给亚马逊官方地址'}</span></summary>
        <div className="al-cred-grid">
          {credInput('clientId', '凭据编号（Credential ID）', false)}
          {credInput('clientSecret', '凭据密钥（Credential Secret）', true)}
          {credInput('partnerTag', '联盟追踪标识（Partner Tag，形如 店名-20）', false)}
        </div>
        <p className="k-muted al-note"><ShieldCheck size={13} /> 凭据不写日志。<button className="k-link" onClick={() => void openLink(DOCS)}>官方接口文档<ExternalLink size={12} /></button></p>
      </details>

      {error && <div className="k-notice err" role="alert">{error}</div>}
      {notice && !error && <div className="k-notice ok">{notice}</div>}
      {busy && <div className="al-busy"><span className="k-spin" /> 正在查询：{prog.done} / {prog.total}<span className="al-bar"><i style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></span></div>}

      {!busy && !out && !error && (
        <div className="al-empty">
          <svg viewBox="0 0 360 96" aria-hidden="true">
            <g className="al-s-a">{[0, 1, 2, 3].map((i) => <rect key={i} x="8" y={8 + i * 21} width="96" height="15" rx="4" />)}</g>
            <path className="al-s-ar" d="M122 48h56m-9-9 9 9-9 9" />
            <g className="al-s-b">{[0, 1, 2].map((i) => <g key={i}><rect x={196 + i * 54} y="14" width="46" height="68" rx="7" /><rect className="al-s-p" x={202 + i * 54} y="58" width="26" height="8" rx="3" /></g>)}</g>
          </svg>
          <div><b>一批 ASIN，变成标题和价格</b><p className="k-muted">粘贴 ASIN 或商品链接，选站点，点「开始查询」。没有凭据可先开演示模式看完整流程。</p></div>
        </div>
      )}

      {out && (
        <>
          <div className="al-sum">
            <div className="al-hit"><b className="k-num">{out.sum.ok}<small>/{out.sum.total}</small></b><span>已查到</span></div>
            <div className="al-spread">
              <div className="al-seg" role="img" aria-label={seg.map((s) => `${s.label} ${s.n}`).join('，')}>{seg.map((s) => s.n > 0 && <i key={s.k} className={`s-${s.k}`} style={{ flex: s.n }} />)}</div>
              <ul className="al-legend">{seg.filter((s) => s.n > 0).map((s) => <li key={s.k}><i className={`s-${s.k}`} />{s.label} <b className="k-num">{s.n}</b></li>)}</ul>
            </div>
            {prices.length > 0 && sameCur && (
              <dl className="al-range"><div><dt>最低价</dt><dd className="k-num">{money(Math.min(...prices))}</dd></div><div><dt>均价</dt><dd className="k-num">{money(prices.reduce((a, b) => a + b, 0) / prices.length)}</dd></div><div><dt>最高价</dt><dd className="k-num">{money(Math.max(...prices))}</dd></div></dl>
            )}
          </div>
          <div className="al-file">
            <Download size={15} /> <span className="k-ellipsis" title={out.path}>{out.path}</span>
            {!preview && <button className="k-link" onClick={() => void reveal(out.path)}><FolderOpen size={14} />在文件夹中显示</button>}
            {prefs.demo && <span className="al-tag warn">演示数据，不是真实查询结果</span>}
          </div>
          <ul className="al-grid">
            {show.map((r) => {
              const priced = r.item?.priceText || (r.item?.price ? `${r.item.price} ${r.item.currency}` : '');
              return (
                <li key={r.asin} className={`al-card${r.item ? '' : ' miss'}`}>
                  <div className="al-card-hd"><code>{r.asin}</code><span className={`al-st ${r.status === '已查到' ? 'ok' : 'bad'}`}>{r.status}</span></div>
                  {r.item ? <div className="al-card-t" title={r.item.title}>{r.item.title}</div> : <div className="al-card-t k-muted">{zhNote(r.note)}</div>}
                  <div className={`al-price k-num${priced ? '' : ' none'}`}>{priced || (r.item ? '无报价' : '—')}</div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="al-risk"><TriangleAlert size={13} /> 本工具<b>不抓取亚马逊网页</b>，只调用官方创作者接口；使用该接口需要亚马逊联盟账号及其凭据，并遵守其条款（条款细节未核实，以亚马逊为准）。价格以接口返回为准，仅供参考。</p>
    </div>
  );
}

/** 接口返回的说明若是外文，界面上换成中文提示（原文仍写在导出的 Excel 里） */
const zhNote = (s: string) => (/[\u4e00-\u9fa5]/.test(s) ? s : '接口没有返回这个 ASIN（原因见导出文件）');
