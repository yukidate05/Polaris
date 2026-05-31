import { useEffect, useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, ImageBackground, Dimensions,
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
const HERO_IMG = require('../../img/Huxe/3847.jpg');

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
};

const DISCOVER_CARDS = [
  { id: '1', title: 'AI ニュース',  desc: "Today's top AI headlines", c1: '#5B8DB8', c2: '#3A6690' },
  { id: '2', title: 'マーケット',   desc: 'Market trends & insights',  c1: '#B85B5B', c2: '#8F3A3A' },
  { id: '3', title: 'テック',       desc: "What's shaping tech",        c1: '#5BB87A', c2: '#3A8F58' },
  { id: '4', title: 'ビジネス',     desc: 'Business & economy',        c1: '#B8975B', c2: '#8F723A' },
];

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
      setError(e?.message ?? 'Unknown error');
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
          <ImageBackground source={HERO_IMG} style={StyleSheet.absoluteFill} resizeMode="cover" />

          {/* Top scrim so header text is legible */}
          <LinearGradient
            colors={['rgba(0,0,0,0.50)', 'rgba(0,0,0,0.10)', 'transparent']}
            style={s.heroTopScrim}
          />

          {/* Bottom fade to black */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)', '#000']}
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

          {/* Play button */}
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
              <Text style={s.sectionLabel}>↗  ニュース</Text>
              <View style={s.discGrid}>
                {DISCOVER_CARDS.map((c) => <DiscoverCard key={c.id} {...c} />)}
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
  root:          { flex: 1, backgroundColor: '#000' },
  scrollContent: { paddingBottom: 120 },

  // Hero
  hero: { width: '100%', position: 'relative' },
  heroTopScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 140,
  },
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
    position: 'absolute', bottom: 32, left: 0, right: 0, alignItems: 'center',
  },
  heroGreeting: {
    fontSize: 30, fontWeight: '700', color: '#fff', letterSpacing: -0.7,
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10,
  },
  heroDate: {
    fontSize: 14, color: 'rgba(255,255,255,0.72)', marginTop: 5, fontWeight: '500',
  },

  // Below hero
  below: { backgroundColor: '#000', paddingHorizontal: 22, paddingTop: 2, gap: 18 },

  // Stats
  statsBar:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 36, paddingVertical: 14 },
  statItem:    { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statNum:     { fontSize: 22, fontWeight: '600', color: '#fff' },
  statDivider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.18)' },

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

  // Discover
  discGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  discCard: {
    width: '47%' as any, height: 155, borderRadius: 16,
    overflow: 'hidden', padding: 16, justifyContent: 'flex-end',
  },
  discTitle: {
    fontSize: 15, fontWeight: '700', color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  discDesc: { fontSize: 11, color: 'rgba(255,255,255,0.78)', marginTop: 4 },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText:  { fontSize: 14, color: 'rgba(255,255,255,0.3)' },
});
