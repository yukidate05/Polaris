import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GradientBackground, GlassCard, PolarisOrb } from '@components/ui';
import { authService } from '@services/authService';
import { useAuthStore } from '@stores/authStore';
import { useUserPreferencesStore } from '@stores/userPreferencesStore';
import { Colors } from '@constants/colors';
import { router } from 'expo-router';
import Constants from 'expo-constants';

const isExpoGo = Constants.appOwnership === 'expo';

const STATIC_PROVIDERS = [
  { id: 'notion', label: 'Notion',    icon: 'document-text-outline' as const },
  { id: 'slack',  label: 'Slack',     icon: 'chatbubbles-outline' as const },
  { id: 'rss',    label: 'RSS Feeds', icon: 'radio-outline' as const },
] as const;

export default function SettingsScreen() {
  const { user, profile, googleAccessToken, reset: resetAuth } = useAuthStore();
  const { preferences, setPreferences } = useUserPreferencesStore();

  const hasGoogleAccess = !!googleAccessToken;
  const sourceProviders = [
    { id: 'google_calendar', label: 'Google Calendar', icon: 'calendar-outline' as const, connected: hasGoogleAccess },
    { id: 'gmail',           label: 'Gmail',            icon: 'mail-outline' as const,     connected: hasGoogleAccess },
    ...STATIC_PROVIDERS.map((p) => ({ ...p, connected: false })),
  ];

  async function handleConnectGoogle() {
    if (isExpoGo) {
      Alert.alert('Expo Go では利用不可', 'Gmail連携はdev buildまたは本番ビルドで利用できます。');
      return;
    }
    try {
      const { accessToken } = await authService.signInWithGoogle();
      if (accessToken) {
        useAuthStore.getState().setGoogleAccessToken(accessToken);
        Alert.alert('接続完了', 'GmailとGoogle Calendarが連携されました。');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('連携エラー', msg);
    }
  }

  async function handleSignOut() {
    Alert.alert('ログアウト', 'ログアウトしますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'ログアウト',
        style: 'destructive',
        onPress: async () => {
          await authService.signOut();
          resetAuth();
          router.replace('/(onboarding)/welcome');
        },
      },
    ]);
  }

  const displayName = profile?.displayName ?? user?.displayName ?? 'ユーザー';
  const email = profile?.email ?? user?.email ?? '';

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.headerTitle}>設定</Text>

          {/* Profile */}
          <GlassCard style={styles.profileCard}>
            <PolarisOrb size={56} />
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{displayName}</Text>
              <Text style={styles.profileEmail}>{email}</Text>
              <View style={styles.planBadge}>
                <Text style={styles.planText}>Free プラン</Text>
              </View>
            </View>
          </GlassCard>

          {/* Source connections */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>連携サービス</Text>
            <GlassCard>
              {sourceProviders.map((source, i) => (
                <View key={source.id}>
                  <TouchableOpacity
                    style={styles.sourceRow}
                    onPress={
                      (source.id === 'gmail' || source.id === 'google_calendar') && !source.connected
                        ? handleConnectGoogle
                        : undefined
                    }
                  >
                    <View style={styles.sourceIconWrapper}>
                      <Ionicons name={source.icon} size={18} color={Colors.brand.primary} />
                    </View>
                    <Text style={styles.sourceLabel}>{source.label}</Text>
                    <View style={[styles.connectionBadge, source.connected && styles.connectionBadgeActive]}>
                      <Text style={[styles.connectionText, source.connected && styles.connectionTextActive]}>
                        {source.connected ? '接続済み' : '接続する'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {i < sourceProviders.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </GlassCard>
          </View>

          {/* Notifications */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>通知</Text>
            <GlassCard>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>ブリーフィング通知</Text>
                <Switch
                  value={preferences.notificationsEnabled}
                  onValueChange={(v) => setPreferences({ notificationsEnabled: v })}
                  trackColor={{ true: Colors.brand.primary, false: '#E2E8F0' }}
                  thumbColor="#fff"
                />
              </View>
            </GlassCard>
          </View>

          {/* Subscription */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>プラン</Text>
            <GlassCard style={styles.planCard}>
              <View style={styles.planHeader}>
                <Text style={styles.planTitle}>Polaris Plus</Text>
                <Text style={styles.planPrice}>¥980 / 月</Text>
              </View>
              <Text style={styles.planDescription}>
                毎日のブリーフィング、複数ソース連携、Notion保存などが使える上位プラン
              </Text>
              <TouchableOpacity style={styles.upgradeBtn}>
                <Text style={styles.upgradeBtnText}>アップグレード</Text>
              </TouchableOpacity>
            </GlassCard>
          </View>

          {/* Sign out */}
          <View style={styles.section}>
            <GlassCard>
              <TouchableOpacity style={styles.signOutRow} onPress={handleSignOut}>
                <Ionicons name="log-out-outline" size={20} color={Colors.error} />
                <Text style={styles.signOutText}>ログアウト</Text>
              </TouchableOpacity>
            </GlassCard>
          </View>

          <Text style={styles.version}>Polaris v1.0.0</Text>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 100,
    gap: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text.primary,
    marginBottom: 4,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileInfo: { flex: 1, gap: 4 },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text.primary,
  },
  profileEmail: {
    fontSize: 13,
    color: Colors.text.secondary,
  },
  planBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(20,184,166,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 2,
  },
  planText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.brand.primary,
  },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text.secondary,
    paddingLeft: 4,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  sourceIconWrapper: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(20,184,166,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceLabel: {
    flex: 1,
    fontSize: 15,
    color: Colors.text.primary,
    fontWeight: '500',
  },
  connectionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  connectionBadgeActive: {
    backgroundColor: 'rgba(20,184,166,0.12)',
  },
  connectionText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text.tertiary,
  },
  connectionTextActive: {
    color: Colors.brand.primary,
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginLeft: 46,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingLabel: {
    fontSize: 15,
    color: Colors.text.primary,
    fontWeight: '500',
  },
  planCard: { gap: 12 },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text.primary,
  },
  planPrice: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.brand.primary,
  },
  planDescription: {
    fontSize: 13,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  upgradeBtn: {
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.error,
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.text.tertiary,
    marginTop: 8,
  },
});
