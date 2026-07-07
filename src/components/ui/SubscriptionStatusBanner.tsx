import { useEffect, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@stores/authStore';
import { subscriptionService, type AccessStatus } from '@services/subscriptionService';
import { checkIsPro } from '@lib/revenuecat';
import { useT } from '@/i18n';

function urgencyLevel(status: AccessStatus): 'normal' | 'warning' | 'critical' {
  if (status.reason === 'trial') {
    if (status.trialDaysLeft <= 1) return 'critical';
    if (status.trialDaysLeft <= 2) return 'warning';
    return 'normal';
  }
  if (status.reason === 'cooldown_active') {
    if (status.cooldownDaysLeft <= 1) return 'warning';
    return 'normal';
  }
  // free_cooldown = can use today → positive state
  return 'normal';
}

function bannerText(status: AccessStatus, t: ReturnType<typeof useT>): { label: string; icon: string } {
  if (status.reason === 'trial') {
    const d = status.trialDaysLeft;
    return {
      icon:  d <= 1 ? 'alert-circle-outline' : 'time-outline',
      label: d <= 1 ? t('trial_ends_today') : t('trial_days_left', { n: d }),
    };
  }
  if (status.reason === 'cooldown_active') {
    const d = status.cooldownDaysLeft;
    return {
      icon:  'time-outline',
      label: d <= 1 ? t('cooldown_tomorrow') : t('cooldown_days_left', { n: d }),
    };
  }
  // free_cooldown = can use now
  return {
    icon:  'radio-button-on-outline',
    label: t('one_generation_left'),
  };
}

const COLORS = {
  normal: {
    border: 'rgba(107,140,255,0.35)',
    bg:     'rgba(107,140,255,0.12)',
    text:   '#8BA4FF',
    icon:   '#6B8CFF',
    dot:    '#6B8CFF',
  },
  warning: {
    border: 'rgba(251,191,36,0.35)',
    bg:     'rgba(251,191,36,0.10)',
    text:   '#FBB824',
    icon:   '#F59E0B',
    dot:    '#F59E0B',
  },
  critical: {
    border: 'rgba(239,68,68,0.40)',
    bg:     'rgba(239,68,68,0.10)',
    text:   '#F87171',
    icon:   '#EF4444',
    dot:    '#EF4444',
  },
} as const;

export function SubscriptionStatusBanner() {
  const t = useT();
  const { user, profile } = useAuthStore();
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [isPro,  setIsPro]  = useState(false);
  const firestorePro = profile?.plan === 'pro';

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;

    (async () => {
      const [pro, access] = await Promise.all([
        checkIsPro().catch(() => false),
        subscriptionService.checkAccess(user.uid, firestorePro).catch(() => null),
      ]);
      if (cancelled) return;
      setIsPro(pro);
      setStatus(access);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    })();

    return () => { cancelled = true; };
  }, [user?.uid]);

  useEffect(() => {
    if (!status) return;
    const level = urgencyLevel(status);
    if (level === 'normal') { pulseAnim.setValue(1); return; }

    const speed = level === 'critical' ? 700 : 1100;
    const loop  = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.55, duration: speed, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: speed, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [status]);

  if (!user || isPro || firestorePro || !status) return null;
  if (status.reason === 'pro') return null;

  const level  = urgencyLevel(status);
  const colors = COLORS[level];
  const { label, icon } = bannerText(status, t);

  return (
    <Animated.View style={[styles.wrapper, { opacity: fadeAnim }]}>
      <TouchableOpacity
        activeOpacity={0.80}
        onPress={() => router.push('/(tabs)/settings')}
        style={[styles.pill, { borderColor: colors.border }]}
      >
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[styles.pillBg, { backgroundColor: colors.bg }]} />

        <View style={styles.dotWrap}>
          <Animated.View style={[styles.dotGlow, { backgroundColor: colors.dot, opacity: pulseAnim, transform: [{ scale: pulseAnim }] }]} />
          <View style={[styles.dot, { backgroundColor: colors.dot }]} />
        </View>

        <Ionicons name={icon as any} size={13} color={colors.icon} />
        <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
          {label}
        </Text>

        <Ionicons name="chevron-forward" size={12} color={colors.icon} style={{ opacity: 0.7 }} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    marginBottom: 4,
  },
  pill: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            6,
    paddingHorizontal: 14,
    paddingVertical:    8,
    borderRadius:   99,
    borderWidth:    1,
    overflow:       'hidden',
  },
  pillBg: {
    ...StyleSheet.absoluteFillObject,
  },
  dotWrap: {
    width: 8,
    height: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: 'absolute',
  },
  dotGlow: {
    width: 14,
    height: 14,
    borderRadius: 7,
    position: 'absolute',
  },
  label: {
    fontSize:   13,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
});
