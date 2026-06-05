import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GradientBackground, PolarisOrb } from '@components/ui';
import { useBriefingStore } from '@stores/briefingStore';
import { briefingService } from '@services/briefingService';
import { Colors } from '@constants/colors';

const TOPICS = [
  'AI最新トレンド',
  '日本のスタートアップ',
  'グローバル経済',
  '宇宙開発',
  '気候変動',
  '量子コンピュータ',
  '次世代モビリティ',
  'バイオテクノロジー',
];

export default function DeepcastScreen() {
  const [topic,      setTopic]     = useState('');
  const [isLoading,  setIsLoading] = useState(false);
  const [error,      setError]     = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const { setScript, setError: storeSetError } = useBriefingStore();

  async function handleGenerate(t = topic) {
    if (!t.trim() || isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      const script = await briefingService.generateDeepcast(t.trim());
      setScript(script);
      router.replace('/player');
    } catch (e: any) {
      setError('生成に失敗しました。もう一度お試しください。');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Nav */}
          <View style={styles.nav}>
            <TouchableOpacity onPress={() => router.back()} style={styles.navBtn}>
              <Ionicons name="chevron-down" size={24} color={Colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.navTitle}>DeepCast</Text>
            <View style={styles.navBtn} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Orb */}
            <View style={styles.orbWrap}>
              <PolarisOrb size={110} animate={isLoading} />
            </View>

            {/* Title */}
            <View style={styles.titleArea}>
              <Text style={styles.title}>DeepCast を作る</Text>
              <Text style={styles.subtitle}>
                任意のトピックについて、AIがパーソナルポッドキャストを生成します
              </Text>
            </View>

            {/* Input card */}
            <View style={styles.inputShadow}>
              <View style={styles.inputClipper}>
                <BlurView intensity={65} tint="light" style={StyleSheet.absoluteFill} />
                <View style={styles.inputTint} pointerEvents="none" />
                <View style={styles.inputWrap}>
                  <Ionicons name="search-outline" size={18} color={Colors.text.darkTertiary} />
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    placeholder="何について知りたいですか？"
                    placeholderTextColor={Colors.text.darkTertiary}
                    value={topic}
                    onChangeText={setTopic}
                    onSubmitEditing={() => handleGenerate()}
                    returnKeyType="go"
                    editable={!isLoading}
                    multiline={false}
                  />
                  {topic.length > 0 && (
                    <TouchableOpacity onPress={() => setTopic('')}>
                      <Ionicons name="close-circle" size={18} color={Colors.text.darkTertiary} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            {/* Error */}
            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            {/* Generate button */}
            <TouchableOpacity
              style={[styles.generateBtn, (!topic.trim() || isLoading) && styles.generateBtnDisabled]}
              onPress={() => handleGenerate()}
              disabled={!topic.trim() || isLoading}
              activeOpacity={0.85}
            >
              {isLoading
                ? <ActivityIndicator color="#fff" />
                : <Ionicons name="sparkles" size={18} color="#fff" />
              }
              <Text style={styles.generateBtnText}>
                {isLoading ? '生成中...' : 'DeepCast を生成'}
              </Text>
            </TouchableOpacity>

            {/* Topic suggestions */}
            {!isLoading && (
              <View style={styles.suggestions}>
                <Text style={styles.suggestLabel}>おすすめトピック</Text>
                <View style={styles.tagRow}>
                  {TOPICS.map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.tag, topic === t && styles.tagActive]}
                      onPress={() => setTopic(t)}
                    >
                      <Text style={[styles.tagText, topic === t && styles.tagTextActive]}>
                        {t}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GradientBackground>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  navBtn:   { width: 36, alignItems: 'center' },
  navTitle: { fontSize: 16, fontWeight: '700', color: Colors.text.primary },

  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 20,
    alignItems: 'center',
  },

  orbWrap: { height: 150, alignItems: 'center', justifyContent: 'center' },

  titleArea: { alignItems: 'center', gap: 8 },
  title:     { fontSize: 24, fontWeight: '800', color: Colors.text.primary, letterSpacing: -0.5 },
  subtitle:  { fontSize: 14, color: Colors.text.secondary, textAlign: 'center', lineHeight: 21 },

  // Input card
  inputShadow: {
    width: '100%',
    borderRadius: 18,
    shadowColor: '#6878A8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 5,
  },
  inputClipper: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  inputTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.40)',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.text.dark,
    fontWeight: '400',
  },

  errorText: {
    fontSize: 13,
    color: Colors.error,
    textAlign: 'center',
  },

  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    backgroundColor: Colors.brand.primary,
    paddingVertical: 16,
    borderRadius: 20,
    justifyContent: 'center',
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.40,
    shadowRadius: 12,
    elevation: 6,
  },
  generateBtnDisabled: { opacity: 0.50 },
  generateBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  suggestions: { width: '100%', gap: 12 },
  suggestLabel:{ fontSize: 13, fontWeight: '600', color: Colors.text.tertiary },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(107,140,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(107,140,255,0.15)',
  },
  tagActive: {
    backgroundColor: Colors.brand.primary,
    borderColor: Colors.brand.primary,
  },
  tagText: {
    fontSize: 13,
    color: Colors.brand.primary,
    fontWeight: '500',
  },
  tagTextActive: { color: '#fff' },
});
