import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { GradientBackground } from '@components/ui';
import { useUserPreferencesStore } from '@stores/userPreferencesStore';
import { Colors } from '@constants/colors';

// ── Types & Constants ──────────────────────────────────────────────────────────

interface ShowCard {
  id:     string;
  title:  string;
  desc:   string;
  mins:   number;
  type:   'live' | 'deepcast' | 'series';
  colors: [string, string];
  icon:   string;
}

const SHOW_CARDS: ShowCard[] = [
  { id: 's1', title: 'AIニュース最前線',      desc: '生成AI・大規模言語モデルの最新動向',   mins: 8,  type: 'live',     colors: ['#BDD8FF', '#96C0FF'], icon: 'hardware-chip-outline'   },
  { id: 's2', title: 'グローバル経済レポート', desc: '為替・株式・マクロ経済を深掘り',       mins: 14, type: 'deepcast', colors: ['#C8F0E8', '#A8E0D4'], icon: 'trending-up-outline'     },
  { id: 's3', title: '宇宙開発ダイジェスト',  desc: 'SpaceX・JAXAの最新ミッションレポート', mins: 6,  type: 'series',   colors: ['#E4D0FF', '#CEB0F8'], icon: 'planet-outline'          },
  { id: 's4', title: 'テックスタートアップ',  desc: '資金調達・プロダクト・創業者ストーリー', mins: 10, type: 'deepcast', colors: ['#FFE4C8', '#FFD0A0'], icon: 'rocket-outline'          },
  { id: 's5', title: 'サイエンスウィークリー', desc: '医学・物理・生物学の最新研究',         mins: 11, type: 'series',   colors: ['#D0F0D8', '#B0E0BC'], icon: 'flask-outline'           },
  { id: 's6', title: 'デザイン思考',         desc: 'UX・プロダクト・クリエイティブ手法',   mins: 9,  type: 'live',     colors: ['#FFD8E8', '#FFC0D8'], icon: 'color-palette-outline'   },
];

const TYPE_BADGES: Record<ShowCard['type'], { label: string; color: string }> = {
  live:     { label: 'LIVE', color: '#FF6B6B' },
  deepcast: { label: 'DeepCast', color: Colors.brand.primary },
  series:   { label: 'シリーズ', color: '#14B8A6' },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function ShowCardItem({ show }: { show: ShowCard }) {
  const badge = TYPE_BADGES[show.type];
  return (
    <TouchableOpacity
      style={styles.showCard}
      activeOpacity={0.82}
      onPress={() => {}}
    >
      {/* Cover */}
      <LinearGradient colors={show.colors} style={styles.showCover}>
        <View style={styles.showIconWrap}>
          <Ionicons name={show.icon as any} size={26} color="rgba(80,80,120,0.65)" />
        </View>
        {/* Type badge */}
        <View style={[styles.typeBadge, { backgroundColor: badge.color }]}>
          <Text style={styles.typeBadgeText}>{badge.label}</Text>
        </View>
      </LinearGradient>

      {/* Info */}
      <View style={styles.showInfo}>
        <Text style={styles.showTitle} numberOfLines={2}>{show.title}</Text>
        <Text style={styles.showDesc} numberOfLines={2}>{show.desc}</Text>
        <View style={styles.showMeta}>
          <Ionicons name="time-outline" size={11} color={Colors.text.tertiary} />
          <Text style={styles.showMetaText}>{show.mins}分</Text>
        </View>
      </View>

      {/* Play */}
      <TouchableOpacity style={styles.showPlayBtn} activeOpacity={0.8}>
        <Ionicons name="play" size={14} color={Colors.brand.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const { preferences } = useUserPreferencesStore();
  const interests = preferences?.topicsOfInterest ?? [];

  const [filter, setFilter] = useState<'all' | 'live' | 'deepcast' | 'series'>('all');

  const filtered = filter === 'all'
    ? SHOW_CARDS
    : SHOW_CARDS.filter((s) => s.type === filter);

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        <ScrollView showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.pageTitle}>放送</Text>
            <TouchableOpacity style={styles.searchBtn}>
              <Ionicons name="search-outline" size={22} color={Colors.text.primary} />
            </TouchableOpacity>
          </View>

          {/* DeepCast Create Banner */}
          <View style={styles.createBannerShadow}>
            <View style={styles.createBannerClipper}>
              <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
              <LinearGradient
                colors={['rgba(107,140,255,0.18)', 'rgba(168,152,255,0.12)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.createBannerContent}>
                <View style={styles.createBannerLeft}>
                  <Text style={styles.createBannerTitle}>DeepCast を作る</Text>
                  <Text style={styles.createBannerSub}>
                    気になるトピックについて{'\n'}AIがポッドキャストを生成
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.createBannerBtn}
                  onPress={() => router.push('/deepcast')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.createBannerBtnText}>作成</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Filter pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
            contentContainerStyle={styles.filterRow}
          >
            {(['all', 'live', 'deepcast', 'series'] as const).map((f) => {
              const active = filter === f;
              const labels = { all: 'すべて', live: 'ライブ', deepcast: 'DeepCast', series: 'シリーズ' };
              return (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                  onPress={() => setFilter(f)}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {labels[f]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Show cards */}
          <View style={styles.showList}>
            {filtered.map((s) => <ShowCardItem key={s.id} show={s} />)}
          </View>

        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text.primary,
    letterSpacing: -0.5,
  },
  searchBtn: { padding: 4 },

  // Create banner
  createBannerShadow: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 20,
    shadowColor: '#6878A8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 20,
    elevation: 6,
  },
  createBannerClipper: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
  },
  createBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
  },
  createBannerLeft:  { gap: 4 },
  createBannerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text.primary },
  createBannerSub:   { fontSize: 12, color: Colors.text.secondary, lineHeight: 18 },
  createBannerBtn:   {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  createBannerBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Filter
  filterScroll: { marginBottom: 16 },
  filterRow:    { paddingHorizontal: 20, gap: 8, paddingVertical: 2 },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  filterPillActive: { backgroundColor: Colors.brand.primary },
  filterText:       { fontSize: 13, color: Colors.text.secondary, fontWeight: '500' },
  filterTextActive: { color: '#fff', fontWeight: '600' },

  // Show list
  showList: { paddingHorizontal: 20, gap: 12, paddingBottom: 120 },
  showCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    shadowColor: '#6878A8',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  showCover: {
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  showIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff', letterSpacing: 0.3 },
  showInfo:  { flex: 1, gap: 4, paddingVertical: 14 },
  showTitle: { fontSize: 14, fontWeight: '700', color: Colors.text.primary, lineHeight: 20 },
  showDesc:  { fontSize: 12, color: Colors.text.secondary, lineHeight: 17 },
  showMeta:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  showMetaText: { fontSize: 11, color: Colors.text.tertiary, fontWeight: '500' },
  showPlayBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(107,140,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    flexShrink: 0,
  },
});
