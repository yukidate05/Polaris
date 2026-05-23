import { View, ViewStyle, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

// ── FrostCard — Apple-style frosted glass ──────────────────────────────────────
// Two-view pattern:
//   outer (shadow layer)  — shadow props + sizing/position via `style`
//   inner (clip layer)    — overflow:hidden clips blur to rounded corners
// Content layout goes in `contentStyle` (flexDirection, gap, alignItems etc.)
// This separates sizing concerns from layout concerns cleanly.

interface FrostCardProps {
  children: React.ReactNode;
  /** Outer wrapper: flex, width, height, margin, alignSelf */
  style?: ViewStyle;
  /** Inner content layout: flexDirection, gap, alignItems, padding overrides */
  contentStyle?: ViewStyle;
  padding?: number;
  intensity?: number;
  radius?: number;
}

export function FrostCard({
  children,
  style,
  contentStyle,
  padding = 18,
  intensity = 75,
  radius = 20,
}: FrostCardProps) {
  return (
    <View style={[styles.shadow, { borderRadius: radius }, style]}>
      <View style={[styles.clipper, { borderRadius: radius }]}>
        {/* Backdrop blur — blurs the gradient/blobs showing through */}
        <BlurView intensity={intensity} tint="light" style={StyleSheet.absoluteFill} />
        {/* White tint — the frosted white sheen */}
        <View style={styles.tint} pointerEvents="none" />
        {/* Content */}
        <View style={[{ padding }, contentStyle]}>
          {children}
        </View>
      </View>
    </View>
  );
}

// ── GlassCard — backwards-compatible wrapper ───────────────────────────────────
interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
  dark?: boolean;
}

export function GlassCard({ children, style, padding = 18 }: GlassCardProps) {
  return (
    <FrostCard style={style} padding={padding}>
      {children}
    </FrostCard>
  );
}

const styles = StyleSheet.create({
  shadow: {
    // Shadow lives on the outer view — NOT clipped by overflow:hidden below
    shadowColor: '#6878A8',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.11,
    shadowRadius: 20,
    elevation: 5,
  },
  clipper: {
    // Clips blur + children to border radius
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
});

// ── ViewStyle tokens for legacy/inline usage ───────────────────────────────────
export const card: ViewStyle = {
  shadowColor: '#6878A8',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.11,
  shadowRadius: 20,
  elevation: 5,
  borderRadius: 20,
};

export const darkGlass: ViewStyle = card;
export const lightGlass: ViewStyle = card;
export const glass: ViewStyle    = card;
