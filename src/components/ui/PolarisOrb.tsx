import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

interface PolarisOrbProps {
  size?: number;
  animate?: boolean;
}

// Simulated radial gradient via concentric glow rings
// Each ring fades opacity outward → creates soft bloom without CSS blur
const GLOW = [
  { scale: 3.8, color: 'rgba(168,152,255,0.04)' }, // outermost lavender
  { scale: 3.2, color: 'rgba(107,140,255,0.06)' }, // blue
  { scale: 2.6, color: 'rgba(100,210,248,0.09)' }, // cyan
  { scale: 2.1, color: 'rgba(120,218,247,0.13)' }, // cyan brighter
  { scale: 1.7, color: 'rgba(107,140,255,0.17)' }, // blue-purple close
  { scale: 1.35, color: 'rgba(168,152,255,0.14)' },// lavender inner
];

export function PolarisOrb({ size = 120, animate = false }: PolarisOrbProps) {
  const floatY     = useRef(new Animated.Value(0)).current;
  const glowScale  = useRef(new Animated.Value(1)).current;
  const r = size / 2;

  useEffect(() => {
    if (!animate) return;

    Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -10, duration: 3200, useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0,   duration: 3200, useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowScale, { toValue: 1.08, duration: 3200, useNativeDriver: true }),
        Animated.timing(glowScale, { toValue: 0.94, duration: 3200, useNativeDriver: true }),
      ])
    ).start();
  }, [animate]);

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { width: size, height: size },
        { transform: [{ translateY: floatY }] },
      ]}
    >
      {/* ── Glow layers (overflow parent bounds) ── */}
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: glowScale }],
        }}
      >
        {GLOW.map((g, i) => {
          const s = size * g.scale;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                width: s,
                height: s,
                borderRadius: s / 2,
                backgroundColor: g.color,
              }}
            />
          );
        })}
      </Animated.View>

      {/* ── Orb sphere ── */}
      <View
        style={[
          styles.orb,
          {
            width: size,
            height: size,
            borderRadius: r,
            shadowRadius: size * 0.4,
          },
        ]}
      >
        {/* Base teal-blue */}
        <LinearGradient
          colors={['#8CE8F0', '#60B8F0', '#6B8CFF', '#9B8FE8']}
          start={{ x: 0.15, y: 0.05 }}
          end={{ x: 0.85, y: 0.95 }}
          style={[StyleSheet.absoluteFill, { borderRadius: r }]}
        />

        {/* Radial-ish bright center: white bloom from upper-left */}
        <LinearGradient
          colors={['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']}
          start={{ x: 0.18, y: 0.08 }}
          end={{ x: 0.75, y: 0.80 }}
          style={[StyleSheet.absoluteFill, { borderRadius: r }]}
        />

        {/* Edge rim */}
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: r, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)' },
          ]}
        />

        {/* 4-point sparkle */}
        <Ionicons
          name="sparkles"
          size={size * 0.42}
          color="rgba(255,255,255,0.96)"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#89D8F7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.80,
    elevation: 12,
  },
});
