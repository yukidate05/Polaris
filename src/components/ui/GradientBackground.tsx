import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface GradientBackgroundProps {
  children: React.ReactNode;
  variant?: 'default' | 'player' | 'splash';
}

export function GradientBackground({ children }: GradientBackgroundProps) {
  return (
    <View style={styles.container}>
      {/* Base: white → barely-tinted lavender */}
      <LinearGradient
        colors={['#FFFFFF', '#F8F9FF', '#F2F4FF']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Cyan ambient blob — upper right */}
      <View style={styles.blobCyan} />

      {/* Lavender ambient blob — lower left */}
      <View style={styles.blobLavender} />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  blobCyan: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: 'rgba(137,216,247,0.11)',
    top: -100,
    right: -80,
  },
  blobLavender: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(168,152,255,0.09)',
    bottom: 20,
    left: -100,
  },
});
