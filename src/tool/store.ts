// 凭据与偏好保存在本机应用数据目录的 settings.json（kit 的 settingsStore），键名 cred.e19 / prefs.e19。不上传、不写日志。
import { settingsStore } from '../kit/platform';
import type { Credentials } from './core';

const CRED_KEY = 'cred.e19';
const PREFS_KEY = 'prefs.e19';
export const EMPTY_CRED: Credentials = { clientId: '', clientSecret: '', partnerTag: '' };
export interface Prefs { market: string; demo: boolean; asins: string }
export const DEFAULT_PREFS: Prefs = { market: 'US', demo: true, asins: '' };
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export async function loadCred(): Promise<Credentials> {
  try {
    const v = (await (await settingsStore()).get<Partial<Credentials>>(CRED_KEY)) ?? {};
    return { clientId: str(v.clientId), clientSecret: str(v.clientSecret), partnerTag: str(v.partnerTag) };
  } catch { return EMPTY_CRED; }
}
export async function saveCred(c: Credentials): Promise<void> {
  try { const st = await settingsStore(); await st.set(CRED_KEY, c); await st.save(); } catch { /* 忽略 */ }
}
export async function loadPrefs(): Promise<Prefs> {
  try {
    const v = (await (await settingsStore()).get<Partial<Prefs>>(PREFS_KEY)) ?? {};
    return { market: str(v.market) || 'US', demo: v.demo ?? true, asins: str(v.asins) };
  } catch { return DEFAULT_PREFS; }
}
export async function savePrefs(p: Prefs) {
  try { await (await settingsStore()).set(PREFS_KEY, p); } catch { /* 忽略 */ }
}
