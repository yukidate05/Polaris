import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FrostCard } from '@components/ui/GlassCard';
import { AudioWaveform } from '@components/player/AudioWaveform';
import { usePlayerStore } from '@stores/playerStore';
import { Colors } from '@constants/colors';

interface BriefingPlayerCardProps {
  onPress: () => void;
}

export function BriefingPlayerCard({ onPress }: BriefingPlayerCardProps) {
  const { status, positionMs, durationMs } = usePlayerStore();
  const isPlaying = status === 'playing';
  const progress  = durationMs > 0 ? positionMs / durationMs : 0;

  const remaining = durationMs > 0
    ? (() => {
        const s = Math.floor((durationMs - positionMs) / 1000);
        return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
      })()
    : '8:45';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88}>
      <FrostCard
        padding={0}
        contentStyle={styles.row}
      >
        <View style={styles.playButton}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={20}
            color={Colors.brand.primary}
            style={isPlaying ? undefined : { marginLeft: 2 }}
          />
        </View>

        <View style={styles.center}>
          <Text style={styles.label}>ブリーフィングを再生</Text>
          <AudioWaveform progress={progress} height={24} breathe={isPlaying} />
        </View>

        <Text style={styles.time}>{remaining}</Text>
      </FrostCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  playButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(107,140,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(107,140,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, gap: 8 },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text.primary,
    letterSpacing: 0.1,
  },
  time: {
    fontSize: 13,
    color: Colors.text.tertiary,
    fontWeight: '400',
  },
});
