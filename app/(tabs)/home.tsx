import { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Animated, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { GradientBackground, PolarisOrb } from '@components/ui';
import { useAuthStore } from '@stores/authStore';
import { useBriefingStore, type BriefingStatus } from '@stores/briefingStore';
import { googleDataService, MOCK_GOOGLE_DATA } from '@services/googleDataService';
import { briefingService } from '@services/briefingService';
import { Colors } from '@constants/colors';
import Constants from 'expo-constants';

const isExpoGo = Constants.appOwnership === 'expo';

// ── Types ──────────────────────────────────────────────────────────────────────

interface KeepListeningItem {
  id:    string;
  title: string;
  mins:  number;
  colors:[string, string];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KEEP_ITEMS: KeepListeningItem[] = [
  { id: '1', title: 'AIニュースまとめ',      mins: 8,  colors: ['#C5D8FF', '#A8C4FA'] },
  { id: '2', title: 'マーケットトレンド',    mins: 12, colors: ['#D4E8D4', '#B8DDB8'] },
  { id: '3', title: 'サイエンスアップデート', mins: 6,  colors: ['#E8D4F0', '#DBBFE6'] },
  { id: '4', title: 'デザインインサイト',    mins: 9,  colors: ['#FFE8CC', '#FAD4A8'] },
];

const STATUS_LABELS: Record<BriefingStatus, string> = {
  idle:              '準備完了',
  fetching:          '情報を取得中...',
  generating_script: 'AIが執筆中...',
  generating_audio:  '音声を生成中...',
  ready:             '再生できます',
  error:             'エラーが発生しました',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScheduleItem({ ev }: { ev: { title: string; startTime: string; location?: string; iconName?: string } }) {
  return (
    <View style={styles.scheduleRow}>
      <Text style={styles.scheduleTime}>{ev.startTime}</Text>
      <View style={styles.scheduleDot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.scheduleTitle} numberOfLines={1}>{ev.title}</Text>
        {ev.location && (
          <Text style={styles.scheduleLoc} numberOfLines={1}>{ev.location}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={14} color={Colors.text.tertiary} />
    </View>
  );
}

function KeepCard({ item }: { item: KeepListeningItem }) {
  return (
    <TouchableOpacity style={styles.keepCard} activeOpacity={0.85}>
      <LinearGradient colors={item.colors} style={styles.keepCover}>
        <View style={styles.keepPlayBtn}>
          <Ionicons name="play" size={16} color="#fff" />
        </View>
      </LinearGradient>
      <Text style={styles.keepTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.keepDuration}>{item.mins}分</Text>
    </TouchableOpacity>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { user, profile, googleAccessToken } = useAuthStore();
  const {
    status, googleData, script, hasPlayed,
    setStatus, setGoogleData, setScript, setError, setHasPlayed,
  } = useBriefingStore();

  const firstName = profile?.displayName?.split(' ')[0]
    ?? user?.displayName?.split(' ')[0]
    ?? 'ゲスト';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'おはようございます' : hour < 17 ? 'こんにちは' : 'こんばんは';
  const dateStr = (() => {
    const d = new Date();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
  })();

  const isGenerating = status === 'fetching' || status === 'generating_script' || status === 'generating_audio';

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

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
      const script = await briefingService.generate(data, firstName, [], hasPlayed, user?.uid ?? undefined);
      setScript(script);
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    }
  }, [isGenerating, googleData, googleAccessToken, firstName, hasPlayed]);

  // Auto-generate on first load
  useEffect(() => {
    if (status === 'idle') {
      generateBriefing();
    }
  }, []);

  const handlePlay = () => {
    if (script) {
      setHasPlayed(true);
      router.push('/player');
    }
  };

  const unread      = googleData?.unreadCount  ?? 0;
  const todayCount  = googleData?.todayEvents?.length ?? 0;
  const todayEvents = googleData?.todayEvents  ?? [];
  const tomorrow    = googleData?.tomorrowEvents ?? [];

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appTitle}>Polaris</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/settings')} style={styles.avatarBtn}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{firstName.charAt(0).toUpperCase()}</Text>
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

            {/* ── Hero Brief Card ── */}
            <View style={styles.heroShadow}>
              <View style={styles.heroClipper}>
                <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
                <View style={styles.heroTint} pointerEvents="none" />

                {/* Card content */}
                <View style={styles.heroInner}>
                  {/* Left column */}
                  <View style={styles.heroLeft}>
                    {/* Badge */}
                    <View style={styles.badge}>
                      <Ionicons name="sparkles" size={10} color={Colors.brand.primary} />
                      <Text style={styles.badgeText}>今日のブリーフィング</Text>
                    </View>

                    {/* Greeting */}
                    <Text style={styles.heroGreeting}>
                      {greeting}、{'\n'}{firstName}さん
                    </Text>
                    <Text style={styles.heroSub}>
                      {status === 'ready'
                        ? 'ブリーフィングの準備ができました。'
                        : STATUS_LABELS[status]}
                    </Text>

                    {/* Play button */}
                    <TouchableOpacity
                      style={[styles.playPill, (!script || isGenerating) && styles.playPillDisabled]}
                      onPress={handlePlay}
                      disabled={!script || isGenerating}
                      activeOpacity={0.8}
                    >
                      {isGenerating
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Ionicons name="play" size={14} color="#fff" />
                      }
                      <Text style={styles.playPillText}>
                        {isGenerating ? '生成中...' : '再生する'}
                      </Text>
                    </TouchableOpacity>

                    {/* Duration */}
                    {script && (
                      <Text style={styles.heroDuration}>
                        約{Math.round(script.estimatedSeconds / 60)}分
                        {script.audioUri ? '　AI Voice' : '　音声合成'}
                      </Text>
                    )}
                  </View>

                  {/* Orb (right) */}
                  <View style={styles.heroOrb}>
                    <PolarisOrb size={100} animate={isGenerating} />
                  </View>
                </View>
              </View>
            </View>

            {/* ── Stats row ── */}
            <View style={styles.statsRow}>
              <StatChip
                icon="mail-outline"
                label="今日のメール"
                value={`${unread}件`}
              />
              <StatChip
                icon="calendar-outline"
                label="今日の予定"
                value={`${todayCount}件`}
              />
            </View>

            {/* ── Keep listening ── */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Keep listening</Text>
                <TouchableOpacity>
                  <Text style={styles.seeAll}>すべて見る</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.keepRow}>
                  {KEEP_ITEMS.map((item) => (
                    <KeepCard key={item.id} item={item} />
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* ── Tomorrow's schedule ── */}
            {tomorrow.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>明日の予定</Text>
                  <TouchableOpacity>
                    <Text style={styles.seeAll}>すべて見る</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.scheduleCard}>
                  <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />
                  <View style={styles.scheduleCardTint} pointerEvents="none" />
                  <View style={styles.scheduleCardContent}>
                    {tomorrow.slice(0, 4).map((ev, i) => (
                      <ScheduleItem key={i} ev={ev} />
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* Today's schedule when no tomorrow */}
            {tomorrow.length === 0 && todayEvents.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>今日の予定</Text>
                  <TouchableOpacity>
                    <Text style={styles.seeAll}>すべて見る</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.scheduleCard}>
                  <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />
                  <View style={styles.scheduleCardTint} pointerEvents="none" />
                  <View style={styles.scheduleCardContent}>
                    {todayEvents.slice(0, 4).map((ev, i) => (
                      <ScheduleItem key={i} ev={ev} />
                    ))}
                  </View>
                </View>
              </View>
            )}

          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

// ── Stat Chip ─────────────────────────────────────────────────────────────────

function StatChip({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.statShadow}>
      <View style={styles.statClipper}>
        <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.statTint} pointerEvents="none" />
        <View style={styles.statInner}>
          <Ionicons name={icon} size={18} color={Colors.brand.primary} />
          <View>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 110, gap: 16 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text.primary,
    letterSpacing: -0.5,
  },
  avatarBtn: { padding: 2 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Hero card
  heroShadow: {
    borderRadius: 24,
    shadowColor: '#6878A8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  heroClipper: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    minHeight: 200,
  },
  heroTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(235,242,255,0.55)',
  },
  heroInner: {
    flexDirection: 'row',
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  heroLeft: { flex: 1, gap: 10 },
  heroOrb:  { width: 110, alignItems: 'center', justifyContent: 'center' },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(107,140,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.brand.primary,
  },

  heroGreeting: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text.primary,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  heroSub: {
    fontSize: 13,
    color: Colors.text.secondary,
    lineHeight: 18,
  },

  playPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  playPillDisabled: { opacity: 0.55 },
  playPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  heroDuration: {
    fontSize: 11,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },

  // Stats
  statsRow: { flexDirection: 'row', gap: 12 },
  statShadow: {
    flex: 1,
    borderRadius: 16,
    shadowColor: '#6878A8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  statClipper: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
  },
  statTint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.35)' },
  statInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text.primary,
  },

  // Sections
  section: { gap: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text.primary,
    letterSpacing: -0.2,
  },
  seeAll: {
    fontSize: 13,
    color: Colors.brand.primary,
    fontWeight: '500',
  },

  // Keep listening
  keepRow: { flexDirection: 'row', gap: 12, paddingBottom: 4 },
  keepCard: { width: 130, gap: 8 },
  keepCover: {
    width: 130,
    height: 100,
    borderRadius: 16,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    padding: 10,
  },
  keepPlayBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text.primary,
    lineHeight: 17,
  },
  keepDuration: {
    fontSize: 11,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },

  // Schedule card (two-layer: outer shadow, inner overflow:hidden for blur clip)
  scheduleCard: {
    borderRadius: 18,
    overflow: 'hidden',  // clips BlurView to border radius (no shadow on this view)
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
  },
  scheduleCardTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.40)',
  },
  scheduleCardContent: { padding: 16, gap: 14 },

  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scheduleTime: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text.tertiary,
    width: 40,
  },
  scheduleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.brand.primary,
  },
  scheduleTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text.primary,
  },
  scheduleLoc: {
    fontSize: 11,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
});
