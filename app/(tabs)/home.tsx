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
import { AuroraBackground, PaywallModal, SubscriptionStatusBanner, ChatworkIcon } from '@components/ui';
import { useAuthStore } from '@stores/authStore';
import { subscriptionService, type AccessStatus } from '@services/subscriptionService';
import { checkIsPro, getOfferings, purchasePackage } from '@lib/revenuecat';
import { useBriefingStore, type BriefingStatus } from '@stores/briefingStore';
import { useUserPreferencesStore } from '@stores/userPreferencesStore';
import { googleDataService, MOCK_GOOGLE_DATA } from '@services/googleDataService';
import { briefingService, fetchExternalToolData, type ExternalStats, type ExternalToolData } from '@services/briefingService';
import { sessionService } from '@services/sessionService';
import { bgmService } from '@services/bgmService';
import { useT } from '@/i18n';
import Constants from 'expo-constants';

const { height: SCREEN_H } = Dimensions.get('window');
const HERO_H = Math.round(SCREEN_H * 0.50);
const isExpoGo = Constants.appOwnership === 'expo';
const AUTO_BRIEFING = true;
const SKIP_TTS      = false;


function getGreetingKey(h: number) {
  if (h < 12) return 'good_morning' as const;
  if (h < 17) return 'good_afternoon' as const;
  return 'good_evening' as const;
}

function formatDate(lang?: string) {
  return new Intl.DateTimeFormat(lang ?? 'en', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
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
  const dateStr  = formatDate(preferences.language);

  const isGenerating = ['fetching', 'generating_script', 'generating_audio'].includes(status);
  const activeTab = 'foryou';
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallStatus,  setPaywallStatus]  = useState<AccessStatus | null>(null);
  const [localExternalStats, setLocalExternalStats] = useState<ExternalStats | null>(null);
  const [localExternalData,  setLocalExternalData]  = useState<ExternalToolData | null>(null);
  const externalDataRef = useRef<ExternalToolData | null>(null);

  async function handlePaywallUpgrade() {
    setPaywallVisible(false);
    if (isExpoGo) { router.push('/(tabs)/settings'); return; }
    try {
      const offerings = await getOfferings();
      const pkg = offerings?.current?.monthly ?? offerings?.current?.availablePackages[0];
      if (!pkg) { router.push('/(tabs)/settings'); return; }
      await purchasePackage(pkg);
      // Re-check Pro status → re-trigger briefing generation
      const isPro = await checkIsPro().catch(() => false);
      if (isPro) generateBriefing();
    } catch (e: unknown) {
      if (!(e as { userCancelled?: boolean })?.userCancelled) {
        router.push('/(tabs)/settings');
      }
    }
  }

  const generateBriefing = useCallback(async () => {
    if (isGenerating) return;

    // ── 1. Googleデータを取得 ──────────────────────────────────────────
    setStatus('fetching');
    let data = googleData;
    try {
      const sessionData = user?.uid
        ? await sessionService.get(user.uid).catch(() => null)
        : null;

      if (user?.uid) sessionService.markOpened(user.uid);

      let isMockData = false;
      if (!data) {
        if (isExpoGo || !googleAccessToken) {
          await new Promise((r) => setTimeout(r, 600));
          data = MOCK_GOOGLE_DATA;
          isMockData = true;
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
      const prefs = useUserPreferencesStore.getState().preferences;
      const lang = prefs.language;
      const interests = prefs.topicsOfInterest ?? [];
      const sc = await briefingService.generate(
        data, firstName, interests, hasPlayed, user?.uid ?? undefined, sessionData, selectedHostIds, userIsPro, lang, isMockData, externalDataRef.current, SKIP_TTS
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

      // ブリーフィングと独立して外部ツールの件数を取得・表示
      if (!user?.uid) return;
      fetchExternalToolData().then(extData => {
        externalDataRef.current = extData;
        setLocalExternalData(extData);
        const stats: ExternalStats = {};
        if (extData.slackMessages !== null)
          stats.slack  = { messageCount: extData.slackTotalUnread ?? extData.slackMessages.flatMap(ch => ch.messages).length };
        if (extData.notionPages !== null) {
          const today = new Date().toDateString();
          stats.notion = { pageCount: extData.notionPages.filter(p => new Date(p.lastEdited).toDateString() === today).length };
        }
        if (extData.teamsChats !== null)
          stats.teams    = { chatCount: extData.teamsChats.length };
        if (extData.chatworkMessages !== null)
          stats.chatwork = { messageCount: extData.chatworkTotalUnread ?? extData.chatworkMessages.length };
        setLocalExternalStats(stats);
      }).catch(() => {});
    }, [user?.uid])
  );

  const generateBriefingRef = useRef(generateBriefing);
  useEffect(() => { generateBriefingRef.current = generateBriefing; });

  const hasAutoTriggeredRef = useRef(false);
  useEffect(() => {
    if (AUTO_BRIEFING && status === 'idle' && googleTokenResolved && !hasAutoTriggeredRef.current) {
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

  const unread        = googleData?.unreadCount         ?? 0;
  const todayCount    = googleData?.todayEvents?.length  ?? 0;
  const todayEvs      = googleData?.todayEvents          ?? [];
  const tomorrowEvs   = googleData?.tomorrowEvents       ?? [];
  const topEmails     = googleData?.topEmails            ?? [];


  return (
    <View style={s.root}>
      <PaywallModal
        visible={paywallVisible}
        status={paywallStatus}
        onUpgrade={handlePaywallUpgrade}
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
            <TouchableOpacity onPress={() => router.push('/(tabs)/settings')} style={s.menuBtn} accessibilityLabel="設定を開く">
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

          {/* Stats grid 3×2 */}
          <View style={s.statsGrid}>
            {[
              { ionicon: 'mail-outline' as const,          count: unread,                                     connected: true },
              { ionicon: 'calendar-outline' as const,      count: todayCount,                                 connected: true },
              { ionicon: 'chatbubbles-outline' as const,   count: localExternalStats?.slack?.messageCount,    connected: localExternalStats?.slack    !== undefined },
              { ionicon: 'document-text-outline' as const, count: localExternalStats?.notion?.pageCount,      connected: localExternalStats?.notion   !== undefined },
              { ionicon: null,                              count: localExternalStats?.chatwork?.messageCount, connected: localExternalStats?.chatwork !== undefined },
            ].map(({ ionicon, count, connected }, i) => {
              const iconColor = connected ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)';
              return (
                <View key={i} style={[
                  s.statCell,
                  i < 4 && s.statCellDividerRight,
                ]}>
                  {ionicon
                    ? <Ionicons name={ionicon} size={17} color={iconColor} />
                    : <ChatworkIcon size={17} color={iconColor} />
                  }
                  <Text style={[s.statCellNum, !connected && { color: 'rgba(255,255,255,0.2)' }]}>
                    {connected ? count ?? 0 : '—'}
                  </Text>
                </View>
              );
            })}
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
              accessibilityLabel="ブリーフィングを更新"
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
                  <View style={s.sectionLabelRow}>
                    <Ionicons name="mail-outline" size={12} color="rgba(255,255,255,0.42)" />
                    <Text style={s.sectionLabel}>{t('todays_mail')}</Text>
                  </View>
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
                  <View style={s.sectionLabelRow}>
                    <Ionicons name="calendar-outline" size={12} color="rgba(255,255,255,0.42)" />
                    <Text style={s.sectionLabel}>{t('todays_schedule')}</Text>
                  </View>
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
                  <View style={s.sectionLabelRow}>
                    <Ionicons name="moon-outline" size={12} color="rgba(255,255,255,0.42)" />
                    <Text style={s.sectionLabel}>{t('tomorrows_schedule')}</Text>
                  </View>
                  <View style={s.listCard}>
                    {tomorrowEvs.slice(0, 4).map((ev, i) => (
                      <View key={i} style={i > 0 ? s.rowBorder : undefined}>
                        <ScheduleRow ev={ev} />
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Slack */}
              {localExternalData?.slackMessages && localExternalData.slackMessages.length > 0 && (
                <View style={s.section}>
                  <View style={s.sectionLabelRow}>
                    <Ionicons name="chatbubbles-outline" size={12} color="rgba(255,255,255,0.42)" />
                    <Text style={s.sectionLabel}>SLACK</Text>
                    {(localExternalStats?.slack?.messageCount ?? 0) > 0 && (
                      <View style={s.countBadge}>
                        <Text style={s.countBadgeText}>{localExternalStats!.slack!.messageCount}</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.listCard}>
                    {localExternalData.slackMessages.slice(0, 3).map((ch, i) => {
                      const lastMsg = ch.messages[ch.messages.length - 1] ?? '';
                      const channelLabel = ch.channelName.startsWith('DM') ? ch.channelName : `#${ch.channelName}`;
                      return (
                        <View key={i} style={[s.externalRow, i > 0 && s.rowBorder]}>
                          <View style={s.externalHeader}>
                            <Text style={s.externalRoomName} numberOfLines={1}>{ch.workspace} / {channelLabel}</Text>
                            <Text style={s.externalCount}>{ch.messages.length}件</Text>
                          </View>
                          {!!lastMsg && (
                            <Text style={s.externalPreview} numberOfLines={2}>{lastMsg}</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Chatwork */}
              {localExternalData?.chatworkMessages && localExternalData.chatworkMessages.length > 0 && (() => {
                const rooms: Record<string, typeof localExternalData.chatworkMessages> = {};
                for (const m of localExternalData.chatworkMessages!) {
                  if (!rooms[m.roomName]) rooms[m.roomName] = [];
                  rooms[m.roomName].push(m);
                }
                const roomEntries = Object.entries(rooms).slice(0, 4);
                return (
                  <View style={s.section}>
                    <View style={s.sectionLabelRow}>
                      <ChatworkIcon size={12} color="rgba(255,255,255,0.42)" />
                      <Text style={s.sectionLabel}>CHATWORK</Text>
                      {(localExternalStats?.chatwork?.messageCount ?? 0) > 0 && (
                        <View style={s.countBadge}>
                          <Text style={s.countBadgeText}>{localExternalStats!.chatwork!.messageCount}</Text>
                        </View>
                      )}
                    </View>
                    <View style={s.listCard}>
                      {roomEntries.map(([roomName, msgs], i) => {
                        const lastMsg = msgs[msgs.length - 1];
                        const hasMention = msgs.some(m => m.isMention);
                        return (
                          <View key={i} style={[s.externalRow, i > 0 && s.rowBorder]}>
                            <View style={s.externalHeader}>
                              <Text style={s.externalRoomName} numberOfLines={1}>{roomName}</Text>
                              <View style={s.externalBadgeRow}>
                                {hasMention && <View style={s.mentionBadge}><Text style={s.mentionText}>@</Text></View>}
                                <Text style={s.externalCount}>{msgs.length}件</Text>
                              </View>
                            </View>
                            <Text style={s.externalPreview} numberOfLines={2}>
                              {lastMsg.accountName}: {lastMsg.body}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })()}

              {/* Notion */}
              {localExternalData?.notionPages && localExternalData.notionPages.length > 0 && (
                <View style={s.section}>
                  <View style={s.sectionLabelRow}>
                    <Ionicons name="document-text-outline" size={12} color="rgba(255,255,255,0.42)" />
                    <Text style={s.sectionLabel}>NOTION</Text>
                  </View>
                  <View style={s.listCard}>
                    {localExternalData.notionPages.slice(0, 4).map((page, i) => (
                      <View key={i} style={[s.emailRow, i > 0 && s.rowBorder]}>
                        <View style={s.emailDot} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.emailFrom} numberOfLines={1}>{page.title}</Text>
                          <Text style={s.emailSubject} numberOfLines={1}>
                            {page.lastEditedBy ? `${page.lastEditedBy} が更新` : new Date(page.lastEdited).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
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
    width: 44, height: 44, borderRadius: 22,
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

  // Stats grid 3×2
  statsGrid:            { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 2 },
  statCell:             { width: '20%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10 },
  statCellDividerRight: { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.18)' },
  statCellNum:          { fontSize: 17, fontWeight: '600', color: '#fff' },

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
  tabRefresh: { marginLeft: 'auto' as any, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tabBody:    { gap: 22, paddingTop: 6 },

  // Section
  section:         { gap: 10 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sectionLabel:    { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.42)', letterSpacing: 0.5 },

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
  schedTime: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.55)', width: 40 },
  schedDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  schedTitle:{ fontSize: 13, fontWeight: '600', color: '#fff' },
  schedLoc:  { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },

  // External tool rows
  externalRow:    { paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  externalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  externalRoomName: { fontSize: 13, fontWeight: '600', color: '#fff', flex: 1 },
  externalCount:    { fontSize: 11, color: 'rgba(255,255,255,0.38)', marginLeft: 8 },
  externalPreview:  { fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 17 },
  externalBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mentionBadge: { backgroundColor: 'rgba(255,100,100,0.25)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  mentionText:  { fontSize: 10, fontWeight: '700', color: '#ff6464' },
  countBadge:   { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 },
  countBadgeText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText:  { fontSize: 14, color: 'rgba(255,255,255,0.3)' },
});
