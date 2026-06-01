import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';

interface ButtonProps {
  onPress: () => void;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export function Button({
  onPress,
  label,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
  fullWidth = true,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.88}
        style={[
          styles.base,
          styles.primary,
          isDisabled && styles.disabled,
          fullWidth && { width: '100%' },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#000" size="small" />
        ) : (
          <Text style={[styles.primaryText, textStyle]}>{label}</Text>
        )}
      </TouchableOpacity>
    );
  }

  if (variant === 'secondary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.80}
        style={[
          styles.base,
          styles.secondary,
          isDisabled && styles.disabled,
          fullWidth && { width: '100%' },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="rgba(255,255,255,0.8)" size="small" />
        ) : (
          <Text style={[styles.secondaryText, textStyle]}>{label}</Text>
        )}
      </TouchableOpacity>
    );
  }

  // Ghost
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.65}
      style={[isDisabled && styles.disabled, style]}
    >
      <Text style={[styles.ghostText, textStyle]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Circular icon button (Huxe-style ×, ←, settings) ─────────────────────────
interface CircleButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  size?: number;
  style?: ViewStyle;
}

export function CircleButton({ onPress, children, size = 38, style }: CircleButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  // Huxe primary: solid white pill, dark text
  primary: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryText: {
    color: '#0A0A0A',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  // Dark glass secondary
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  secondaryText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 16,
    fontWeight: '600',
  },

  // Ghost — subtle white text
  ghostText: {
    color: 'rgba(255,255,255,0.50)',
    fontSize: 15,
    fontWeight: '500',
  },

  disabled: { opacity: 0.45 },
});
