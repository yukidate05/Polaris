import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientBackground, TopicTag, Button } from '@components/ui';
import { useUserPreferencesStore } from '@stores/userPreferencesStore';
import { Colors } from '@constants/colors';

const TOPICS = [
  { id: 'ai_tech',   label: 'AI・テクノロジー' },
  { id: 'business',  label: 'ビジネス' },
  { id: 'market',    label: '経済・マーケット' },
  { id: 'startup',   label: 'スタートアップ' },
  { id: 'health',    label: 'ヘルスケア' },
  { id: 'finance',   label: '金融・投資' },
  { id: 'world',     label: '国際情勢' },
  { id: 'design',    label: 'デザイン' },
  { id: 'science',   label: 'サイエンス' },
  { id: 'career',    label: 'キャリア' },
  { id: 'lifestyle', label: 'ライフスタイル' },
  { id: 'sports',    label: 'スポーツ' },
] as const;

export default function InterestsScreen() {
  const { setPreferences } = useUserPreferencesStore();
  const [selected, setSelected] = useState<string[]>(['ai_tech', 'business', 'market']);

  function toggleTopic(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  function handleContinue() {
    setPreferences({ topicsOfInterest: selected });
    router.push('/(auth)/login');
  }

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeText}>03</Text>
          </View>

          <Text style={styles.title}>{'興味のある\nトピックを選んでください。'}</Text>
          <Text style={styles.subtitle}>
            パーソナライズされたブリーフィングのために使用します。後から変更できます。
          </Text>

          <View style={styles.tags}>
            {TOPICS.map((t) => (
              <TopicTag
                key={t.id}
                label={t.label}
                selected={selected.includes(t.id)}
                onPress={() => toggleTopic(t.id)}
              />
            ))}
          </View>

          <Text style={styles.selectedCount}>
            {selected.length}件選択中
          </Text>

          <View style={styles.actions}>
            <Button
              label="次へ"
              onPress={handleContinue}
              disabled={selected.length === 0}
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
    paddingBottom: 40,
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
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  selectedCount: {
    fontSize: 13,
    color: 'rgba(160,255,220,0.95)',
    fontWeight: '500',
  },
  actions: { gap: 8 },
});
