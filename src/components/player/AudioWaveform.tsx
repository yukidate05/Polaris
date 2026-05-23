import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';

const BAR_COUNT = 32;
const HEIGHTS = [
  2, 4, 7, 11, 15, 20, 17, 13, 9, 6, 4, 7, 12, 18,
  24, 20, 15, 10, 6, 4, 7, 11, 16, 21, 18, 14, 9, 5, 3, 6, 10, 4,
];

interface AudioWaveformProps {
  progress?: number;
  color?: string;
  height?: number;
  breathe?: boolean;
}

export function AudioWaveform({
  progress = 0,
  color = '#6B8CFF',
  height = 28,
  breathe = false,
}: AudioWaveformProps) {
  const breathAnim = useRef(new Animated.Value(1)).current;
  const playedIndex = Math.floor(progress * BAR_COUNT);

  useEffect(() => {
    if (!breathe) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, { toValue: 1.25, duration: 1800, useNativeDriver: true }),
        Animated.timing(breathAnim, { toValue: 0.78, duration: 1800, useNativeDriver: true }),
        Animated.timing(breathAnim, { toValue: 1,    duration: 900,  useNativeDriver: true }),
      ])
    ).start();
  }, [breathe]);

  return (
    <View style={[styles.container, { height }]}>
      {HEIGHTS.map((barH, i) => {
        const isPlayed = i <= playedIndex;
        const normalised = (barH / 24) * height;
        const bgColor = isPlayed ? color : 'rgba(107,140,255,0.20)';

        return breathe ? (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              { height: normalised, backgroundColor: bgColor, transform: [{ scaleY: breathAnim }] },
            ]}
          />
        ) : (
          <View key={i} style={[styles.bar, { height: normalised, backgroundColor: bgColor }]} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { width: 2.5, borderRadius: 2 },
});
