import { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform, Linking } from 'react-native';
import { useT } from '@/i18n';

const PRIVACY_POLICY_URL = 'https://isyd.me/privacy';
const TERMS_URL = 'https://isyd.me/terms';
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
  const t = useT();

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
            <Text style={styles.subtitle}>{t('login_subtitle')}</Text>
          </View>

          {/* Login card */}
          <View style={styles.card}>
          <GlassCard padding={0} contentStyle={styles.cardContent}>
            <Text style={styles.cardTitle}>{t('login_title')}</Text>
            <Text style={styles.cardSubtitle}>
              {t('login_agreement')}
              <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
                {t('login_terms')}
              </Text>
              {t('login_and')}
              <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
                {t('login_privacy')}
              </Text>
              {t('login_agreement2')}
            </Text>

            <View style={styles.buttons}>
              <Button
                onPress={handleGoogleSignIn}
                label={t('sign_in_google')}
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
          </View>

          <Button
            label={t('back')}
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
    alignSelf: 'stretch',
  },
  cardContent: {
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
  link: {
    color: 'rgba(255,255,255,0.75)',
    textDecorationLine: 'underline',
  },
  buttons: { gap: 12 },
  appleButton: {
    height: 52,
    width: '100%',
  },
});
