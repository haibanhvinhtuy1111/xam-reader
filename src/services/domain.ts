import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export const DEFAULT_DOMAIN = 'https://xamvn.work';
/** Đẩy file JSON dạng {"domain":"https://ten-mien-moi.com"} lên GitHub (repo public) rồi dán link Raw vào đây. */
export const REMOTE_CONFIG_URL = 'https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/domain.json';

const K = { domain: 'cfg.domain', manual: 'cfg.manual', proxy: 'cfg.proxy' };

export type Config = { domain: string; manual: boolean; useProxy: boolean };

let state: Config = { domain: DEFAULT_DOMAIN, manual: false, useProxy: false };
const listeners = new Set<() => void>();
const commit = (patch: Partial<Config>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const getConfig = () => state;
export const useConfig = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getConfig,
  );

/** "xamvn.xyz/abc" -> "https://xamvn.xyz" (chỉ giữ origin, null nếu rỗng) */
export function normalizeDomain(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const m = s.match(/^https?:\/\/[^/\s?#]+/i);
  return m ? m[0].toLowerCase() : null;
}

/** Gọi 1 lần khi khởi động: đọc AsyncStorage, rồi (nếu người dùng chưa sửa tay) hỏi GitHub xem có domain mới không. */
export async function initConfig() {
  try {
    const [d, m, p] = await Promise.all([K.domain, K.manual, K.proxy].map((k) => AsyncStorage.getItem(k)));
    commit({ domain: d || DEFAULT_DOMAIN, manual: m === '1', useProxy: p === '1' });
  } catch {}
  if (!state.manual) refreshRemoteDomain().catch(() => {}); // chạy nền, không chặn UI
}

export async function setDomain(input: string, manual = true) {
  const d = normalizeDomain(input);
  if (!d) throw new Error('Domain không hợp lệ');
  commit({ domain: d, manual });
  await AsyncStorage.multiSet([
    [K.domain, d],
    [K.manual, manual ? '1' : '0'],
  ]);
}

export async function setUseProxy(v: boolean) {
  commit({ useProxy: v });
  await AsyncStorage.setItem(K.proxy, v ? '1' : '0');
}

/** force = true: bỏ qua việc người dùng đã sửa tay và quay lại chế độ tự động theo file JSON. */
export async function refreshRemoteDomain(force = false): Promise<string | null> {
  if (state.manual && !force) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(`${REMOTE_CONFIG_URL}?t=${Date.now()}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`Không tải được file cấu hình (HTTP ${res.status})`);
    const d = normalizeDomain(String((await res.json())?.domain ?? ''));
    if (!d) throw new Error('File cấu hình không có trường "domain" hợp lệ');
    if (d !== state.domain || state.manual) await setDomain(d, false);
    return d;
  } finally {
    clearTimeout(timer);
  }
}
