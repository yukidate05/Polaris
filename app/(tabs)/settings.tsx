import {
  View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet,
  Modal, FlatList, Animated, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GradientBackground, GlassCard, PolarisOrb, PolarisAlert, ChatworkIcon, type AlertButton } from '@components/ui';
import { authService } from '@services/authService';
import { useAuthStore } from '@stores/authStore';
import { useUserPreferencesStore } from '@stores/userPreferencesStore';
import { Colors } from '@constants/colors';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useT, SUPPORTED_LANGUAGES, type SupportedLang } from '@/i18n';
import { useBriefingStore } from '@stores/briefingStore';
import { notionService } from '@services/notionService';
import { slackService } from '@services/slackService';
import { teamsService } from '@services/teamsService';
import { chatworkService } from '@services/chatworkService';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { checkIsPro, getOfferings, purchasePackage, restorePurchases } from '@lib/revenuecat';
import { subscriptionService, type AccessStatus } from '@services/subscriptionService';

const isExpoGo = Constants.appOwnership === 'expo';

// ── Service brand configs ──────────────────────────────────────────────────────
const SERVICE_BRANDS: Record<string, { bg: string; iconColor: string }> = {
  google_calendar:  { bg: 'rgba(66,133,244,0.18)',  iconColor: '#4285F4' },
  gmail:            { bg: 'rgba(234,67,53,0.18)',   iconColor: '#EA4335' },
  notion:           { bg: 'rgba(255,255,255,0.14)', iconColor: '#E8E8E8' },
  slack:            { bg: 'rgba(74,21,75,0.30)',    iconColor: '#E01E5A' },
  microsoft_teams:  { bg: 'rgba(98,100,167,0.22)', iconColor: '#6264A7' },
  chatwork:         { bg: 'rgba(229,57,53,0.18)',  iconColor: '#E53935' },
};

const STATIC_PROVIDERS = [
  { id: 'notion',   label: 'Notion',   icon: 'document-text-outline' as const, proOnly: true },
  { id: 'slack',    label: 'Slack',    icon: 'chatbubbles-outline'   as const, proOnly: true },
  { id: 'chatwork', label: 'Chatwork', icon: 'flower-outline'        as const, proOnly: true },
] as const;

// ── Pulsing connected dot ──────────────────────────────────────────────────────
function PulseDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[styles.pulseDot, { opacity: pulse }]} />
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionHeaderText}>{label}</Text>
      <LinearGradient
        colors={['rgba(107,140,255,0.45)', 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.sectionHeaderLine}
      />
    </View>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { user, profile, googleAccessToken, reset: resetAuth } = useAuthStore();
  const { preferences, setPreferences } = useUserPreferencesStore();
  const t = useT();
  const [langModalVisible,    setLangModalVisible]    = useState(false);
  const [alertConfig, setAlertConfig] = useState<{
    visible: boolean; title: string; message?: string; buttons: AlertButton[];
  }>({ visible: false, title: '', buttons: [] });

  function showAlert(title: string, message: string | undefined, buttons: AlertButton[]) {
    setAlertConfig({ visible: true, title, message, buttons: buttons.map(b => ({
      ...b,
      onPress: () => { setAlertConfig(c => ({ ...c, visible: false })); b.onPress?.(); },
    })) });
  }
  const [notionConnected,     setNotionConnected]     = useState(false);
  const [slackWorkspaceCount, setSlackWorkspaceCount] = useState(0);
  const [slackWorkspaces,     setSlackWorkspaces]     = useState<{ teamId: string; teamName: string }[]>([]);
  const [teamsConnected,      setTeamsConnected]      = useState(false);
  const [chatworkConnected,   setChatworkConnected]   = useState(false);
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);

  function refreshIntegrations() {
    notionService.isConnected().then(setNotionConnected).catch(() => {});
    slackService.getWorkspaces().then(ws => {
      setSlackWorkspaces(ws);
      setSlackWorkspaceCount(ws.length);
    }).catch(() => {});
    teamsService.isConnected().then(setTeamsConnected).catch(() => {});
    chatworkService.isConnected().then(setChatworkConnected).catch(() => {});
  }

  // Androidのcallbackルートから戻った時に接続状態を更新
  useFocusEffect(useCallback(() => { refreshIntegrations(); }, []));

  useEffect(() => {
    refreshIntegrations();
    const uid = user?.uid;
    if (uid) {
      checkIsPro().then(revenueCatPro => {
        const isPro = revenueCatPro || profile?.plan === 'pro';
        return subscriptionService.checkAccess(uid, isPro);
      }).then(setAccessStatus).catch(() => {});
    }
  }, [user?.uid, profile?.plan]);

  const userIsPro = accessStatus?.reason === 'pro';

  async function refreshAccessStatus() {
    const uid = user?.uid;
    if (!uid) return;
    const isPro = await checkIsPro().catch(() => false) || profile?.plan === 'pro';
    const status = await subscriptionService.checkAccess(uid, isPro);
    setAccessStatus(status);
  }

  async function handleUpgrade() {
    if (isExpoGo) {
      showAlert('テスト環境', 'Expo GoではRevenueCatは使用できません。実機ビルドが必要です。', [{ text: 'OK' }]);
      return;
    }
    try {
      const offerings = await getOfferings();
      if (!offerings?.current) {
        showAlert('エラー', '購入オプションを取得できませんでした。', [{ text: 'OK' }]);
        return;
      }
      const pkg = offerings.current.monthly ?? offerings.current.availablePackages[0];
      if (!pkg) {
        showAlert('エラー', '月額プランが見つかりませんでした。', [{ text: 'OK' }]);
        return;
      }
      await purchasePackage(pkg);
      await refreshAccessStatus();
      showAlert('購入完了 🎉', 'Polaris Proへようこそ！', [{ text: 'OK' }]);
    } catch (e: unknown) {
      if ((e as { userCancelled?: boolean })?.userCancelled) return;
      showAlert('購入エラー', e instanceof Error ? e.message : String(e), [{ text: 'OK' }]);
    }
  }

  async function handleRestore() {
    if (isExpoGo) {
      showAlert('テスト環境', 'Expo GoではRevenueCatは使用できません。', [{ text: 'OK' }]);
      return;
    }
    try {
      const info = await restorePurchases();
      const active = info.entitlements.active;
      const isPro = !!active['pro'] || !!active['plus'];
      await refreshAccessStatus();
      showAlert(
        isPro ? '復元完了' : '購入履歴なし',
        isPro ? 'Polaris Proが復元されました。' : '復元できる購入履歴が見つかりませんでした。',
        [{ text: 'OK' }]
      );
    } catch (e: unknown) {
      showAlert('エラー', e instanceof Error ? e.message : String(e), [{ text: 'OK' }]);
    }
  }

  function showProRequired(featureName: string) {
    showAlert('Polaris Pro が必要です', `${featureName}連携はPolaris Proプランの機能です。\nアップグレードしてご利用ください。`, [
      { text: 'プランを見る', onPress: () => {} },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  }

  async function handleConnectNotion() {
    if (!notionConnected && !userIsPro) { showProRequired('Notion'); return; }
    if (notionConnected) {
      showAlert('Notion', 'Notionとの連携を解除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '接続解除', style: 'destructive',
          onPress: async () => {
            await notionService.disconnect();
            setNotionConnected(false);
          },
        },
      ]);
      return;
    }
    try {
      const url = notionService.getAuthUrl();
      await WebBrowser.openAuthSessionAsync(url, 'polaris://notion-callback');
      const connected = await notionService.isConnected();
      setNotionConnected(connected);
    } catch (e: unknown) {
      showAlert('連携エラー', e instanceof Error ? e.message : String(e), [{ text: 'OK' }]);
    }
  }

  async function handleConnectSlack() {
    if (slackWorkspaceCount === 0 && !userIsPro) { showProRequired('Slack'); return; }
    if (slackWorkspaceCount > 0) {
      const wsNames = slackWorkspaces.map(w => `・${w.teamName}`).join('\n');
      const canAdd  = slackService.canAddMore(slackWorkspaceCount);
      const buttons: AlertButton[] = [
        { text: 'キャンセル', style: 'cancel' },
        ...(canAdd ? [{
          text: 'ワークスペースを追加',
          style: 'default' as const,
          onPress: async () => {
            try {
              const url = slackService.getAuthUrl();
              await WebBrowser.openAuthSessionAsync(url, 'polaris://slack-callback');
              const ws = await slackService.getWorkspaces();
              setSlackWorkspaces(ws);
              setSlackWorkspaceCount(ws.length);
            } catch (e: unknown) {
              showAlert('連携エラー', e instanceof Error ? e.message : String(e), [{ text: 'OK' }]);
            }
          },
        }] : []),
        {
          text: 'すべて接続解除', style: 'destructive',
          onPress: async () => {
            await slackService.disconnectAll();
            setSlackWorkspaces([]);
            setSlackWorkspaceCount(0);
          },
        },
      ];
      showAlert(`Slack（${slackWorkspaceCount}/5）`, `接続中:\n${wsNames}`, buttons);
      return;
    }
    try {
      const url = slackService.getAuthUrl();
      await WebBrowser.openAuthSessionAsync(url, 'polaris://slack-callback');
      const ws = await slackService.getWorkspaces();
      setSlackWorkspaces(ws);
      setSlackWorkspaceCount(ws.length);
    } catch (e: unknown) {
      showAlert('連携エラー', e instanceof Error ? e.message : String(e), [{ text: 'OK' }]);
    }
  }

  async function handleConnectChatwork() {
    if (!chatworkConnected && !userIsPro) { showProRequired('Chatwork'); return; }
    if (chatworkConnected) {
      showAlert('Chatwork', 'Chatworkとの連携を解除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '接続解除', style: 'destructive',
          onPress: async () => {
            await chatworkService.disconnect();
            setChatworkConnected(false);
          },
        },
      ]);
      return;
    }
    try {
      const url = chatworkService.getAuthUrl();
      const result = await WebBrowser.openAuthSessionAsync(url, 'polaris://chatwork-callback');
      if (Platform.OS === 'ios' && result.type === 'success') {
        const code = new URL(result.url).searchParams.get('code');
        if (code) await chatworkService.exchangeCode(code);
        const connected = await chatworkService.isConnected();
        setChatworkConnected(connected);
        if (connected) {
          showAlert(t('connect_success'), 'Chatworkが連携されました。', [{ text: 'OK' }]);
        }
      }
    } catch (e: unknown) {
      showAlert(t('connect_error'), e instanceof Error ? e.message : String(e), [{ text: 'OK' }]);
    }
  }

  async function handleConnectTeams() {
    if (!teamsConnected && !userIsPro) { showProRequired('Microsoft Teams'); return; }
    if (teamsConnected) {
      showAlert('Microsoft Teams', 'Teamsとの連携を解除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '接続解除', style: 'destructive',
          onPress: async () => {
            await teamsService.disconnect();
            setTeamsConnected(false);
          },
        },
      ]);
      return;
    }
    try {
      const url = teamsService.getAuthUrl();
      const result = await WebBrowser.openAuthSessionAsync(url, 'polaris://teams-callback');

      if (Platform.OS === 'ios' && result.type === 'success') {
        // iOS: ASWebAuthenticationSession がURLをキャプチャして返す（Routerは関与しない）
        // → settings.tsx でコード交換する
        const code = new URL(result.url).searchParams.get('code');
        if (code) await teamsService.exchangeCode(code);
        const connected = await teamsService.isConnected();
        setTeamsConnected(connected);
        if (connected) {
          showAlert(t('connect_success'), 'Microsoft Teamsが連携されました。', [{ text: 'OK' }]);
        }
      }
      // Android: deep linkが teams-callback.tsx にルーティングされてコード交換→設定画面へ戻る
      // → settings.tsx では何もしない（teams-callback.tsx が完了後に設定画面が再マウントされる）
    } catch (e: unknown) {
      showAlert(t('connect_error'), e instanceof Error ? e.message : String(e), [{ text: 'OK' }]);
    }
  }

  const hasGoogleAccess = !!googleAccessToken;
  const sourceProviders = [
    { id: 'google_calendar', label: 'Google Calendar', icon: 'calendar-outline'    as const, connected: hasGoogleAccess },
    { id: 'gmail',           label: 'Gmail',            icon: 'mail-outline'        as const, connected: hasGoogleAccess },
    ...STATIC_PROVIDERS.map((p) => ({
      ...p,
      connected:  p.id === 'notion'   ? notionConnected
                : p.id === 'slack'    ? slackWorkspaceCount > 0
                : p.id === 'chatwork' ? chatworkConnected
                : false,
      slackCount: p.id === 'slack' ? slackWorkspaceCount : undefined,
      locked:     p.proOnly && !userIsPro,
    })),
  ];

  async function handleConnectGoogle() {
    if (isExpoGo) { showAlert(t('expo_go_title'), t('expo_go_msg'), [{ text: 'OK' }]); return; }
    if (hasGoogleAccess) {
      showAlert('Google', 'Google連携を解除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '接続解除', style: 'destructive',
          onPress: () => useAuthStore.getState().setGoogleAccessToken(null),
        },
      ]);
      return;
    }
    try {
      const { accessToken } = await authService.signInWithGoogle();
      if (accessToken) {
        useAuthStore.getState().setGoogleAccessToken(accessToken);
        showAlert(t('connect_success'), t('connect_success_msg'), [{ text: 'OK' }]);
      }
    } catch (e: unknown) {
      showAlert(t('connect_error'), e instanceof Error ? e.message : String(e), [{ text: 'OK' }]);
    }
  }

  async function handleSignOut() {
    showAlert(t('sign_out'), t('sign_out_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('sign_out'), style: 'destructive',
        onPress: async () => {
          const { bgmService } = await import('@services/bgmService');
          bgmService.stop();
          await authService.signOut();
          resetAuth();
          router.replace('/(onboarding)/welcome');
        },
      },
    ]);
  }

  const displayName  = profile?.displayName ?? user?.displayName ?? 'ユーザー';
  const email        = profile?.email ?? user?.email ?? '';
  const currentLang  = SUPPORTED_LANGUAGES.find((l) => l.code === preferences.language);

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <Text style={styles.pageTitle}>{t('settings')}</Text>

          {/* ── Profile ── */}
          <View style={styles.profileOuter}>
            <LinearGradient
              colors={['rgba(107,140,255,0.12)', 'rgba(78,205,196,0.06)', 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <GlassCard contentStyle={styles.profileInner} radius={24}>
              <View style={styles.orbRing}>
                <View style={styles.orbGlow} />
                <PolarisOrb size={52} />
              </View>
              <View style={styles.profileText}>
                <Text style={styles.profileName}>{displayName}</Text>
                <Text style={styles.profileEmail}>{email}</Text>
                <View style={[
                  styles.planPill,
                  accessStatus?.reason === 'pro'   && styles.planPillPro,
                  accessStatus?.reason === 'trial' && styles.planPillTrial,
                ]}>
                  <View style={[
                    styles.planPillDot,
                    accessStatus?.reason === 'pro'   && styles.planPillDotPro,
                    accessStatus?.reason === 'trial' && styles.planPillDotTrial,
                  ]} />
                  <Text style={[
                    styles.planPillText,
                    accessStatus?.reason === 'pro'   && styles.planPillTextPro,
                    accessStatus?.reason === 'trial' && styles.planPillTextTrial,
                  ]}>
                    {accessStatus?.reason === 'pro'
                      ? 'Pro プラン'
                      : accessStatus?.reason === 'trial'
                      ? `トライアル中（残${accessStatus.trialDaysLeft}日）`
                      : t('free_plan')}
                  </Text>
                </View>
              </View>
            </GlassCard>
          </View>

          {/* ── Integrations ── */}
          <View style={styles.section}>
            <SectionHeader label={t('integrations')} />
            <GlassCard padding={0} radius={22}>
              {sourceProviders.map((source, i) => {
                const brand = SERVICE_BRANDS[source.id] ?? { bg: 'rgba(107,140,255,0.12)', iconColor: Colors.brand.primary };
                const isConnected = source.connected;
                const isLocked = 'locked' in source && source.locked;
                const slackCount = source.id === 'slack' && 'slackCount' in source ? source.slackCount : undefined;
                const badgeLabel = isLocked ? 'Pro'
                  : source.id === 'slack'
                  ? (slackCount ? `${slackCount}/5` : t('connect'))
                  : isConnected ? t('connected') : t('connect');

                return (
                  <View key={source.id}>
                    <TouchableOpacity
                      style={styles.serviceRow}
                      activeOpacity={0.7}
                      onPress={
                        (source.id === 'gmail' || source.id === 'google_calendar')
                          ? handleConnectGoogle
                          : source.id === 'notion'
                          ? handleConnectNotion
                          : source.id === 'slack'
                          ? handleConnectSlack
                          : source.id === 'microsoft_teams'
                          ? handleConnectTeams
                          : source.id === 'chatwork'
                          ? handleConnectChatwork
                          : undefined
                      }
                    >
                      <View style={[styles.serviceIconBox, { backgroundColor: brand.bg }]}>
                        {source.id === 'chatwork'
                          ? <ChatworkIcon size={17} color={brand.iconColor} />
                          : <Ionicons name={source.icon} size={17} color={brand.iconColor} />
                        }
                      </View>
                      <Text style={styles.serviceLabel}>{source.label}</Text>
                      <View style={styles.connectionRight}>
                        {isConnected && <PulseDot />}
                        <View style={[
                          styles.connectionBadge,
                          isConnected && styles.connectionBadgeOn,
                          isLocked    && styles.connectionBadgePro,
                        ]}>
                          {isLocked && <Ionicons name="lock-closed" size={12} color={Colors.aurora.lavender} style={{ marginRight: 3 }} />}
                          <Text style={[
                            styles.connectionText,
                            isConnected && styles.connectionTextOn,
                            isLocked    && styles.connectionTextPro,
                          ]}>
                            {badgeLabel}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                    {i < sourceProviders.length - 1 && <View style={styles.rowDivider} />}
                  </View>
                );
              })}
            </GlassCard>
          </View>

          {/* ── Host ── */}
          <View style={styles.section}>
            <SectionHeader label={t('host')} />
            <GlassCard padding={0} radius={22}>
              <TouchableOpacity style={styles.serviceRow} activeOpacity={0.7} onPress={() => router.push('/host-selection')}>
                <View style={[styles.serviceIconBox, { backgroundColor: 'rgba(107,140,255,0.15)' }]}>
                  <Ionicons name="mic-outline" size={17} color={Colors.brand.primary} />
                </View>
                <Text style={styles.serviceLabel}>{t('change_host')}</Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.30)" />
              </TouchableOpacity>
            </GlassCard>
          </View>

          {/* ── Language ── */}
          <View style={styles.section}>
            <SectionHeader label={t('language')} />
            <GlassCard padding={0} radius={22}>
              <TouchableOpacity style={styles.serviceRow} activeOpacity={0.7} onPress={() => setLangModalVisible(true)}>
                <View style={[styles.serviceIconBox, { backgroundColor: 'rgba(78,205,196,0.15)' }]}>
                  <Ionicons name="globe-outline" size={17} color={Colors.aurora.teal} />
                </View>
                <Text style={styles.serviceLabel}>{currentLang?.nativeLabel ?? 'English'}</Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.30)" />
              </TouchableOpacity>
            </GlassCard>
          </View>

          {/* ── Notifications ── */}
          <View style={styles.section}>
            <SectionHeader label={t('notifications')} />
            <GlassCard padding={0} radius={22}>
              <View style={styles.toggleRow}>
                <View style={[styles.serviceIconBox, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                  <Ionicons name="notifications-outline" size={17} color="#F59E0B" />
                </View>
                <Text style={styles.serviceLabel}>{t('briefing_notif')}</Text>
                <Switch
                  value={preferences.notificationsEnabled}
                  onValueChange={(v) => setPreferences({ notificationsEnabled: v })}
                  trackColor={{ true: Colors.brand.primary, false: 'rgba(255,255,255,0.14)' }}
                  thumbColor="#fff"
                />
              </View>
            </GlassCard>
          </View>

          {/* ── Plan (hero card) ── */}
          <View style={styles.section}>
            <SectionHeader label={t('plan')} />
            <View style={styles.planCardOuter}>
              <LinearGradient
                colors={['rgba(107,140,255,0.28)', 'rgba(78,205,196,0.16)', 'rgba(168,152,255,0.20)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <GlassCard intensity={35} radius={24} contentStyle={styles.planCardInner}>
                <View style={styles.planTopRow}>
                  <View>
                    <Text style={styles.planName}>Polaris Pro</Text>
                    <Text style={styles.planDesc}>{t('pro_tagline')}</Text>
                  </View>
                  {!userIsPro && (
                    <View style={styles.planPriceBox}>
                      <Text style={styles.planPrice}>{t('pro_price')}</Text>
                      <Text style={styles.planPriceSub}>{t('per_month')}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.planFeatures}>
                  {[t('f_unlimited'), t('f_10min'), t('f_notion'), t('f_slack')].map((f) => (
                    <View key={f} style={styles.planFeatureRow}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.aurora.teal} />
                      <Text style={styles.planFeatureText}>{f}</Text>
                    </View>
                  ))}
                </View>
                {userIsPro ? (
                  <TouchableOpacity
                    style={styles.manageBtn}
                    activeOpacity={0.75}
                    onPress={() => {
                      const url = Platform.OS === 'ios'
                        ? 'itms-apps://apps.apple.com/account/subscriptions'
                        : 'https://play.google.com/store/account/subscriptions';
                      Linking.openURL(url).catch(() => {});
                    }}
                  >
                    <Text style={styles.manageBtnText}>{t('manage_subscription')}</Text>
                    <Ionicons name="open-outline" size={13} color="rgba(255,255,255,0.45)" />
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity style={styles.upgradeBtn} activeOpacity={0.85} onPress={handleUpgrade}>
                      <LinearGradient
                        colors={[Colors.brand.primary, Colors.aurora.teal]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={styles.upgradeBtnGrad}
                      >
                        <Text style={styles.upgradeBtnText}>{t('upgrade')}</Text>
                        <Ionicons name="arrow-forward" size={15} color="#fff" />
                      </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn} activeOpacity={0.6}>
                      <Text style={styles.restoreBtnText}>購入を復元する</Text>
                    </TouchableOpacity>
                  </>
                )}
              </GlassCard>
            </View>
          </View>

          {/* ── Sign out ── */}
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={16} color={Colors.error} />
            <Text style={styles.signOutText}>{t('sign_out')}</Text>
          </TouchableOpacity>

          <Text style={styles.version}>Polaris v1.0.0</Text>
        </ScrollView>
      </SafeAreaView>

      {/* Custom alert */}
      <PolarisAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertConfig(c => ({ ...c, visible: false }))}
      />

      {/* Language modal */}
      <Modal visible={langModalVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setLangModalVisible(false)}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('language')}</Text>
            <FlatList
              data={SUPPORTED_LANGUAGES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.langRow}
                  onPress={() => {
                    setPreferences({ language: item.code as SupportedLang });
                    useBriefingStore.getState().reset();
                    setLangModalVisible(false);
                  }}
                >
                  <Text style={styles.langNative}>{item.nativeLabel}</Text>
                  <Text style={styles.langLabel}>{item.label}</Text>
                  {preferences.language === item.code && (
                    <Ionicons name="checkmark" size={18} color={Colors.brand.primary} style={{ marginLeft: 'auto' as any }} />
                  )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1 },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 110,
    gap: 20,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 2,
  },

  // ── Profile
  profileOuter: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  profileInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  orbRing: {
    position: 'relative',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbGlow: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(107,140,255,0.18)',
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
  },
  profileText:  { flex: 1, gap: 3 },
  profileName:  { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
  profileEmail: { fontSize: 13, color: 'rgba(255,255,255,0.50)' },
  planPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(107,140,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(107,140,255,0.25)',
  },
  planPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.brand.primary,
  },
  planPillText: { fontSize: 11, fontWeight: '600', color: Colors.brand.primary },
  planPillPro: {
    backgroundColor: 'rgba(78,205,196,0.14)',
    borderColor: 'rgba(78,205,196,0.35)',
  },
  planPillDotPro:   { backgroundColor: Colors.aurora.teal },
  planPillTextPro:  { color: Colors.aurora.teal },
  planPillTrial: {
    backgroundColor: 'rgba(168,152,255,0.14)',
    borderColor: 'rgba(168,152,255,0.35)',
  },
  planPillDotTrial:  { backgroundColor: Colors.aurora.lavender },
  planPillTextTrial: { color: Colors.aurora.lavender },

  // ── Section header
  section: { gap: 10 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 2,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
  },

  // ── Service rows
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 13,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 13,
  },
  serviceIconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#fff',
  },
  connectionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.aurora.teal,
    shadowColor: Colors.aurora.teal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  connectionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  connectionBadgeOn: {
    backgroundColor: 'rgba(78,205,196,0.10)',
    borderColor: 'rgba(78,205,196,0.25)',
  },
  connectionBadgePro: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168,152,255,0.12)',
    borderColor: 'rgba(168,152,255,0.30)',
  },
  connectionText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  connectionTextOn: {
    color: Colors.aurora.teal,
  },
  connectionTextPro: {
    color: Colors.aurora.lavender,
  },
  rowDivider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginLeft: 65,
  },

  // ── Plan hero
  planCardOuter: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  planCardInner: {
    gap: 14,
  },
  planTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  planName: {
    fontSize: 19,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
  },
  planDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.50)',
    marginTop: 3,
    maxWidth: 200,
  },
  planPriceBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  planPrice: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.aurora.teal,
  },
  planPriceSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
  },
  planFeatures: { gap: 7 },
  planFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  planFeatureText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.70)',
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 2,
  },
  manageBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
  },
  upgradeBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 2,
  },
  upgradeBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
  },
  upgradeBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  restoreBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  restoreBtnText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.28)',
  },

  // ── Sign out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.error,
  },
  version: {
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(255,255,255,0.22)',
    letterSpacing: 0.8,
  },

  // ── Language modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#0e1228',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 44,
    maxHeight: '72%',
    borderTopWidth: 1,
    borderColor: 'rgba(107,140,255,0.18)',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.20)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  langNative: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    width: 100,
  },
  langLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
  },
});
