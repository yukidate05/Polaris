import { useEffect, useCallback, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Dimensions, Animated,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '@stores/authStore';
import { useBriefingStore, type BriefingStatus } from '@stores/briefingStore';
import { googleDataService, MOCK_GOOGLE_DATA } from '@services/googleDataService';
import { briefingService } from '@services/briefingService';
import Constants from 'expo-constants';

const { height: SCREEN_H } = Dimensions.get('window');
const HERO_H = Math.round(SCREEN_H * 0.60);
const isExpoGo = Constants.appOwnership === 'expo';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function getGreeting(h: number) {
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatDate() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const STATUS_LABELS: Record<BriefingStatus, string> = {
  idle:              'Preparing...',
  fetching:          'Fetching data...',
  generating_script: 'Writing script...',
  generating_audio:  'Generating audio...',
  ready:             'Ready to play',
  error:             'Error occurred',
  quota_exceeded:    '今日の利用上限に達しました',
};

const DISCOVER_CARDS = [
  { id: '1', title: 'AI ニュース',  desc: "Today's top AI headlines", c1: '#5B8DB8', c2: '#3A6690' },
  { id: '2', title: 'マーケット',   desc: 'Market trends & insights',  c1: '#B85B5B', c2: '#8F3A3A' },
  { id: '3', title: 'テック',       desc: "What's shaping tech",        c1: '#5BB87A', c2: '#3A8F58' },
  { id: '4', title: 'ビジネス',     desc: 'Business & economy',        c1: '#B8975B', c2: '#8F723A' },
];

// ── Aurora animated background ──────────────────────────────────────────────────
// HTML参考: createConicGradient + screen blend で複数バンドが独立回転
// RN版: 4つのLinearGradientをAnimated.loopで独立してパルス＋漂流

const AURORA_BANDS = [
  { colors: ['transparent','rgba(0,230,180,0.60)','rgba(0,180,230,0.40)','transparent'],
    start:{x:0.0,y:0.08}, end:{x:1.0,y:0.55}, opMin:0.18, opMax:0.85, drift:[-28,18], dur:7200, delay:0 },
  { colors: ['transparent','rgba(60,100,255,0.55)','rgba(120,220,255,0.38)','transparent'],
    start:{x:0.05,y:0.20}, end:{x:0.95,y:0.68}, opMin:0.15, opMax:0.72, drift:[20,-22], dur:9400, delay:1800 },
  { colors: ['transparent','rgba(150,50,255,0.50)','rgba(80,210,255,0.32)','transparent'],
    start:{x:0.12,y:0.06}, end:{x:0.88,y:0.60}, opMin:0.12, opMax:0.65, drift:[-15,30], dur:8100, delay:3400 },
  { colors: ['transparent','rgba(0,255,140,0.45)','rgba(0,210,190,0.35)','transparent'],
    start:{x:0.18,y:0.26}, end:{x:0.82,y:0.72}, opMin:0.20, opMax:0.78, drift:[12,-18], dur:10600, delay:900 },
];

function AuroraBackground() {
  const anims = useRef(AURORA_BANDS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = AURORA_BANDS.map((band, i) => {
      const steps: Animated.CompositeAnimation[] = [];
      if (band.delay > 0) steps.push(Animated.delay(band.delay));
      steps.push(Animated.timing(anims[i], { toValue: 1, duration: band.dur, useNativeDriver: true }));
      steps.push(Animated.timing(anims[i], { toValue: 0, duration: band.dur, useNativeDriver: true }));
      return Animated.loop(Animated.sequence(steps));
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#020610' }]}>
      <LinearGradient
        colors={['#030816', '#060e24', '#040a18']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      {AURORA_BANDS.map((band, i) => {
        const opacity   = anims[i].interpolate({ inputRange:[0,1], outputRange:[band.opMin, band.opMax] });
        const translateY = anims[i].interpolate({ inputRange:[0,1], outputRange:band.drift });
        return (
          <Animated.View key={i} style={[StyleSheet.absoluteFill, { opacity, transform:[{translateY}] }]}>
            <LinearGradient
              colors={band.colors as string[]}
              start={band.start}
              end={band.end}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function ScheduleRow({ ev }: { ev: { title: string; startTime: string; location?: string } }) {
  return (
    <View style={s.schedRow}>
      <Text style={s.schedTime}>{ev.startTime}</Text>
      <View style={s.schedDot} />
      <View style={{ flex: 1 }}>
        <Text style={s.schedTitle} numberOfLines={1}>{ev.title}</Text>
        {ev.location && <Text style={s.schedLoc} numberOfLines={1}>{ev.location}</Text>}
      </View>
    </View>
  );
}

function DiscoverCard({ title, desc, c1, c2 }: { title: string; desc: string; c1: string; c2: string }) {
  return (
    <TouchableOpacity activeOpacity={0.8} style={s.discCard}>
      <LinearGradient colors={[c1, c2]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <Text style={s.discTitle}>{title}</Text>
      <Text style={s.discDesc} numberOfLines={2}>{desc}</Text>
    </TouchableOpacity>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, googleAccessToken } = useAuthStore();
  const {
    status, googleData, script, hasPlayed,
    setStatus, setGoogleData, setScript, setError, setHasPlayed,
  } = useBriefingStore();

  const firstName = profile?.displayName?.split(' ')[0]
    ?? user?.displayName?.split(' ')[0]
    ?? 'Guest';

  const hour     = new Date().getHours();
  const greeting = getGreeting(hour);
  const dateStr  = formatDate();

  const isGenerating = ['fetching', 'generating_script', 'generating_audio'].includes(status);
  const [activeTab, setActiveTab] = useState<'foryou' | 'discover'>('foryou');

  const generateBriefing = useCallback(async () => {
    if (isGenerating) return;
    setStatus('fetching');
    let data = googleData;
    try {
      if (!data) {
        if (isExpoGo || !googleAccessToken) {
          await new Promise((r) => setTimeout(r, 600));
          data = MOCK_GOOGLE_DATA;
        } else {
          data = await googleDataService.fetchAll(googleAccessToken);
        }
        setGoogleData(data);
      }
      setStatus('generating_script');
      const sc = await briefingService.generate(data, firstName, [], hasPlayed, user?.uid ?? undefined);
      setScript(sc);
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (msg.includes('429') || msg.includes('quota_exceeded')) {
        setStatus('quota_exceeded');
      } else {
        setError(msg || 'Unknown error');
      }
    }
  }, [isGenerating, googleData, googleAccessToken, firstName, hasPlayed]);

  useEffect(() => {
    if (status === 'idle') generateBriefing();
  }, []);

  const handlePlay = () => {
    if (script) { setHasPlayed(true); router.push('/player'); }
  };

  const unread      = googleData?.unreadCount         ?? 0;
  const todayCount  = googleData?.todayEvents?.length  ?? 0;
  const todayEvs    = googleData?.todayEvents          ?? [];
  const tomorrowEvs = googleData?.tomorrowEvents       ?? [];
  const topEmails   = googleData?.topEmails            ?? [];

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent} bounces>

        {/* ── Hero ── */}
        <View style={[s.hero, { height: HERO_H }]}>
          <AuroraBackground />

          {/* Bottom fade to black */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.60)', '#000']}
            style={s.heroBottomFade}
            locations={[0.40, 0.75, 1]}
          />

          {/* Header */}
          <View style={[s.header, { marginTop: insets.top + 6 }]} pointerEvents="box-none">
            <Text style={s.appTitle}>Polaris</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/settings')} style={s.menuBtn}>
              <Ionicons name="menu" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Greeting */}
          <View style={s.heroText}>
            <Text style={s.heroGreeting}>{greeting}, {firstName}</Text>
            <Text style={s.heroDate}>{dateStr}</Text>
          </View>
        </View>

        {/* ── Below hero ── */}
        <View style={s.below}>

          {/* Stats bar */}
          <View style={s.statsBar}>
            <View style={s.statItem}>
              <Ionicons name="mail-outline" size={20} color="rgba(255,255,255,0.7)" />
              <Text style={s.statNum}>{unread}</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statItem}>
              <Ionicons name="calendar-outline" size={20} color="rgba(255,255,255,0.7)" />
              <Text style={s.statNum}>{todayCount}</Text>
            </View>
          </View>

          {/* Quota exceeded banner */}
          {status === 'quota_exceeded' && (
            <View style={s.quotaBanner}>
              <Ionicons name="alert-circle-outline" size={20} color="#F4A24A" />
              <View style={{ flex: 1 }}>
                <Text style={s.quotaTitle}>今日はこれ以上生成できません</Text>
                <Text style={s.quotaSub}>Gemini APIの無料枠を使い切りました。明日リセットされます。</Text>
              </View>
            </View>
          )}

          {/* Play button */}
          {status !== 'quota_exceeded' && (
            <TouchableOpacity
              style={[s.playBtn, (!script || isGenerating) && s.playBtnDimmed]}
              onPress={handlePlay}
              disabled={!script || isGenerating}
              activeOpacity={0.88}
            >
              {isGenerating ? (
                <>
                  <ActivityIndicator size="small" color="#000" style={{ marginRight: 8 }} />
                  <Text style={s.playBtnText}>{STATUS_LABELS[status]}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="play" size={14} color="#000" style={{ marginRight: 7 }} />
                  <Text style={s.playBtnText}>Play</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Tabs */}
          <View style={s.tabRow}>
            <TouchableOpacity style={s.tabItem} onPress={() => setActiveTab('foryou')}>
              <Text style={[s.tabLabel, activeTab === 'foryou' && s.tabLabelOn]}>For You</Text>
              {activeTab === 'foryou' && <View style={s.tabUnderline} />}
            </TouchableOpacity>
            <TouchableOpacity style={s.tabItem} onPress={() => setActiveTab('discover')}>
              <Text style={[s.tabLabel, activeTab === 'discover' && s.tabLabelOn]}>Discover</Text>
              {activeTab === 'discover' && <View style={s.tabUnderline} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.tabRefresh}
              onPress={generateBriefing}
              disabled={isGenerating}
            >
              <Ionicons name="refresh" size={18} color={isGenerating ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.45)'} />
            </TouchableOpacity>
          </View>

          {/* Tab body */}
          {activeTab === 'foryou' ? (
            <View style={s.tabBody}>

              {/* Email highlights */}
              {topEmails.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>✉  今日のメール</Text>
                  <View style={s.listCard}>
                    {topEmails.slice(0, 3).map((e, i) => (
                      <View key={i} style={[s.emailRow, i > 0 && s.rowBorder]}>
                        <View style={s.emailDot} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.emailFrom} numberOfLines={1}>{e.from}</Text>
                          <Text style={s.emailSubject} numberOfLines={1}>{e.subject}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Today's schedule */}
              {todayEvs.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>📅  今日の予定</Text>
                  <View style={s.listCard}>
                    {todayEvs.slice(0, 4).map((ev, i) => (
                      <View key={i} style={i > 0 ? s.rowBorder : undefined}>
                        <ScheduleRow ev={ev} />
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Tomorrow */}
              {tomorrowEvs.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>🌙  明日の予定</Text>
                  <View style={s.listCard}>
                    {tomorrowEvs.slice(0, 4).map((ev, i) => (
                      <View key={i} style={i > 0 ? s.rowBorder : undefined}>
                        <ScheduleRow ev={ev} />
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Empty state */}
              {topEmails.length === 0 && todayEvs.length === 0 && !isGenerating && (
                <View style={s.emptyState}>
                  <Text style={s.emptyText}>今日のデータを読み込んでいます</Text>
                </View>
              )}

            </View>
          ) : (
            <View style={s.tabBody}>
              {/* Search bar */}
              <View style={s.searchBar}>
                <Ionicons name="search-outline" size={16} color="rgba(255,255,255,0.45)" style={{ marginRight: 8 }} />
                <Text style={s.searchPlaceholder}>Find new shows</Text>
              </View>
              {/* News section */}
              <View>
                <View style={s.discSectionHeader}>
                  <Ionicons name="trending-up-outline" size={14} color="rgba(255,255,255,0.55)" />
                  <Text style={s.discSectionLabel}>News</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={s.discRow}>
                    {DISCOVER_CARDS.map((c) => <DiscoverCard key={c.id} {...c} />)}
                  </View>
                </ScrollView>
              </View>
            </View>
          )}

        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#020610' },
  scrollContent: { paddingBottom: 120 },

  // Hero
  hero: { width: '100%', position: 'relative' },
  heroBottomFade: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 220,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 22,
  },
  appTitle: {
    fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -0.6,
  },
  menuBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroText: {
    position: 'absolute', bottom: '40%', left: 0, right: 0, alignItems: 'center',
  },
  heroGreeting: {
    fontSize: 30, fontWeight: '700', color: '#fff', letterSpacing: -0.7,
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10,
  },
  heroDate: {
    fontSize: 14, color: 'rgba(255,255,255,0.72)', marginTop: 5, fontWeight: '500',
  },

  // Below hero
  below: { backgroundColor: '#020610', paddingHorizontal: 22, paddingTop: 2, gap: 18 },

  // Stats
  statsBar:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 36, paddingVertical: 14 },
  statItem:    { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statNum:     { fontSize: 22, fontWeight: '600', color: '#fff' },
  statDivider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.18)' },

  // Quota exceeded
  quotaBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: 'rgba(244,162,74,0.12)',
    borderWidth: 1, borderColor: 'rgba(244,162,74,0.30)',
    borderRadius: 16, padding: 16,
  },
  quotaTitle: { fontSize: 14, fontWeight: '700', color: '#F4A24A', marginBottom: 4 },
  quotaSub:   { fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 17 },

  // Play button
  playBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderRadius: 30, paddingVertical: 17,
  },
  playBtnDimmed: { opacity: 0.48 },
  playBtnText:   { fontSize: 16, fontWeight: '600', color: '#000' },

  // Tabs
  tabRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.09)',
  },
  tabItem:      { paddingBottom: 13, marginRight: 22, position: 'relative' },
  tabLabel:     { fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.38)' },
  tabLabelOn:   { color: '#fff', fontWeight: '700' },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 2, backgroundColor: '#fff', borderRadius: 1,
  },
  tabRefresh: { marginLeft: 'auto' as any, paddingBottom: 13 },
  tabBody:    { gap: 22, paddingTop: 6 },

  // Section
  section:      { gap: 10 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.42)', letterSpacing: 0.5 },

  // List card (shared by email and schedule)
  listCard: {
    backgroundColor: '#111', borderRadius: 16, overflow: 'hidden',
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },

  // Email
  emailRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  emailDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  emailFrom:   { fontSize: 13, fontWeight: '600', color: '#fff' },
  emailSubject:{ fontSize: 12, color: 'rgba(255,255,255,0.48)', marginTop: 2 },

  // Schedule
  schedRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  schedTime: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.38)', width: 40 },
  schedDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  schedTitle:{ fontSize: 13, fontWeight: '600', color: '#fff' },
  schedLoc:  { fontSize: 11, color: 'rgba(255,255,255,0.38)', marginTop: 2 },

  // Search bar
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1C1C1C', borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 13,
  },
  searchPlaceholder: { fontSize: 15, color: 'rgba(255,255,255,0.38)' },

  // Discover section
  discSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  discSectionLabel:  { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.70)' },
  discRow:  { flexDirection: 'row', gap: 12, paddingBottom: 4 },
  discCard: {
    width: 175, height: 170, borderRadius: 16,
    overflow: 'hidden', padding: 14, justifyContent: 'flex-end',
  },
  discTitle: {
    fontSize: 15, fontWeight: '700', color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  discDesc: { fontSize: 11, color: 'rgba(255,255,255,0.78)', marginTop: 3, lineHeight: 16 },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText:  { fontSize: 14, color: 'rgba(255,255,255,0.3)' },
});
