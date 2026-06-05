import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@constants/colors';
import type { AccessStatus } from '@services/subscriptionService';

interface PaywallModalProps {
  visible:   boolean;
  status:    AccessStatus | null;
  onUpgrade: () => void;
  onDismiss: () => void;
}

const FEATURES = [
  { icon: 'infinite-outline',  text: '毎日のブリーフィング（無制限）' },
  { icon: 'time-outline',      text: '10分のブリーフィング' },
  { icon: 'newspaper-outline', text: 'パーソナライズされたニュース' },
  { icon: 'logo-slack',        text: 'Notion / Slack 連携' },
];

export function PaywallModal({ visible, status, onUpgrade, onDismiss }: PaywallModalProps) {
  const isCooldown = status?.reason === 'cooldown_active';
  const daysLeft   = status?.cooldownDaysLeft ?? 0;

  const headline = isCooldown
    ? `次の生成まで残り ${daysLeft} 日`
    : '5日間のトライアルが終了しました';

  const subtext = isCooldown
    ? `無料プランは3日に1回ブリーフィングを生成できます。\nPolaris Pro なら毎日使い放題です。`
    : '毎日のブリーフィングを続けるには\nPolaris Pro へのアップグレードが必要です。';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss} />

        <View style={styles.card}>
          {/* PolarisAlert と同じトップアクセントライン */}
          <LinearGradient
            colors={[Colors.brand.primary, Colors.aurora.teal]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.topAccent}
          />

          <View style={styles.content}>
            {/* ヘッドライン */}
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.subtext}>{subtext}</Text>

            {/* 機能リスト */}
            <View style={styles.features}>
              {FEATURES.map((f, i) => (
                <View key={f.text} style={[styles.featureRow, i < FEATURES.length - 1 && styles.featureRowBorder]}>
                  <Ionicons name={f.icon as any} size={15} color={Colors.brand.primary} />
                  <Text style={styles.featureText}>{f.text}</Text>
                </View>
              ))}
            </View>

            {/* 価格 */}
            <View style={styles.priceRow}>
              <Text style={styles.price}>¥980</Text>
              <Text style={styles.pricePer}> / 月</Text>
            </View>

            {/* CTA */}
            <TouchableOpacity style={styles.upgradeBtn} onPress={onUpgrade} activeOpacity={0.85}>
              <Text style={styles.upgradeBtnText}>Polaris Pro にアップグレード</Text>
            </TouchableOpacity>

            {/* 却下 */}
            <TouchableOpacity onPress={onDismiss} style={styles.dismissBtn} activeOpacity={0.7}>
              <Text style={styles.dismissText}>
                {isCooldown ? `${daysLeft}日後に使う` : '今はやめておく'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#0d1226',
    borderWidth: 1,
    borderColor: 'rgba(107,140,255,0.22)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.50,
    shadowRadius: 32,
    elevation: 20,
  },
  topAccent: {
    height: 2,
    width: '100%',
  },
  content: {
    padding: 24,
    gap: 14,
    alignItems: 'center',
  },
  headline: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginTop: 4,
  },
  subtext: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 20,
  },
  features: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(107,140,255,0.15)',
    overflow: 'hidden',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  featureRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(107,140,255,0.12)',
  },
  featureText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.82)',
    fontWeight: '500',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  price: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
  },
  pricePer: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.50)',
    fontWeight: '500',
  },
  upgradeBtn: {
    width: '100%',
    backgroundColor: Colors.brand.primary,
    borderRadius: 30,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
  },
  upgradeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  dismissBtn: {
    paddingVertical: 6,
  },
  dismissText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.32)',
  },
});
