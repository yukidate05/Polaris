import { View, ViewStyle, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

// ── DarkGlassCard — Huxe-style dark frosted glass ─────────────────────────────
// Aurora background shows through via dark blur, with subtle white border
// Two-view pattern: outer (shadow) + inner (overflow:hidden for border-radius clip)

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  padding?: number;
  intensity?: number;
  radius?: number;
}

export function GlassCard({
  children,
  style,
  contentStyle,
  padding = 18,
  intensity = 50,
  radius = 20,
}: GlassCardProps) {
  return (
    <View style={[styles.shadow, { borderRadius: radius }, style]}>
      <View style={[styles.clipper, { borderRadius: radius }]}>
        <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.tint} pointerEvents="none" />
        <View style={[{ padding }, contentStyle]}>
          {children}
        </View>
      </View>
    </View>
  );
}

// Alias kept for compatibility
export const FrostCard = GlassCard;

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 0,
  },
  clipper: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
});

// ── Style tokens ───────────────────────────────────────────────────────────────
export const card: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.22,
  shadowRadius: 16,
  elevation: 3,
  borderRadius: 20,
};

export const darkGlass: ViewStyle = card;
export const lightGlass: ViewStyle = card;
export const glass: ViewStyle = card;
