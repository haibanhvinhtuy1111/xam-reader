import './global.css';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Keyboard, Linking, Modal, Pressable, RefreshControl,
  ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import {
  AlertTriangle, ArrowLeft, ChevronDown, Download, FileText, Globe, Images, LayoutGrid,
  MessageSquare, MoreHorizontal, Play, Search, ShieldCheck, User, X, Zap, ZoomIn,
} from 'lucide-react-native';

import { getConfig, initConfig, refreshRemoteDomain, setDomain, setUseProxy, useConfig } from './src/services/domain';
import { UA, clearCookies, fetchHtml, hasClearance, imageSource, isCloudflare, syncCookiesFromWebView } from './src/services/http';
import { fetchLatest, scrapeThread, searchForum } from './src/services/scraper';
import { MediaItem, ThreadItem, hostOf } from './src/services/parser';

/* ───────────── Theme ───────────── */
const C = { bg: '#F8F9F5', ink: '#111827', brand: '#1E4631', muted: '#6B7280', chip: '#EEF0EA', soft: '#E8EFE9' };
const SHADOW = {
  shadowColor: '#0B1F14', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3,
} as const;
const BAR_H = 64;

/* ───────────── App context ───────────── */
type Mode = 'keyword' | 'author' | 'post';
type Preset = { mode: Mode; n: number };
type Ctx = {
  openGallery: (url: string, title?: string) => void;
  requestCF: () => void;
  cfVersion: number;
  bottomSpace: number;
  preset: Preset | null;
  goSearch: (mode: Mode) => void;
};
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
const useApp = () => useContext(AppCtx);

/** Chạy tác vụ mạng; nếu dính Cloudflare thì tự mở Modal xác thực. */
function useRun() {
  const { requestCF } = useApp();
  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e: any) {
        if (isCloudflare(e)) {
          requestCF();
          throw new Error('Bị Cloudflare chặn. Hãy xác thực rồi thử lại.');
        }
        throw e;
      }
    },
    [requestCF],
  );
}

/* ───────────── UI nhỏ dùng chung ───────────── */
const Title = ({ children }: { children: string }) => {
  const { top } = useSafeAreaInsets();
  return (
    <Text className="text-ink font-extrabold text-[32px] px-5 pb-3" style={{ paddingTop: top + 8 }}>
      {children}
    </Text>
  );
};

function Segmented<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <View className="flex-row rounded-full p-1" style={{ backgroundColor: C.chip }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} className={`flex-1 py-2.5 rounded-full items-center ${on ? 'bg-brand' : ''}`}>
            <Text className={`text-[14px] font-semibold ${on ? 'text-white' : 'text-ink'}`}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const PrimaryButton = ({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) => (
  <Pressable onPress={onPress} disabled={busy} className="mt-4 h-12 rounded-full bg-brand items-center justify-center flex-row">
    {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-[16px]">{label}</Text>}
  </Pressable>
);

function ThreadRow({ t }: { t: ThreadItem }) {
  const { openGallery } = useApp();
  return (
    <Pressable onPress={() => openGallery(t.url, t.title)} className="bg-white rounded-3xl p-4 flex-row items-center mb-3" style={SHADOW}>
      <View className="flex-1 pr-3">
        <Text numberOfLines={2} className="text-ink font-semibold text-[15px]">{t.title}</Text>
        {!!t.snippet && <Text numberOfLines={2} className="text-[13px] mt-1" style={{ color: C.muted }}>{t.snippet}</Text>}
      </View>
      <View className="w-10 h-10 rounded-full bg-brand items-center justify-center">
        <Images size={18} color="#fff" />
      </View>
    </Pressable>
  );
}

/* ───────────── Tab 1: Tìm kiếm ───────────── */
const BY = ['Từ khóa', 'Tác giả'] as const;
const MATCH = ['Có chứa', 'Chính xác'] as const;
const SORTS = { 'Phù hợp nhất': 'relevance', 'Mới nhất': 'date', 'Nhiều bình luận': 'replies' } as const;

function SearchScreen() {
  const { bottomSpace, preset, requestCF, cfVersion } = useApp();
  const { domain } = useConfig();
  const run = useRun();
  const [q, setQ] = useState('');
  const [by, setBy] = useState<(typeof BY)[number]>('Từ khóa');
  const [match, setMatch] = useState<(typeof MATCH)[number]>('Có chứa');
  const [sort, setSort] = useState<keyof typeof SORTS>('Phù hợp nhất');
  const [scope, setScope] = useState<'thread' | 'post'>('thread');
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<ThreadItem[] | null>(null);
  const [status, setStatus] = useState<'checking' | 'ok' | 'cf' | 'err'>('checking');

  useEffect(() => {
    if (!preset) return;
    setBy(preset.mode === 'author' ? 'Tác giả' : 'Từ khóa');
    setScope(preset.mode === 'post' ? 'post' : 'thread');
  }, [preset]);

  useEffect(() => {
    let off = false;
    setStatus('checking');
    fetchHtml(domain + '/', {}, 8000)
      .then(() => !off && setStatus('ok'))
      .catch((e) => !off && setStatus(isCloudflare(e) ? 'cf' : 'err'));
    return () => { off = true; };
  }, [domain, cfVersion]);

  const go = async () => {
    if (!q.trim()) return;
    Keyboard.dismiss();
    setBusy(true); setErr(''); setRows(null);
    try {
      setRows(await run(() => searchForum({ q, by: by === 'Tác giả' ? 'author' : scope, exact: match === 'Chính xác', order: SORTS[sort] })));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const host = hostOf(domain);
  const warn = {
    checking: ['Đang kiểm tra kết nối', `Đang thử mở ${host}…`],
    ok: [`Đã kết nối ${host}`, 'Ảnh tải chậm hoặc bị chặn? Bật proxy ảnh trong tab Thêm.'],
    cf: [`${host} đang yêu cầu xác thực`, 'Cloudflare cần bạn tick Captcha một lần để tiếp tục.'],
    err: [`Không kết nối được ${host}`, 'Kiểm tra mạng hoặc đổi tên miền trong tab Thêm.'],
  }[status];

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottomSpace }}>
      <Title>Tìm toàn diễn đàn</Title>

      <View className="mx-5 bg-white rounded-3xl p-5" style={SHADOW}>
        <View className="flex-row items-center">
          <View className="w-10 h-10 rounded-2xl items-center justify-center" style={{ backgroundColor: C.soft }}>
            <ZoomIn size={20} color={C.brand} />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-ink font-bold text-[17px]">Bạn muốn tìm gì?</Text>
            <Text className="text-[13px] mt-0.5" style={{ color: C.muted }}>Tìm đồng thời bài mới và kho chủ đề cũ trên cả hai nguồn.</Text>
          </View>
        </View>

        <TextInput
          value={q} onChangeText={setQ} onSubmitEditing={go} returnKeyType="search"
          placeholder={by === 'Tác giả' ? 'Nhập tên người đăng' : 'Nhập từ khóa chủ đề'}
          placeholderTextColor="#9CA3AF" autoCapitalize="none" autoCorrect={false}
          className="mt-4 rounded-2xl px-4 h-12 text-[16px] text-ink" style={{ backgroundColor: '#F4F5F0' }}
        />
        {scope === 'post' && by === 'Từ khóa' && (
          <Pressable onPress={() => setScope('thread')}>
            <Text className="text-[12px] mt-2 px-1" style={{ color: C.brand }}>Đang tìm trong nội dung bình luận · chạm để quay về tìm theo tiêu đề</Text>
          </Pressable>
        )}

        <View className="mt-4"><Segmented options={BY} value={by} onChange={setBy} /></View>

        <Pressable onPress={() => setOpen(!open)} className="flex-row items-center justify-between mt-4 py-1">
          <Text className="text-ink font-semibold text-[15px]">Tùy chọn tìm kiếm</Text>
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><ChevronDown size={20} color={C.muted} /></View>
        </Pressable>
        {open && (
          <View className="mt-2">
            <Segmented options={MATCH} value={match} onChange={setMatch} />
            <Pressable onPress={() => setMenu(!menu)} className="mt-3 h-12 rounded-2xl px-4 flex-row items-center justify-between" style={{ borderWidth: 1, borderColor: '#E5E7EB' }}>
              <Text className="text-ink text-[15px]">{sort}</Text>
              <ChevronDown size={18} color={C.muted} />
            </Pressable>
            {menu && (
              <View className="mt-1 rounded-2xl overflow-hidden" style={{ borderWidth: 1, borderColor: '#E5E7EB' }}>
                {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k) => (
                  <Pressable key={k} onPress={() => { setSort(k); setMenu(false); }} className="px-4 py-3" style={{ backgroundColor: k === sort ? C.soft : '#fff' }}>
                    <Text className={`text-[15px] ${k === sort ? 'text-brand font-semibold' : 'text-ink'}`}>{k}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
        <PrimaryButton label="Tìm kiếm" onPress={go} busy={busy} />
      </View>

      <View className="mx-5 mt-4 rounded-3xl bg-warn p-4 flex-row" style={{ borderWidth: 1, borderColor: '#F3E3C7' }}>
        <AlertTriangle size={22} color="#EA8A1C" />
        <View className="flex-1 ml-3">
          <Text className="text-ink font-semibold text-[15px]">{warn[0]}</Text>
          <Text className="text-[13px] mt-0.5" style={{ color: C.muted }}>{warn[1]}</Text>
          {status === 'cf' && (
            <Pressable onPress={requestCF} className="self-start mt-2 px-4 py-2 rounded-full bg-brand">
              <Text className="text-white font-semibold text-[13px]">Xác thực ngay</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View className="px-5 mt-5">
        {!!err && <Text className="text-red-600 text-[14px] px-1">{err}</Text>}
        {rows?.map((t) => <ThreadRow key={t.url} t={t} />)}
      </View>
    </ScrollView>
  );
}

/* ───────────── Tab 2: Mới nhất ───────────── */
function LatestScreen({ active }: { active: boolean }) {
  const { bottomSpace, cfVersion } = useApp();
  const { domain } = useConfig();
  const run = useRun();
  const [rows, setRows] = useState<ThreadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try { setRows(await run(fetchLatest)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [run, domain]);

  useEffect(() => { if (active) load(); }, [active, load, cfVersion]);

  return (
    <View className="flex-1">
      <Title>Mới nhất</Title>
      <FlatList
        data={rows} keyExtractor={(t) => t.url} renderItem={({ item }) => <ThreadRow t={item} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomSpace }}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.brand} />}
        ListEmptyComponent={err ? <Text className="text-red-600 text-[14px] px-1">{err}</Text> : null}
      />
    </View>
  );
}

/* ───────────── Tab 3: Danh mục ───────────── */
function CategoryScreen() {
  const { bottomSpace, openGallery, goSearch } = useApp();
  const { domain } = useConfig();
  const [showLink, setShowLink] = useState(false);
  const [link, setLink] = useState('');

  const cards = [
    { Icon: Images, title: 'Lọc ảnh/video', sub: 'Từ link hoặc bài viết', onPress: () => setShowLink(!showLink) },
    { Icon: FileText, title: 'Tìm bài viết', sub: 'Theo từ khóa', onPress: () => goSearch('keyword') },
    { Icon: User, title: 'Tìm theo người đăng', sub: 'Theo tên tác giả', onPress: () => goSearch('author') },
    { Icon: MessageSquare, title: 'Tìm bình luận', sub: 'Trong nội dung bài', onPress: () => goSearch('post') },
  ];

  const submit = () => {
    const s = link.trim();
    if (!s) return;
    openGallery(/^https?:\/\//i.test(s) ? s : `${domain}/${s.replace(/^\//, '')}`);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottomSpace }}>
      <Title>Danh mục</Title>
      <View className="px-5 flex-row flex-wrap justify-between">
        {cards.map(({ Icon, title, sub, onPress }) => (
          <Pressable key={title} onPress={onPress} className="bg-white rounded-3xl p-5 mb-3" style={[SHADOW, { width: '48.5%', minHeight: 150 }]}>
            <View className="w-12 h-12 rounded-2xl items-center justify-center" style={{ backgroundColor: C.soft }}>
              <Icon size={24} color={C.brand} />
            </View>
            <Text className="text-ink font-bold text-[16px] mt-auto pt-4">{title}</Text>
            <Text className="text-[13px] mt-0.5" style={{ color: C.muted }}>{sub}</Text>
          </Pressable>
        ))}
      </View>
      {showLink && (
        <View className="mx-5 bg-white rounded-3xl p-5" style={SHADOW}>
          <Text className="text-ink font-bold text-[16px]">Dán link bài viết</Text>
          <TextInput
            value={link} onChangeText={setLink} onSubmitEditing={submit} returnKeyType="go"
            placeholder={`${domain}/threads/...`} placeholderTextColor="#9CA3AF"
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
            className="mt-3 rounded-2xl px-4 h-12 text-[16px] text-ink" style={{ backgroundColor: '#F4F5F0' }}
          />
          <PrimaryButton label="Quét ảnh & video" onPress={submit} />
        </View>
      )}
    </ScrollView>
  );
}

/* ───────────── Tab 4: Thêm (cài đặt) ───────────── */
function MoreScreen() {
  const { bottomSpace, requestCF, cfVersion } = useApp();
  const { domain, useProxy, manual } = useConfig();
  const [d, setD] = useState(domain);
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setD(domain), [domain]);
  useEffect(() => { hasClearance(domain).then(setClear).catch(() => setClear(false)); }, [domain, cfVersion]);

  const save = async () => {
    try { await setDomain(d); Alert.alert('Đã lưu', 'Domain mới sẽ được dùng cho mọi yêu cầu tiếp theo.'); }
    catch (e: any) { Alert.alert('Lỗi', e.message); }
  };
  const sync = async () => {
    setBusy(true);
    try { const n = await refreshRemoteDomain(true); Alert.alert('Đã cập nhật', n ?? ''); }
    catch (e: any) { Alert.alert('Không cập nhật được', e.message); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottomSpace }}>
      <Title>Thêm</Title>

      <View className="mx-5 bg-white rounded-3xl p-5" style={SHADOW}>
        <View className="flex-row items-center"><Globe size={20} color={C.brand} /><Text className="ml-2 text-ink font-bold text-[16px]">Tên miền diễn đàn</Text></View>
        <TextInput value={d} onChangeText={setD} autoCapitalize="none" autoCorrect={false} keyboardType="url"
          className="mt-3 rounded-2xl px-4 h-12 text-[16px] text-ink" style={{ backgroundColor: '#F4F5F0' }} />
        <Text className="text-[12px] mt-2" style={{ color: C.muted }}>
          {manual ? 'Đang dùng domain bạn nhập tay.' : 'Domain tự cập nhật từ máy chủ cấu hình mỗi lần mở app.'}
        </Text>
        <PrimaryButton label="Lưu domain" onPress={save} />
        <Pressable onPress={sync} disabled={busy} className="mt-2 h-11 rounded-full items-center justify-center" style={{ backgroundColor: C.chip }}>
          {busy ? <ActivityIndicator color={C.brand} /> : <Text className="text-brand font-semibold text-[15px]">Lấy domain mới từ GitHub</Text>}
        </Pressable>
      </View>

      <View className="mx-5 mt-4 bg-white rounded-3xl p-5" style={SHADOW}>
        <View className="flex-row items-center"><ShieldCheck size={20} color={C.brand} /><Text className="ml-2 text-ink font-bold text-[16px]">Cookie Cloudflare</Text></View>
        <Text className="text-[13px] mt-2" style={{ color: C.muted }}>
          {clear ? 'Đã có cookie xác thực (cf_clearance).' : 'Chưa có cookie xác thực. Chỉ cần khi diễn đàn trả lỗi 403.'}
        </Text>
        <PrimaryButton label="Mở trang xác thực" onPress={requestCF} />
        <Pressable onPress={async () => { await clearCookies(); setClear(false); }} className="mt-2 h-11 rounded-full items-center justify-center" style={{ backgroundColor: C.chip }}>
          <Text className="text-ink font-semibold text-[15px]">Xóa cookie</Text>
        </Pressable>
      </View>

      <View className="mx-5 mt-4 bg-white rounded-3xl p-5 flex-row items-center" style={SHADOW}>
        <View className="flex-1 pr-4">
          <Text className="text-ink font-bold text-[16px]">Xem ảnh qua proxy</Text>
          <Text className="text-[13px] mt-1" style={{ color: C.muted }}>Bọc link ảnh qua wsrv.nl, hữu ích khi nhà mạng chặn zpic/anh.moe mà không bật VPN.</Text>
        </View>
        <Switch value={useProxy} onValueChange={setUseProxy} trackColor={{ true: C.brand }} />
      </View>
    </ScrollView>
  );
}

/* ───────────── Lọc ảnh/video: lưới + xem toàn màn hình ───────────── */
async function saveImage(url: string) {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) throw new Error('Hãy cho phép thêm ảnh vào Thư viện trong Cài đặt.');
  const ext = (url.split(/[?#]/)[0].match(/\.(jpe?g|png|gif|webp|heic)$/i)?.[1] ?? 'jpg').toLowerCase();
  const src = imageSource(url);
  const res = await FileSystem.downloadAsync(src.uri, `${FileSystem.cacheDirectory}xam_${Date.now()}.${ext}`, { headers: src.headers });
  if (res.status !== 200) throw new Error(`Tải thất bại (HTTP ${res.status})`);
  await MediaLibrary.saveToLibraryAsync(res.uri);
}

function Viewer({ images, start, onClose }: { images: MediaItem[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const { top, bottom } = useSafeAreaInsets();
  const [cur, setCur] = useState(start);
  const [saving, setSaving] = useState(false);

  const download = async () => {
    setSaving(true);
    try { await saveImage(images[cur].url); Alert.alert('Đã lưu', 'Ảnh đã được thêm vào Thư viện.'); }
    catch (e: any) { Alert.alert('Không lưu được', e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          horizontal pagingEnabled data={images} keyExtractor={(i) => i.id}
          initialScrollIndex={start} windowSize={3} showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => setCur(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <ScrollView style={{ width, height }} contentContainerStyle={{ width, height, justifyContent: 'center' }}
              maximumZoomScale={4} minimumZoomScale={1} centerContent bouncesZoom
              showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
              <Image source={imageSource(item.url)} style={{ width, height }} contentFit="contain" />
            </ScrollView>
          )}
        />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: top + 6, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={onClose} hitSlop={10} className="w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <X size={22} color="#fff" />
          </Pressable>
          <View className="px-4 py-2 rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <Text className="text-white font-semibold">{cur + 1} / {images.length}</Text>
          </View>
          <Pressable onPress={download} disabled={saving} hitSlop={10} className="w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
            {saving ? <ActivityIndicator color="#fff" /> : <Download size={20} color="#fff" />}
          </Pressable>
        </View>
        <View style={{ height: bottom }} />
      </View>
    </Modal>
  );
}

const FILTERS = ['Tất cả', 'Ảnh', 'Video'] as const;

function GalleryScreen({ url, hint, onBack }: { url: string; hint?: string; onBack: () => void }) {
  const { cfVersion, requestCF } = useApp();
  const { useProxy } = useConfig();
  const { top } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [title, setTitle] = useState(hint ?? '');
  const [prog, setProg] = useState({ done: 0, total: 0 });
  const [state, setState] = useState<'load' | 'done' | 'cf' | 'err'>('load');
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Tất cả');
  const [viewer, setViewer] = useState<number | null>(null);

  useEffect(() => {
    let off = false;
    setItems([]); setState('load'); setErr('');
    scrapeThread(url, {
      isCancelled: () => off,
      onTitle: (t) => { if (!off && t) setTitle(t); },
      onProgress: (list, done, total) => { if (!off) { setItems(list); setProg({ done, total }); } },
    })
      .then(() => { if (!off) setState('done'); })
      .catch((e) => { if (off) return; if (isCloudflare(e)) setState('cf'); else { setErr(e.message); setState('err'); } });
    return () => { off = true; };
  }, [url, cfVersion]);

  const GAP = 3, PAD = 16;
  const size = Math.floor((width - PAD * 2 - GAP * 2) / 3);
  const shown = items.filter((i) => filter === 'Tất cả' || (filter === 'Ảnh') === (i.type === 'image'));
  const imgs = shown.filter((i) => i.type === 'image');
  const nImg = items.filter((i) => i.type === 'image').length;

  const open = (it: MediaItem) => (it.type === 'video' ? Linking.openURL(it.url) : setViewer(imgs.indexOf(it)));

  return (
    <View className="flex-1 bg-cream">
      <View className="flex-row items-center px-4 pb-3" style={{ paddingTop: top + 6 }}>
        <Pressable onPress={onBack} hitSlop={10} className="w-11 h-11 rounded-full bg-white items-center justify-center" style={SHADOW}>
          <ArrowLeft size={22} color={C.ink} />
        </Pressable>
        <View className="flex-1 ml-3">
          <Text numberOfLines={1} className="text-ink font-bold text-[17px]">{title || 'Đang tải…'}</Text>
          <Text className="text-[12px] mt-0.5" style={{ color: C.muted }}>
            {nImg} ảnh · {items.length - nImg} video{state === 'load' && prog.total > 0 ? ` · trang ${prog.done}/${prog.total}` : ''}
          </Text>
        </View>
        {state === 'load' && <ActivityIndicator color={C.brand} />}
      </View>

      <View className="px-4 pb-3"><Segmented options={FILTERS} value={filter} onChange={setFilter} /></View>

      {state === 'cf' && (
        <View className="mx-4 mb-3 rounded-3xl bg-warn p-4">
          <Text className="text-ink font-semibold">Cloudflare đang chặn</Text>
          <Text className="text-[13px] mt-1" style={{ color: C.muted }}>Xác thực một lần rồi trang sẽ tự quét lại.</Text>
          <Pressable onPress={requestCF} className="self-start mt-3 px-4 py-2 rounded-full bg-brand"><Text className="text-white font-semibold">Xác thực ngay</Text></Pressable>
        </View>
      )}
      {state === 'err' && <Text className="text-red-600 px-5 pb-3">{err}</Text>}

      <FlatList
        data={shown} keyExtractor={(i) => i.id} numColumns={3} extraData={useProxy}
        columnWrapperStyle={{ gap: GAP }} contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 40, gap: GAP }}
        initialNumToRender={24} windowSize={7} removeClippedSubviews
        ListEmptyComponent={state === 'done' ? <Text className="text-center mt-10" style={{ color: C.muted }}>Không tìm thấy ảnh/video nào trong chủ đề này.</Text> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(item)} style={{ width: size, height: size, borderRadius: 16, overflow: 'hidden', backgroundColor: '#E5E7EB' }}>
            {item.type === 'image' ? (
              <Image source={imageSource(item.url, true)} style={{ flex: 1 }} contentFit="cover" transition={120} recyclingKey={item.id} />
            ) : (
              <View className="flex-1 items-center justify-center bg-ink">
                <Play size={26} color="#fff" />
                <Text numberOfLines={1} className="text-white/70 text-[10px] mt-1 px-2">{hostOf(item.url)}</Text>
              </View>
            )}
          </Pressable>
        )}
      />
      {viewer !== null && viewer >= 0 && <Viewer images={imgs} start={viewer} onClose={() => setViewer(null)} />}
    </View>
  );
}

/* ───────────── Modal Cloudflare (WebView thật) ───────────── */
function CloudflareModal({ visible, onClose }: { visible: boolean; onClose: (saved: boolean) => void }) {
  const { domain } = useConfig();
  const { top } = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try { await syncCookiesFromWebView(domain); onClose(true); }
    catch (e: any) { Alert.alert('Không lưu được cookie', e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => onClose(false)}>
      <View className="flex-1 bg-cream">
        <View className="flex-row items-center justify-between px-4 pb-3" style={{ paddingTop: top + 6 }}>
          <Pressable onPress={() => onClose(false)} hitSlop={10}><Text className="text-[16px]" style={{ color: C.muted }}>Hủy</Text></Pressable>
          <Text className="text-ink font-bold text-[16px]">Xác thực Cloudflare</Text>
          <Pressable onPress={save} hitSlop={10}>{busy ? <ActivityIndicator /> : <Text className="text-brand font-bold text-[16px]">Xong</Text>}</Pressable>
        </View>
        <Text className="px-5 pb-2 text-[13px]" style={{ color: C.muted }}>Tick ô xác thực, đợi trang diễn đàn hiện ra rồi bấm “Xong”.</Text>
        {visible && <WebView source={{ uri: domain }} userAgent={UA} sharedCookiesEnabled thirdPartyCookiesEnabled javaScriptEnabled style={{ flex: 1 }} />}
      </View>
    </Modal>
  );
}

/* ───────────── Floating pill tab bar ───────────── */
type Tab = 'search' | 'latest' | 'category' | 'more';
const TABS: { key: Tab; label: string; Icon: typeof Search }[] = [
  { key: 'search', label: 'Tìm kiếm', Icon: Search },
  { key: 'latest', label: 'Mới nhất', Icon: Zap },
  { key: 'category', label: 'Danh mục', Icon: LayoutGrid },
  { key: 'more', label: 'Thêm', Icon: MoreHorizontal },
];
/** iPhone 13: inset đáy = 34pt. Trừ 10pt để thanh nổi sát phía trên Home Indicator thay vì cao quá. */
const barBottom = (inset: number) => (inset > 0 ? inset - 10 : 16);

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: barBottom(bottom) }}>
      <View className="flex-row bg-white items-center px-2" style={[SHADOW, { height: BAR_H, borderRadius: BAR_H / 2, shadowOpacity: 0.14 }]}>
        {TABS.map(({ key, label, Icon }) => {
          const on = key === tab;
          return (
            <Pressable key={key} onPress={() => onChange(key)} className={`flex-1 items-center justify-center rounded-full mx-0.5 ${on ? 'bg-brand' : ''}`} style={{ height: BAR_H - 14 }}>
              <Icon size={22} color={on ? '#fff' : C.muted} strokeWidth={on ? 2.4 : 2} />
              <Text className={`text-[10.5px] mt-0.5 font-semibold ${on ? 'text-white' : ''}`} style={on ? undefined : { color: C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ───────────── Root ───────────── */
function Root() {
  const { bottom } = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('search');
  const [visited, setVisited] = useState<Tab[]>(['search']);
  const [gallery, setGallery] = useState<{ url: string; title?: string } | null>(null);
  const [cfOpen, setCfOpen] = useState(false);
  const [cfVersion, setCfVersion] = useState(0);
  const [preset, setPreset] = useState<Preset | null>(null);

  useEffect(() => { initConfig().finally(() => setReady(true)); }, []);

  const changeTab = useCallback((t: Tab) => { setTab(t); setVisited((v) => (v.includes(t) ? v : [...v, t])); }, []);
  const requestCF = useCallback(() => setCfOpen(true), []);
  const openGallery = useCallback((url: string, title?: string) => setGallery({ url, title }), []);
  const goSearch = useCallback((mode: Mode) => { setPreset({ mode, n: Date.now() }); changeTab('search'); }, [changeTab]);

  if (!ready) return <View className="flex-1 items-center justify-center bg-cream"><ActivityIndicator color={C.brand} /></View>;

  const ctx: Ctx = { openGallery, requestCF, cfVersion, bottomSpace: BAR_H + barBottom(bottom) + 28, preset, goSearch };
  // Giữ state từng tab bằng cách ẩn (display:none) thay vì unmount
  const pane = (k: Tab, node: React.ReactNode) => visited.includes(k) && <View key={k} style={{ flex: 1, display: tab === k ? 'flex' : 'none' }}>{node}</View>;

  return (
    <AppCtx.Provider value={ctx}>
      <View className="flex-1 bg-cream">
        <StatusBar barStyle="dark-content" />
        {pane('search', <SearchScreen />)}
        {pane('latest', <LatestScreen active={tab === 'latest'} />)}
        {pane('category', <CategoryScreen />)}
        {pane('more', <MoreScreen />)}
        <TabBar tab={tab} onChange={changeTab} />
        {gallery && (
          <View style={StyleSheet.absoluteFill}>
            <GalleryScreen url={gallery.url} hint={gallery.title} onBack={() => setGallery(null)} />
          </View>
        )}
        <CloudflareModal visible={cfOpen} onClose={(saved) => { setCfOpen(false); if (saved) setCfVersion((v) => v + 1); }} />
      </View>
    </AppCtx.Provider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}
