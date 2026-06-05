import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@constants/colors';

export interface AlertButton {
  text:     string;
  style?:   'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface Props {
  visible:    boolean;
  title:      string;
  message?:   string;
  buttons:    AlertButton[];
  onDismiss?: () => void;
}

export function PolarisAlert({ visible, title, message, buttons, onDismiss }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss} />

        <View style={styles.card}>
          {/* accent line at top */}
          <LinearGradient
            colors={[Colors.brand.primary, Colors.aurora.teal]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.topAccent}
          />

          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View style={styles.divider} />

          {buttons.map((btn, i) => (
            <TouchableOpacity
              key={i}
              style={[
                styles.btn,
                i < buttons.length - 1 && styles.btnBorder,
                btn.style === 'destructive' && styles.btnDestructive,
              ]}
              onPress={btn.onPress}
              activeOpacity={0.65}
            >
              <Text style={[
                styles.btnText,
                btn.style === 'cancel'      && styles.btnTextCancel,
                btn.style === 'destructive' && styles.btnTextDestructive,
              ]}>
                {btn.text}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 36,
  },
  card: {
    width: '100%',
    maxWidth: 320,
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
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 6,
    letterSpacing: -0.2,
  },
  message: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
    lineHeight: 21,
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  btn: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.09)',
  },
  btnDestructive: {
    backgroundColor: 'rgba(239,68,68,0.07)',
  },
  btnText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.brand.primary,
  },
  btnTextCancel: {
    color: 'rgba(255,255,255,0.42)',
    fontWeight: '400',
  },
  btnTextDestructive: {
    color: Colors.error,
    fontWeight: '600',
  },
});
