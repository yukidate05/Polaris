import { useEffect, useCallback, useState, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AuroraBackground, PaywallModal, SubscriptionStatusBanner } from '@components/ui';
import { useAuthStore } from '@stores/authStore';
import { subscriptionService, type AccessStatus } from '@services/subscriptionService';
import { checkIsPro } from '@lib/revenuecat';
import { useBriefingStore, type BriefingStatus } from '@stores/briefingStore';
import { useUserPreferencesStore } from '@stores/userPreferencesStore';
import { googleDataService, MOCK_GOOGLE_DATA } from '@services/googleDataService';
import { briefingService } from '@services/briefingService';
import { sessionService } from '@services/sessionService';
import { bgmService } from '@services/bgmService';
import { useT } from '@/i18n';
import Constants from 'expo-constants';

const { height: SCREEN_H } = Dimensions.get('window');
const HERO_H = Math.round(SCREEN_H * 0.60);
const isExpoGo = Constants.appOwnership === 'expo';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function getGreetingKey(h: number) {
  if (h < 12) return 'good_morning' as const;
  if (h < 17) return 'good_afternoon' as const;
  return 'good_evening' as const;
}

function formatDate() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const STATUS_KEYS: Record<BriefingStatus, 'status_idle'|'status_fetching'|'status_script'|'status_audio'|'status_ready'|'status_error'|'status_quota'> = {
  idle:              'status_idle',
  fetching:          'status_fetching',
  generating_script: 'status_script',
  generating_audio:  'status_audio',
  ready:             'status_ready',
  error:             'status_error',
  quota_exceeded:    'status_quota',
};


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


// ── Main ────────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, googleAccessToken, googleTokenResolved } = useAuthStore();
  const { selectedHostIds, preferences } = useUserPreferencesStore();
  const {
    status, googleData, script, hasPlayed,
    setStatus, setGoogleData, setScript, setError, setHasPlayed,
  } = useBriefingStore();

  const firstName = profile?.displayName?.split(' ')[0]
    ?? user?.displayName?.split(' ')[0]
    ?? 'Guest';

  const t = useT();
  const hour     = new Date().getHours();
  const greeting = t(getGreetingKey(hour));
  const dateStr  = formatDate();

  const isGenerating = ['fetching', 'generating_script', 'generating_audio'].includes(status);
  const activeTab = 'foryou';
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallStatus,  setPaywallStatus]  = useState<AccessStatus | null>(null);

  const generateBriefing = useCallback(async () => {
    if (isGenerating) return;

    // ── 1. まずGoogleデータを取得（アクセス制限に関わらず） ──────────
    setStatus('fetching');
    let data = googleData;
    try {
      const sessionData = user?.uid
        ? await sessionService.get(user.uid).catch(() => null)
        : null;

      if (user?.uid) sessionService.markOpened(user.uid);

      if (!data) {
        if (isExpoGo || !googleAccessToken) {
          await new Promise((r) => setTimeout(r, 600));
          data = MOCK_GOOGLE_DATA;
        } else {
          data = await googleDataService.fetchAll(googleAccessToken);
        }
        setGoogleData(data);
      }

      // ── 2. アクセス制御チェック（データ取得後） ──────────────────────
      let userIsPro = false;
      if (user?.uid) {
        const [isPro, access] = await Promise.all([
          checkIsPro(),
          subscriptionService.checkAccess(user.uid, false),
        ]);
        userIsPro = isPro || access.reason === 'pro';
        const finalAccess = userIsPro
          ? { allowed: true, reason: 'pro' as const, trialDaysLeft: 0, cooldownDaysLeft: 0 }
          : access;

        if (!finalAccess.allowed) {
          setStatus('idle');
          setPaywallStatus(finalAccess);
          setPaywallVisible(true);
          return;
        }
      }

      // ── 3. スクリプト・音声生成 ───────────────────────────────────────
      setStatus('generating_script');
      const lang = useUserPreferencesStore.getState().preferences.language;
      const sc = await briefingService.generate(
        data, firstName, [], hasPlayed, user?.uid ?? undefined, sessionData, selectedHostIds, userIsPro, lang
      );
      setScript(sc);
      if (user?.uid) subscriptionService.recordGeneration(user.uid);
    } catch (e: any) {
      bgmService.stop();
      const msg = e?.message ?? '';
      if (msg.includes('429') || msg.includes('quota_exceeded')) {
        setStatus('quota_exceeded');
      } else {
        setError(msg || 'Unknown error');
      }
    }
  }, [isGenerating, googleData, googleAccessToken, firstName, hasPlayed]);

  useFocusEffect(
    useCallback(() => {
      bgmService.play();
    }, [])
  );

  const generateBriefingRef = useRef(generateBriefing);
  useEffect(() => { generateBriefingRef.current = generateBriefing; });

  const hasAutoTriggeredRef = useRef(false);
  useEffect(() => {
    if (status === 'idle' && googleTokenResolved && !hasAutoTriggeredRef.current) {
      hasAutoTriggeredRef.current = true;
      generateBriefingRef.current();
    }
  }, [status, googleTokenResolved]);

  const handlePlay = async () => {
    if (!script) return;
    setHasPlayed(true);
    await bgmService.fadeOutAndStop();
    router.push('/player');
  };

  const unread      = googleData?.unreadCount         ?? 0;
  const todayCount  = googleData?.todayEvents?.length  ?? 0;
  const todayEvs    = googleData?.todayEvents          ?? [];
  const tomorrowEvs = googleData?.tomorrowEvents       ?? [];
  const topEmails   = googleData?.topEmails            ?? [];

  return (
    <View style={s.root}>
      <PaywallModal
        visible={paywallVisible}
        status={paywallStatus}
        onUpgrade={() => { setPaywallVisible(false); router.push('/(tabs)/settings'); }}
        onDismiss={() => setPaywallVisible(false)}
      />
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

          {/* サブスクステータス */}
          <SubscriptionStatusBanner />

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
                <Text style={s.quotaTitle}>{t('quota_title')}</Text>
                <Text style={s.quotaSub}>{t('quota_sub')}</Text>
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
                  <Text style={s.playBtnText}>{t(STATUS_KEYS[status])}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="play" size={14} color="#000" style={{ marginRight: 7 }} />
                  <Text style={s.playBtnText}>{t('play')}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Tabs */}
          <View style={s.tabRow}>
            <View style={s.tabItem}>
              <Text style={[s.tabLabel, s.tabLabelOn]}>{t('for_you')}</Text>
              <View style={s.tabUnderline} />
            </View>
            <TouchableOpacity
              style={s.tabRefresh}
              onPress={generateBriefing}
              disabled={isGenerating}
            >
              <Ionicons name="refresh" size={18} color={isGenerating ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.45)'} />
            </TouchableOpacity>
          </View>

          {/* Tab body */}
          {activeTab === 'foryou' && (
            <View style={s.tabBody}>

              {/* Email highlights */}
              {topEmails.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>✉  {t('todays_mail')}</Text>
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
                  <Text style={s.sectionLabel}>📅  {t('todays_schedule')}</Text>
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
                  <Text style={s.sectionLabel}>🌙  {t('tomorrows_schedule')}</Text>
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
                  <Text style={s.emptyText}>{t('loading_data')}</Text>
                </View>
              )}

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
  scrollContent: { paddingBottom: 40 },

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

  // List card — dark glass (Huxe style)
  listCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.11)',
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

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText:  { fontSize: 14, color: 'rgba(255,255,255,0.3)' },
});
