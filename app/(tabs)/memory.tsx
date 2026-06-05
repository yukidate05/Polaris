import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GradientBackground, GlassCard } from '@components/ui';
import { Colors } from '@constants/colors';
import { Episode } from '@models/index';

const MOCK_SAVED: Episode[] = [
  {
    id: 'ep_s01', userId: '', type: 'daily_brief',
    title: '5月20日のブリーフィング', summary: '今日の予定、ビジネスニュース、天気をお届けしました。',
    audioUrl: null, durationSec: 8 * 60 + 45, status: 'ready',
    chapters: [], topics: ['business'], thumbnailUrl: null,
    createdAt: new Date(Date.now() - 86400000),
  },
  {
    id: 'ep_s02', userId: '', type: 'deepcast',
    title: '生成AIの企業活用トレンド', summary: '大手企業のAI導入事例と今後の展望を解説。',
    audioUrl: null, durationSec: 15 * 60, status: 'ready',
    chapters: [], topics: ['ai_tech'], thumbnailUrl: null,
    createdAt: new Date(Date.now() - 2 * 86400000),
  },
];

interface SavedItemProps {
  episode: Episode;
  onPress: () => void;
}

function SavedItem({ episode, onPress }: SavedItemProps) {
  const durationMin = Math.round(episode.durationSec / 60);
  const dateStr = episode.createdAt.toLocaleDateString('ja-JP', {
    month: 'long', day: 'numeric',
  });

  return (
    <GlassCard>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.itemInner}>
        <View style={styles.itemLeft}>
          <Text style={styles.itemDate}>{dateStr}</Text>
          <Text style={styles.itemTitle} numberOfLines={2}>{episode.title}</Text>
          <Text style={styles.itemSummary} numberOfLines={2}>{episode.summary}</Text>
          <View style={styles.itemMeta}>
            <Ionicons name="time-outline" size={12} color={Colors.text.tertiary} />
            <Text style={styles.itemMetaText}>{durationMin}分</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.playBtn}>
          <Ionicons name="play-circle" size={36} color={Colors.brand.primary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </GlassCard>
  );
}

export default function MemoryScreen() {
  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>メモリー</Text>
        </View>
        <Text style={styles.headerSubtitle}>保存したエピソードと過去のブリーフィング</Text>

        {MOCK_SAVED.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={48} color={Colors.text.tertiary} />
            <Text style={styles.emptyText}>保存したエピソードがありません</Text>
            <Text style={styles.emptySubtext}>ブリーフィングを聴いて保存してみましょう</Text>
          </View>
        ) : (
          <FlatList
            data={MOCK_SAVED}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <SavedItem episode={item} onPress={() => router.push('/player')} />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.60)',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  list: {
    paddingHorizontal: 18,
    paddingBottom: 100,
    gap: 12,
  },
  itemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemLeft: { flex: 1, gap: 5 },
  itemDate: {
    fontSize: 11,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text.primary,
  },
  itemSummary: {
    fontSize: 12,
    color: Colors.text.secondary,
    lineHeight: 18,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemMetaText: {
    fontSize: 11,
    color: Colors.text.tertiary,
  },
  playBtn: {},
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 100,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text.secondary,
  },
  emptySubtext: {
    fontSize: 13,
    color: Colors.text.tertiary,
  },
});
