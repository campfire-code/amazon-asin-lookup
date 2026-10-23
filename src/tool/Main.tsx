// 主界面：左侧填授权、站点和 ASIN，右侧显示进度、汇总和结果。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, FileUp, FolderOpen, Play, ShieldCheck, Square, TriangleAlert } from 'lucide-react';
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
  const show = out?.rows.slice(0, 50) ?? [];

  return (
    <div className="al-root">
      <section className="k-panel al-side">
        <p className="al-risk"><TriangleAlert size={13} /> 本工具<b>不抓取亚马逊网页</b>，只调用官方 Creators API；使用该接口需要 Amazon Associates（联盟）账号及其凭据，并遵守其条款（条款细节未核实，以亚马逊为准）。价格以接口返回为准，仅供参考。</p>
        <h3 className="k-section">1. 授权</h3>
        <label className="k-toggle"><input type="checkbox" checked={prefs.demo} disabled={busy} onChange={(e) => setP({ demo: e.target.checked })} /><span>演示模式（不联网，用虚构数据体验）</span></label>
        {credInput('clientId', 'Credential ID', false)}
        {credInput('clientSecret', 'Credential Secret', true)}
        {credInput('partnerTag', 'Partner Tag（如 xxx-20）', false)}
        <p className="k-muted al-note"><ShieldCheck size={13} /> 凭据只保存在本机，只会发给亚马逊官方地址。<button className="k-link" onClick={() => void openLink(DOCS)}>接口文档<ExternalLink size={12} /></button></p>

        <h3 className="k-section">2. 站点与 ASIN</h3>
        <div className="k-field">
          <label className="k-label" htmlFor="al-mp">站点</label>
          <select id="al-mp" className="k-input" value={prefs.market} disabled={busy} onChange={(e) => setP({ market: e.target.value })}>
            {MARKETPLACES.map((m) => <option key={m.code} value={m.code}>{m.name}（{m.code}）</option>)}
          </select>
        </div>
        <div className="k-field">
          <label className="k-label" htmlFor="al-asins">ASIN 列表（每行一个，也可粘贴商品链接）</label>
          <textarea id="al-asins" className="k-input al-asins" rows={7} disabled={busy} value={prefs.asins} placeholder={'每行一个 ASIN，例如：\nXXXXXXXXXX'} onChange={(e) => setP({ asins: e.target.value })} />
          <p className="k-muted al-note">
            {parsed.asins.length} 个有效{parsed.duplicates ? `，去重 ${parsed.duplicates}` : ''}{parsed.invalid.length ? `，${parsed.invalid.length} 个格式不对（已忽略）` : ''}
            {hover && ' · 松开即可导入'}
          </p>
        </div>
        <div className="al-actions">
          <button className="k-btn" disabled={busy || !ctx} onClick={() => void pickFiles(['xlsx', 'csv', 'txt'], 'ASIN 列表').then((p) => { if (p.length) void importFiles(p); })}><FileUp size={14} />导入文件</button>
          {busy
            ? <button className="k-btn" onClick={() => abort.current?.abort()}><Square size={14} />停止</button>
            : <button className="k-btn primary" onClick={() => void start()}><Play size={14} />开始查询</button>}
        </div>
      </section>

      <section className="k-panel al-main">
        {error && <div className="k-notice err" role="alert">{error}</div>}
        {notice && !error && <div className="k-notice ok">{notice}</div>}
        {busy && <div className="al-busy"><span className="k-spin" /> 正在查询：{prog.done} / {prog.total}</div>}
        {!busy && !out && !error && <div className="k-empty"><p>粘贴或导入 ASIN，填好授权后点「开始查询」。</p><p className="k-muted">没有凭据也可以先打开「演示模式」看完整流程。</p></div>}
        {out && (
          <>
            <div className="al-sum">
              <div><b className="k-num">{out.sum.total}</b><span className="k-muted">共查询</span></div>
              <div><b className="k-num">{out.sum.ok}</b><span className="k-muted">已查到</span></div>
              <div><b className="k-num">{out.sum.priced}</b><span className="k-muted">有价格</span></div>
              <div><b className="k-num">{out.sum.missing + out.sum.failed}</b><span className="k-muted">未返回 / 失败</span></div>
            </div>
            <div className="al-file">
              <Download size={15} /> <span className="k-ellipsis" title={out.path}>{out.path}</span>
              {!preview && <button className="k-link" onClick={() => void reveal(out.path)}><FolderOpen size={14} />在文件夹中显示</button>}
            </div>
            {prefs.demo && <p className="k-muted al-note">当前是演示数据（虚构的「示例」商品），不是真实查询结果。</p>}
            <div className="k-table-wrap k-scroll al-table">
              <table className="k-table">
                <thead><tr><th>ASIN</th><th>标题</th><th>价格</th><th>状态</th></tr></thead>
                <tbody>{show.map((r) => (
                  <tr key={r.asin}>
                    <td className="k-num">{r.asin}</td>
                    <td><div className="al-title" title={r.item?.title}>{r.item?.title || <span className="k-muted">{r.note}</span>}</div></td>
                    <td className="k-num">{r.item?.priceText || (r.item?.price ? `${r.item.price} ${r.item.currency}` : '—')}</td>
                    <td>{r.status}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
