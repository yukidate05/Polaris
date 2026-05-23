import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@constants/colors';
import { BorderRadius } from '@constants/index';

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
        activeOpacity={0.85}
        style={[fullWidth && { width: '100%' }, style]}
      >
        <LinearGradient
          colors={['#4ECDC4', '#0D9488']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.base, styles.primary, isDisabled && styles.disabled]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={[styles.primaryText, textStyle]}>{label}</Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  if (variant === 'secondary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[
          styles.base,
          styles.secondary,
          isDisabled && styles.disabled,
          fullWidth && { width: '100%' },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={Colors.brand.primary} size="small" />
        ) : (
          <Text style={[styles.secondaryText, textStyle]}>{label}</Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[isDisabled && styles.disabled, style]}
    >
      <Text style={[styles.ghostText, textStyle]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: BorderRadius['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primary: {},
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.brand.primary,
  },
  disabled: {
    opacity: 0.5,
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  secondaryText: {
    color: Colors.brand.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  ghostText: {
    color: Colors.text.secondary,
    fontSize: 15,
    fontWeight: '500',
  },
});
