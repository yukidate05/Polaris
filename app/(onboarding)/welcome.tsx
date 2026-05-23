import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientBackground, PolarisOrb, Button } from '@components/ui';
import { Colors } from '@constants/colors';

const { height } = Dimensions.get('window');

export default function WelcomeScreen() {
  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          {/* Top badge */}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>01</Text>
          </View>

          {/* Orb + hero text */}
          <View style={styles.hero}>
            <PolarisOrb size={96} />
            <Text style={styles.title}>{'声で、\n今日を整える。'}</Text>
            <Text style={styles.subtitle}>あなたの北極星</Text>
            <View style={styles.divider} />
            <Text style={styles.description}>
              {'AIがあなたに合わせて、\nその日の予定やニュースをまとめて\n毎朝優しくお届けします。'}
            </Text>
          </View>

          {/* Bottom branding + CTA */}
          <View style={styles.bottom}>
            <Text style={styles.brandName}>Polaris</Text>
            <Text style={styles.tagline}>Everything. In One Flow.</Text>

            <View style={styles.actions}>
              <Button
                label="はじめる"
                onPress={() => router.push('/(onboarding)/features')}
              />
              <Button
                label="すでにアカウントをお持ちの方"
                variant="ghost"
                onPress={() => router.push('/(auth)/login')}
                style={styles.loginLink}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingVertical: 16,
    justifyContent: 'space-between',
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  badgeText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text.primary,
  },
  hero: {
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 8,
  },
  title: {
    fontSize: 38,
    fontWeight: '800',
    color: Colors.text.primary,
    lineHeight: 48,
    letterSpacing: -0.5,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.text.brand,
  },
  divider: {
    width: 32,
    height: 2,
    backgroundColor: Colors.brand.primary,
    borderRadius: 1,
    marginVertical: 4,
  },
  description: {
    fontSize: 15,
    color: Colors.text.secondary,
    lineHeight: 24,
  },
  bottom: {
    gap: 4,
    paddingBottom: 8,
  },
  brandName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.brand.primary,
  },
  tagline: {
    fontSize: 13,
    color: Colors.text.tertiary,
    marginBottom: 20,
  },
  actions: {
    gap: 12,
  },
  loginLink: {
    alignSelf: 'center',
    marginTop: 4,
  },
});
