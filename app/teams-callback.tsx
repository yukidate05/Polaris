import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { teamsService } from '@services/teamsService';
import { Colors } from '@constants/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

WebBrowser.maybeCompleteAuthSession();

type State = 'loading' | 'success' | 'error';

export default function TeamsCallbackScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const handled = useRef(false);
  const [state, setState] = useState<State>('loading');
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!code || handled.current) return;
    handled.current = true;

    teamsService.exchangeCode(code)
      .then(({ displayName }) => {
        setLabel(`「${displayName}」と連携しました`);
        setState('success');
        setTimeout(() => router.replace('/(tabs)/settings'), 1600);
      })
      .catch((e: unknown) => {
        setLabel(e instanceof Error ? e.message : String(e));
        setState('error');
        setTimeout(() => router.replace('/(tabs)/settings'), 2400);
      });
  }, [code]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#030816', '#060e24', '#040a18']}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.card}>
        <LinearGradient
          colors={['rgba(107,140,255,0.14)', 'rgba(78,205,196,0.08)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tint} />

        {state === 'loading' && (
          <>
            <View style={styles.iconRing}>
              <Ionicons name="people-outline" size={28} color="#6264A7" />
            </View>
            <Text style={styles.cardTitle}>Microsoft Teamsと連携中...</Text>
            <Text style={styles.cardSub}>しばらくお待ちください</Text>
          </>
        )}

        {state === 'success' && (
          <>
            <View style={[styles.iconRing, styles.iconRingSuccess]}>
              <Ionicons name="checkmark" size={30} color={Colors.aurora.teal} />
            </View>
            <Text style={styles.cardTitle}>接続完了</Text>
            <Text style={styles.cardSub}>{label}</Text>
          </>
        )}

        {state === 'error' && (
          <>
            <View style={[styles.iconRing, styles.iconRingError]}>
              <Ionicons name="alert-circle-outline" size={28} color={Colors.error} />
            </View>
            <Text style={styles.cardTitle}>連携エラー</Text>
            <Text style={styles.cardSub}>{label}</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 300,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,15,35,0.55)',
  },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(98,100,167,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(98,100,167,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  iconRingSuccess: {
    backgroundColor: 'rgba(78,205,196,0.12)',
    borderColor: 'rgba(78,205,196,0.30)',
  },
  iconRingError: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderColor: 'rgba(239,68,68,0.25)',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
  cardSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
