import { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GradientBackground, PolarisOrb, Button, GlassCard } from '@components/ui';
import { authService } from '@services/authService';
import { userService } from '@services/userService';
import { useAuthStore } from '@stores/authStore';
import { Colors } from '@constants/colors';

export default function LoginScreen() {
  const [loading, setLoading] = useState<'google' | 'apple' | null>(null);
  const { setLoading: setStoreLoading, setGoogleAccessToken, setProfile } = useAuthStore();

  async function handleGoogleSignIn() {
    setLoading('google');
    setStoreLoading(true);
    try {
      const { user, accessToken } = await authService.signInWithGoogle();
      if (accessToken) setGoogleAccessToken(accessToken);
      const profile = await userService.upsertProfile(user);
      setProfile(profile);
      router.replace('/(tabs)/home');
    } catch (error: any) {
      // statusCodes.SIGN_IN_CANCELLED = user dismissed
      if (error.code !== '12501') {
        Alert.alert('エラー', `[${error.code}] ${error.message ?? 'Googleログインに失敗しました。'}`);
      }
    } finally {
      setLoading(null);
      setStoreLoading(false);
    }
  }

  async function handleAppleSignIn() {
    setLoading('apple');
    setStoreLoading(true);
    try {
      await authService.signInWithApple();
      router.replace('/(tabs)/home');
    } catch (error: any) {
      if (error.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('エラー', error.message ?? 'Appleログインに失敗しました。');
      }
    } finally {
      setLoading(null);
      setStoreLoading(false);
    }
  }

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>

          {/* Hero */}
          <View style={styles.hero}>
            <PolarisOrb size={80} />
            <Text style={styles.title}>Polaris</Text>
            <Text style={styles.subtitle}>今日を、最高の一日に。</Text>
          </View>

          {/* Login card */}
          <GlassCard style={styles.card}>
            <Text style={styles.cardTitle}>ログイン / アカウント作成</Text>
            <Text style={styles.cardSubtitle}>
              続行することで、利用規約およびプライバシーポリシーに同意したものとみなされます。
            </Text>

            <View style={styles.buttons}>
              <Button
                onPress={handleGoogleSignIn}
                label="Googleでログイン"
                variant="secondary"
                loading={loading === 'google'}
                disabled={loading !== null}
              />

              {Platform.OS === 'ios' && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={26}
                  style={styles.appleButton}
                  onPress={handleAppleSignIn}
                />
              )}
            </View>
          </GlassCard>

          <Button
            label="戻る"
            variant="ghost"
            onPress={() => router.back()}
          />
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
    alignItems: 'center',
  },
  hero: {
    alignItems: 'center',
    gap: 12,
    marginTop: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.72)',
  },
  card: {
    width: '100%',
    padding: 24,
    gap: 16,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.50)',
    textAlign: 'center',
    lineHeight: 18,
  },
  buttons: { gap: 12 },
  appleButton: {
    height: 52,
    width: '100%',
  },
});
