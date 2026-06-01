import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GradientBackground, GlassCard, Button } from '@components/ui';
import { Colors } from '@constants/colors';

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
  {
    icon: 'chatbubble-ellipses-outline' as const,
    title: '再生中に質問できる',
    description: 'ブリーフィングを聴きながら、その場でAIに深掘りできる。',
  },
] as const;

export default function FeaturesScreen() {
  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeText}>02</Text>
          </View>

          <Text style={styles.title}>{'煩雑な情報を、\nポッドキャスト感覚で。'}</Text>
          <Text style={styles.subtitle}>
            {'メールやカレンダー、チャット、ドキュメントまで。\nさまざまな情報源をつなぎ、AIがまとめて\nあなたの1日を音声でお届けします。'}
          </Text>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <GlassCard key={f.title} style={styles.featureCard}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon} size={22} color={Colors.brand.primary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDescription}>{f.description}</Text>
                </View>
              </GlassCard>
            ))}
          </View>

          <View style={styles.actions}>
            <Button
              label="次へ"
              onPress={() => router.push('/(onboarding)/interests')}
            />
            <Button
              label="戻る"
              variant="ghost"
              onPress={() => router.back()}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    gap: 16,
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
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 40,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 22,
  },
  features: { gap: 12 },
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
  featureDescription: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.68)',
    lineHeight: 20,
  },
  actions: { gap: 8, marginTop: 8 },
});
