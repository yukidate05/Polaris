import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GradientBackground, PolarisOrb, GlassCard, Button } from '@components/ui';
import { Colors } from '@constants/colors';
import { useT } from '@/i18n';

const FEATURES = [
  {
    icon: 'mic-outline' as const,
    title: '毎朝の音声ブリーフィング',
    description: 'カレンダー・メール・ニュースをAIがまとめ、音声でお届け。',
  },
  {
    icon: 'radio-outline' as const,
    title: 'パーソナライズされたラジオ',
    description: 'あなたの興味に合わせたニュースや業界動向を、ポッドキャスト感覚で。',
  },
  {
    icon: 'link-outline' as const,
    title: '多様なサービス連携',
    description: 'Gmail・カレンダー・Notion・Slackなどを一つに集約。',
  },
] as const;

export default function WelcomeScreen() {
  const [page, setPage] = useState(0);
  const t = useT();

  const features = [
    { icon: 'mic-outline' as const,  title: t('feature1_title'), description: t('feature1_desc') },
    { icon: 'radio-outline' as const, title: t('feature2_title'), description: t('feature2_desc') },
    { icon: 'link-outline' as const,  title: t('feature3_title'), description: t('feature3_desc') },
  ];

  if (page === 0) {
    return (
      <GradientBackground>
        <SafeAreaView style={styles.safe}>
          <View style={styles.container}>
            <View style={styles.hero}>
              <PolarisOrb size={96} />
              <Text style={styles.welcomeTitle}>{t('welcome_title')}</Text>
              <Text style={styles.welcomeSubtitle}>{t('welcome_subtitle')}</Text>
              <View style={styles.divider} />
              <Text style={styles.welcomeDesc}>{t('welcome_desc')}</Text>
            </View>
            <View style={styles.bottom}>
              <Text style={styles.brandName}>Polaris</Text>
              <Text style={styles.tagline}>Everything. In One Flow.</Text>
              <View style={styles.actions}>
                <Button label={t('get_started')} onPress={() => setPage(1)} />
                <Button
                  label={t('already_have_account')}
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

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.featuresTitle}>{t('features_title')}</Text>
          <Text style={styles.featuresSubtitle}>{t('features_subtitle')}</Text>
          <View style={styles.featuresList}>
            {features.map((f) => (
              <GlassCard key={f.title} style={styles.featureCard}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon} size={22} color={Colors.brand.primary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.description}</Text>
                </View>
              </GlassCard>
            ))}
          </View>
          <View style={styles.actions}>
            <Button label={t('next')} onPress={() => router.push('/(auth)/login')} />
            <Button label={t('back')} variant="ghost" onPress={() => setPage(0)} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Page 1
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingVertical: 16,
    justifyContent: 'space-between',
  },
  hero: {
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 100,
  },
  welcomeTitle: {
    fontSize: 38,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 48,
    letterSpacing: -0.5,
    marginTop: 8,
  },
  welcomeSubtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: 'rgba(160,255,220,0.95)',
  },
  divider: {
    width: 32,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderRadius: 1,
    marginVertical: 4,
  },
  welcomeDesc: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 24,
  },
  bottom: {
    gap: 4,
    paddingBottom: 8,
  },
  brandName: {
    fontSize: 22,
    fontWeight: '700',
    color: 'rgba(160,255,220,0.95)',
  },
  tagline: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.50)',
    marginBottom: 20,
  },

  // Page 2
  scroll: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    gap: 16,
  },
  featuresTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 40,
    letterSpacing: -0.3,
  },
  featuresSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 22,
  },
  featuresList: { gap: 12 },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 16,
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(20,184,166,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { flex: 1 },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.68)',
    lineHeight: 20,
  },

  // Shared
  actions:   { gap: 12 },
  loginLink: { alignSelf: 'center', marginTop: 4 },
});
