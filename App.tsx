import React, { Component, ErrorInfo, ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
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

import { initConfig, refreshRemoteDomain, setDomain, setUseProxy, useConfig } from './src/services/domain';
import { UA, clearCookies, fetchHtml, hasClearance, imageSource, isCloudflare, syncCookiesFromWebView } from './src/services/http';
import { fetchLatest, scrapeThread, searchForum } from './src/services/scraper';
import { MediaItem, ThreadItem, hostOf } from './src/services/parser';
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, Button, StyleSheet } from 'react-native';
import { fetchHtml } from '../services/http'; // Lấy hàm fetch trực tiếp của bạn
import { CloudflareWebView } from '../components/CloudflareWebView';

export default function HomeScreen() {
  const [data, setData] = useState<string>(''); // Chứa HTML hoặc data bóc tách
  const [isLoading, setIsLoading] = useState(false);
  const [showCFChallenge, setShowCFChallenge] = useState(false);
  
  // Lấy domain từ file cấu hình của bạn (hoặc fix cứng tùy bạn)
  const targetDomain = 'https://xamvn.work'; 

  // Hàm gọi API lấy dữ liệu
  const loadData = async () => {
    setIsLoading(true);
    try {
      // ⚠️ GỌI TRỰC TIẾP URL GỐC, KHÔNG GỌI QUA VERCEL NỮA
      const url = `${targetDomain}/forums/`; 
      const result = await fetchHtml(url); 
      
      console.log('✅ Tải data thành công!');
      setData(result.html); // Lưu HTML hoặc parse ra danh sách tùy logic của bạn
      
    } catch (error: any) {
      // KIỂM TRA LỖI DO FILE http.ts NÉM RA
      if (error.code === 'CF') {
        console.log('🚨 Bị chặn bởi Cloudflare, đang bật WebView...');
        setShowCFChallenge(true); // Hiện màn hình bắt user tick Captcha
      } else {
        console.error('❌ Lỗi khác:', error.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Khởi chạy loadData khi vừa vào màn hình
  useEffect(() => {
    loadData();
  }, []);

  return (
    <View style={styles.container}>
      {/* 1. NẾU ĐANG BỊ CHẶN -> HIỂN THỊ WEBVIEW LÊN Đỉnh */}
      {showCFChallenge && (
        <CloudflareWebView 
          domain={targetDomain}
          onSuccess={() => {
            console.log('🎉 Tick Captcha xong! Đóng WebView và gọi lại API.');
            setShowCFChallenge(false); // Ẩn WebView
            loadData(); // Tự động load lại danh sách bài viết
          }}
        />
      )}

      {/* 2. GIAO DIỆN BÌNH THƯỜNG CỦA APP */}
      {isLoading ? (
        <Text style={styles.text}>Đang tải dữ liệu...</Text>
      ) : (
        <View>
          <Button title="Tải lại trang" onPress={loadData} />
          {/* Render danh sách bài viết ở đây... */}
          <Text numberOfLines={10} style={styles.text}>
            {data ? data : "Chưa có dữ liệu"}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 50 },
  text: { padding: 20 }
});
/* ───────────── Theme & Styles ───────────── */
const C = {
  bg: '#F8F9F5',
  ink: '#111827',
  brand: '#1E4631',
  muted: '#6B7280',
  chip: '#EEF0EA',
  soft: '#E8EFE9',
  warnBg: '#FFFBEB',
  warnBorder: '#F3E3C7',
  danger: '#DC2626',
};

const SHADOW = {
  shadowColor: '#0B1F14',
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
} as const;

const BAR_H = 64;

/* ───────────── Error Boundary chống văng app ───────────── */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App ErrorBoundary:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: C.danger, marginBottom: 8 }}>
            Ứng dụng gặp lỗi khởi chạy
          </Text>
          <Text style={{ fontSize: 14, color: C.ink, marginBottom: 16 }}>
            {this.state.error.message || String(this.state.error)}
          </Text>
          <Pressable
            onPress={() => this.setState({ error: null })}
            style={{ backgroundColor: C.brand, height: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Thử tải lại</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

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
    <Text
      style={{
        color: C.ink,
        fontWeight: '800',
        fontSize: 32,
        paddingHorizontal: 20,
        paddingBottom: 12,
        paddingTop: top + 8,
      }}
    >
      {children}
    </Text>
  );
};

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', borderRadius: 999, padding: 4, backgroundColor: C.chip }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 999,
              alignItems: 'center',
              backgroundColor: on ? C.brand : 'transparent',
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: on ? '#fff' : C.ink }}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const PrimaryButton = ({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) => (
  <Pressable
    onPress={onPress}
    disabled={busy}
    style={{
      marginTop: 16,
      height: 48,
      borderRadius: 999,
      backgroundColor: C.brand,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    }}
  >
    {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{label}</Text>}
  </Pressable>
);

function ThreadRow({ t }: { t: ThreadItem }) {
  const { openGallery } = useApp();
  return (
    <Pressable
      onPress={() => openGallery(t.url, t.title)}
      style={[
        SHADOW,
        {
          backgroundColor: '#fff',
          borderRadius: 24,
          padding: 16,
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 12,
        },
      ]}
    >
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text numberOfLines={2} style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>
          {t.title}
        </Text>
        {!!t.snippet && (
          <Text numberOfLines={2} style={{ fontSize: 13, marginTop: 4, color: C.muted }}>
            {t.snippet}
          </Text>
        )}
      </View>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: C.brand,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
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
    return () => {
      off = true;
    };
  }, [domain, cfVersion]);

  const go = async () => {
    if (!q.trim()) return;
    Keyboard.dismiss();
    setBusy(true);
    setErr('');
    setRows(null);
    try {
      setRows(
        await run(() =>
          searchForum({
            q,
            by: by === 'Tác giả' ? 'author' : scope,
            exact: match === 'Chính xác',
            order: SORTS[sort],
          }),
        ),
      );
    } catch (e: any) {
      setErr(e?.message || 'Lỗi tìm kiếm');
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

      <View style={[SHADOW, { marginHorizontal: 20, backgroundColor: '#fff', borderRadius: 24, padding: 20 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: C.soft,
            }}
          >
            <ZoomIn size={20} color={C.brand} />
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 17 }}>Bạn muốn tìm gì?</Text>
            <Text style={{ fontSize: 13, marginTop: 2, color: C.muted }}>
              Tìm đồng thời bài mới và kho chủ đề cũ trên cả hai nguồn.
            </Text>
          </View>
        </View>

        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={go}
          returnKeyType="search"
          placeholder={by === 'Tác giả' ? 'Nhập tên người đăng' : 'Nhập từ khóa chủ đề'}
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            marginTop: 16,
            borderRadius: 16,
            paddingHorizontal: 16,
            height: 48,
            fontSize: 16,
            color: C.ink,
            backgroundColor: '#F4F5F0',
          }}
        />
        {scope === 'post' && by === 'Từ khóa' && (
          <Pressable onPress={() => setScope('thread')}>
            <Text style={{ fontSize: 12, marginTop: 8, paddingHorizontal: 4, color: C.brand }}>
              Đang tìm trong nội dung bình luận · chạm để quay về tìm theo tiêu đề
            </Text>
          </Pressable>
        )}

        <View style={{ marginTop: 16 }}>
          <Segmented options={BY} value={by} onChange={setBy} />
        </View>

        <Pressable
          onPress={() => setOpen(!open)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingVertical: 4 }}
        >
          <Text style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>Tùy chọn tìm kiếm</Text>
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <ChevronDown size={20} color={C.muted} />
          </View>
        </Pressable>

        {open && (
          <View style={{ marginTop: 8 }}>
            <Segmented options={MATCH} value={match} onChange={setMatch} />
            <Pressable
              onPress={() => setMenu(!menu)}
              style={{
                marginTop: 12,
                height: 48,
                borderRadius: 16,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: '#E5E7EB',
              }}
            >
              <Text style={{ color: C.ink, fontSize: 15 }}>{sort}</Text>
              <ChevronDown size={18} color={C.muted} />
            </Pressable>
            {menu && (
              <View style={{ marginTop: 4, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E7EB' }}>
                {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => {
                      setSort(k);
                      setMenu(false);
                    }}
                    style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: k === sort ? C.soft : '#fff' }}
                  >
                    <Text style={{ fontSize: 15, color: k === sort ? C.brand : C.ink, fontWeight: k === sort ? '600' : '400' }}>
                      {k}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
        <PrimaryButton label="Tìm kiếm" onPress={go} busy={busy} />
      </View>

      <View
        style={{
          marginHorizontal: 20,
          marginTop: 16,
          borderRadius: 24,
          backgroundColor: C.warnBg,
          padding: 16,
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: C.warnBorder,
        }}
      >
        <AlertTriangle size={22} color="#EA8A1C" />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>{warn[0]}</Text>
          <Text style={{ fontSize: 13, marginTop: 2, color: C.muted }}>{warn[1]}</Text>
          {status === 'cf' && (
            <Pressable
              onPress={requestCF}
              style={{
                alignSelf: 'flex-start',
                marginTop: 8,
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: C.brand,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Xác thực ngay</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
        {!!err && <Text style={{ color: C.danger, fontSize: 14, paddingHorizontal: 4, marginBottom: 8 }}>{err}</Text>}
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
    setBusy(true);
    setErr('');
    try {
      setRows(await run(fetchLatest));
    } catch (e: any) {
      setErr(e?.message || 'Không tải được danh sách bài mới');
    } finally {
      setBusy(false);
    }
  }, [run, domain]);

  useEffect(() => {
    if (active) load();
  }, [active, load, cfVersion]);

  return (
    <View style={{ flex: 1 }}>
      <Title>Mới nhất</Title>
      <FlatList
        data={rows}
        keyExtractor={(t) => t.url}
        renderItem={({ item }) => <ThreadRow t={item} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomSpace }}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.brand} />}
        ListEmptyComponent={err ? <Text style={{ color: C.danger, fontSize: 14, paddingHorizontal: 4 }}>{err}</Text> : null}
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
      <View style={{ paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {cards.map(({ Icon, title, sub, onPress }) => (
          <Pressable
            key={title}
            onPress={onPress}
            style={[
              SHADOW,
              {
                backgroundColor: '#fff',
                borderRadius: 24,
                padding: 20,
                marginBottom: 12,
                width: '48.5%',
                minHeight: 150,
                justifyContent: 'space-between',
              },
            ]}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: C.soft,
              }}
            >
              <Icon size={24} color={C.brand} />
            </View>
            <View style={{ paddingTop: 16 }}>
              <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{title}</Text>
              <Text style={{ fontSize: 13, marginTop: 2, color: C.muted }}>{sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      {showLink && (
        <View style={[SHADOW, { marginHorizontal: 20, backgroundColor: '#fff', borderRadius: 24, padding: 20 }]}>
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>Dán link bài viết</Text>
          <TextInput
            value={link}
            onChangeText={setLink}
            onSubmitEditing={submit}
            returnKeyType="go"
            placeholder={`${domain}/threads/...`}
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={{
              marginTop: 12,
              borderRadius: 16,
              paddingHorizontal: 16,
              height: 48,
              fontSize: 16,
              color: C.ink,
              backgroundColor: '#F4F5F0',
            }}
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
  useEffect(() => {
    hasClearance(domain)
      .then(setClear)
      .catch(() => setClear(false));
  }, [domain, cfVersion]);

  const save = async () => {
    try {
      await setDomain(d);
      Alert.alert('Đã lưu', 'Domain mới sẽ được dùng cho mọi yêu cầu tiếp theo.');
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message || 'Không lưu được domain');
    }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const n = await refreshRemoteDomain(true);
      Alert.alert('Đã cập nhật', n ?? '');
    } catch (e: any) {
      Alert.alert('Không cập nhật được', e?.message || 'Lỗi mạng');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottomSpace }}>
      <Title>Thêm</Title>

      <View style={[SHADOW, { marginHorizontal: 20, backgroundColor: '#fff', borderRadius: 24, padding: 20 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Globe size={20} color={C.brand} />
          <Text style={{ marginLeft: 8, color: C.ink, fontWeight: '700', fontSize: 16 }}>Tên miền diễn đàn</Text>
        </View>
        <TextInput
          value={d}
          onChangeText={setD}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={{
            marginTop: 12,
            borderRadius: 16,
            paddingHorizontal: 16,
            height: 48,
            fontSize: 16,
            color: C.ink,
            backgroundColor: '#F4F5F0',
          }}
        />
        <Text style={{ fontSize: 12, marginTop: 8, color: C.muted }}>
          {manual ? 'Đang dùng domain bạn nhập tay.' : 'Domain tự cập nhật từ máy chủ cấu hình mỗi lần mở app.'}
        </Text>
        <PrimaryButton label="Lưu domain" onPress={save} />
        <Pressable
          onPress={sync}
          disabled={busy}
          style={{
            marginTop: 8,
            height: 44,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: C.chip,
          }}
        >
          {busy ? (
            <ActivityIndicator color={C.brand} />
          ) : (
            <Text style={{ color: C.brand, fontWeight: '600', fontSize: 15 }}>Lấy domain mới từ GitHub</Text>
          )}
        </Pressable>
      </View>

      <View style={[SHADOW, { marginHorizontal: 20, marginTop: 16, backgroundColor: '#fff', borderRadius: 24, padding: 20 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ShieldCheck size={20} color={C.brand} />
          <Text style={{ marginLeft: 8, color: C.ink, fontWeight: '700', fontSize: 16 }}>Cookie Cloudflare</Text>
        </View>
        <Text style={{ fontSize: 13, marginTop: 8, color: C.muted }}>
          {clear ? 'Đã có cookie xác thực (cf_clearance).' : 'Chưa có cookie xác thực. Chỉ cần khi diễn đàn trả lỗi 403.'}
        </Text>
        <PrimaryButton label="Mở trang xác thực" onPress={requestCF} />
        <Pressable
          onPress={async () => {
            await clearCookies();
            setClear(false);
          }}
          style={{
            marginTop: 8,
            height: 44,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: C.chip,
          }}
        >
          <Text style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>Xóa cookie</Text>
        </Pressable>
      </View>

      <View
        style={[
          SHADOW,
          {
            marginHorizontal: 20,
            marginTop: 16,
            backgroundColor: '#fff',
            borderRadius: 24,
            padding: 20,
            flexDirection: 'row',
            alignItems: 'center',
          },
        ]}
      >
        <View style={{ flex: 1, paddingRight: 16 }}>
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>Xem ảnh qua proxy</Text>
          <Text style={{ fontSize: 13, marginTop: 4, color: C.muted }}>
            Bọc link ảnh qua wsrv.nl, hữu ích khi nhà mạng chặn zpic/anh.moe mà không bật VPN.
          </Text>
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
  const res = await FileSystem.downloadAsync(src.uri, `${FileSystem.cacheDirectory}xam_${Date.now()}.${ext}`, {
    headers: src.headers,
  });
  if (res.status !== 200) throw new Error(`Tải thất bại (HTTP ${res.status})`);
  await MediaLibrary.saveToLibraryAsync(res.uri);
}

function Viewer({ images, start, onClose }: { images: MediaItem[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const { top, bottom } = useSafeAreaInsets();
  const safeStart = Math.max(0, Math.min(start, images.length - 1));
  const [cur, setCur] = useState(safeStart);
  const [saving, setSaving] = useState(false);

  const download = async () => {
    if (!images[cur]) return;
    setSaving(true);
    try {
      await saveImage(images[cur].url);
      Alert.alert('Đã lưu', 'Ảnh đã được thêm vào Thư viện.');
    } catch (e: any) {
      Alert.alert('Không lưu được', e?.message || 'Lỗi lưu ảnh');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          horizontal
          pagingEnabled
          data={images}
          keyExtractor={(i) => i.id}
          initialScrollIndex={safeStart}
          windowSize={3}
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => setCur(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={{ width, height, justifyContent: 'center' }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              bouncesZoom
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image source={imageSource(item.url)} style={{ width, height }} contentFit="contain" />
            </ScrollView>
          )}
        />
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: top + 6,
            left: 16,
            right: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          >
            <X size={22} color="#fff" />
          </Pressable>
          <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>
              {cur + 1} / {images.length}
            </Text>
          </View>
          <Pressable
            onPress={download}
            disabled={saving}
            hitSlop={10}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          >
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
    setItems([]);
    setState('load');
    setErr('');
    scrapeThread(url, {
      isCancelled: () => off,
      onTitle: (t) => {
        if (!off && t) setTitle(t);
      },
      onProgress: (list, done, total) => {
        if (!off) {
          setItems(list);
          setProg({ done, total });
        }
      },
    })
      .then(() => {
        if (!off) setState('done');
      })
      .catch((e) => {
        if (off) return;
        if (isCloudflare(e)) setState('cf');
        else {
          setErr(e?.message || 'Lỗi tải chủ đề');
          setState('err');
        }
      });
    return () => {
      off = true;
    };
  }, [url, cfVersion]);

  const GAP = 3;
  const PAD = 16;
  const size = Math.floor((width - PAD * 2 - GAP * 2) / 3);
  const shown = items.filter((i) => filter === 'Tất cả' || (filter === 'Ảnh') === (i.type === 'image'));
  const imgs = shown.filter((i) => i.type === 'image');
  const nImg = items.filter((i) => i.type === 'image').length;

  const open = (it: MediaItem) => (it.type === 'video' ? Linking.openURL(it.url) : setViewer(imgs.indexOf(it)));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, paddingTop: top + 6 }}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          style={[
            SHADOW,
            {
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: '#fff',
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <ArrowLeft size={22} color={C.ink} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text numberOfLines={1} style={{ color: C.ink, fontWeight: '700', fontSize: 17 }}>
            {title || 'Đang tải…'}
          </Text>
          <Text style={{ fontSize: 12, marginTop: 2, color: C.muted }}>
            {nImg} ảnh · {items.length - nImg} video
            {state === 'load' && prog.total > 0 ? ` · trang ${prog.done}/${prog.total}` : ''}
          </Text>
        </View>
        {state === 'load' && <ActivityIndicator color={C.brand} />}
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      {state === 'cf' && (
        <View style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 24, backgroundColor: C.warnBg, padding: 16 }}>
          <Text style={{ color: C.ink, fontWeight: '600' }}>Cloudflare đang chặn</Text>
          <Text style={{ fontSize: 13, marginTop: 4, color: C.muted }}>Xác thực một lần rồi trang sẽ tự quét lại.</Text>
          <Pressable
            onPress={requestCF}
            style={{
              alignSelf: 'flex-start',
              marginTop: 12,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: C.brand,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>Xác thực ngay</Text>
          </Pressable>
        </View>
      )}
      {state === 'err' && <Text style={{ color: C.danger, paddingHorizontal: 20, paddingBottom: 12 }}>{err}</Text>}

      <FlatList
        data={shown}
        keyExtractor={(i) => i.id}
        numColumns={3}
        extraData={useProxy}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 40, gap: GAP }}
        initialNumToRender={24}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          state === 'done' ? (
            <Text style={{ textAlign: 'center', marginTop: 40, color: C.muted }}>
              Không tìm thấy ảnh/video nào trong chủ đề này.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            style={{ width: size, height: size, borderRadius: 16, overflow: 'hidden', backgroundColor: '#E5E7EB' }}
          >
            {item.type === 'image' ? (
              <Image source={imageSource(item.url, true)} style={{ flex: 1 }} contentFit="cover" transition={120} recyclingKey={item.id} />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink }}>
                <Play size={26} color="#fff" />
                <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 4, paddingHorizontal: 8 }}>
                  {hostOf(item.url)}
                </Text>
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
    try {
      await syncCookiesFromWebView(domain);
      onClose(true);
    } catch (e: any) {
      Alert.alert('Không lưu được cookie', e?.message || 'Lỗi đồng bộ cookie');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => onClose(false)}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingBottom: 12,
            paddingTop: top + 6,
          }}
        >
          <Pressable onPress={() => onClose(false)} hitSlop={10}>
            <Text style={{ fontSize: 16, color: C.muted }}>Hủy</Text>
          </Pressable>
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>Xác thực Cloudflare</Text>
          <Pressable onPress={save} hitSlop={10}>
            {busy ? <ActivityIndicator /> : <Text style={{ color: C.brand, fontWeight: '700', fontSize: 16 }}>Xong</Text>}
          </Pressable>
        </View>
        <Text style={{ paddingHorizontal: 20, paddingBottom: 8, fontSize: 13, color: C.muted }}>
          Tick ô xác thực, đợi trang diễn đàn hiện ra rồi bấm “Xong”.
        </Text>
        {visible && (
          <WebView
            source={{ uri: domain }}
            userAgent={UA}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            javaScriptEnabled
            style={{ flex: 1 }}
          />
        )}
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

const barBottom = (inset: number) => (inset > 0 ? inset - 10 : 16);

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: barBottom(bottom) }}>
      <View
        style={[
          SHADOW,
          {
            flexDirection: 'row',
            backgroundColor: '#fff',
            alignItems: 'center',
            paddingHorizontal: 8,
            height: BAR_H,
            borderRadius: BAR_H / 2,
            shadowOpacity: 0.14,
          },
        ]}
      >
        {TABS.map(({ key, label, Icon }) => {
          const on = key === tab;
          return (
            <Pressable
              key={key}
              onPress={() => onChange(key)}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                marginHorizontal: 2,
                height: BAR_H - 14,
                backgroundColor: on ? C.brand : 'transparent',
              }}
            >
              <Icon size={22} color={on ? '#fff' : C.muted} strokeWidth={on ? 2.4 : 2} />
              <Text style={{ fontSize: 10.5, marginTop: 2, fontWeight: '600', color: on ? '#fff' : C.muted }}>{label}</Text>
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

  useEffect(() => {
    Promise.resolve()
      .then(() => initConfig())
      .catch((e) => console.warn('initConfig error:', e))
      .finally(() => setReady(true));
  }, []);

  const changeTab = useCallback((t: Tab) => {
    setTab(t);
    setVisited((v) => (v.includes(t) ? v : [...v, t]));
  }, []);
  const requestCF = useCallback(() => setCfOpen(true), []);
  const openGallery = useCallback((url: string, title?: string) => setGallery({ url, title }), []);
  const goSearch = useCallback(
    (mode: Mode) => {
      setPreset({ mode, n: Date.now() });
      changeTab('search');
    },
    [changeTab],
  );

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
        <ActivityIndicator color={C.brand} />
      </View>
    );
  }

  const ctx: Ctx = { openGallery, requestCF, cfVersion, bottomSpace: BAR_H + barBottom(bottom) + 28, preset, goSearch };
  const pane = (k: Tab, node: React.ReactNode) =>
    visited.includes(k) && (
      <View key={k} style={{ flex: 1, display: tab === k ? 'flex' : 'none' }}>
        {node}
      </View>
    );

  return (
    <AppCtx.Provider value={ctx}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
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
        <CloudflareModal
          visible={cfOpen}
          onClose={(saved) => {
            setCfOpen(false);
            if (saved) setCfVersion((v) => v + 1);
          }}
        />
      </View>
    </AppCtx.Provider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
