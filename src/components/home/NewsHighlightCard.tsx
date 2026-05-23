import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { FrostCard } from '@components/ui/GlassCard';
import { Colors } from '@constants/colors';
import { Episode } from '@models/index';

interface NewsHighlightCardProps {
  episode: Episode;
  onPress: () => void;
}

export function NewsHighlightCard({ episode, onPress }: NewsHighlightCardProps) {
  const durationMin = Math.round(episode.durationSec / 60);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88}>
      <FrostCard padding={0} contentStyle={styles.row}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Ionicons name="radio-outline" size={12} color={Colors.brand.primary} />
            <Text style={styles.headerLabel}>今日のハイライト</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>{episode.title}</Text>
          <Text style={styles.summary} numberOfLines={2}>{episode.summary}</Text>
          <Text style={styles.meta}>{durationMin}分・今日のエピソード</Text>
        </View>

        <View style={styles.imageWrapper}>
          {episode.thumbnailUrl ? (
            <Image source={{ uri: episode.thumbnailUrl }} style={styles.image} resizeMode="cover" />
          ) : (
            <LinearGradient colors={['#C8E6FA', '#A8C8F8']} style={styles.image} />
          )}
          <View style={styles.playOverlay}>
            <Ionicons name="play" size={12} color="white" style={{ marginLeft: 1 }} />
          </View>
        </View>
      </FrostCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: 18,
    gap: 14,
  },
  content: { flex: 1, gap: 5 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  headerLabel: {
    fontSize: 11,
    color: Colors.brand.primary,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text.primary,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  summary: {
    fontSize: 12,
    color: Colors.text.secondary,
    lineHeight: 17,
  },
  meta: {
    fontSize: 11,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  imageWrapper: {
    width: 88,
    height: 88,
    borderRadius: 16,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  playOverlay: {
    position: 'absolute',
    bottom: 7,
    right: 7,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
