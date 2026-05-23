import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '@constants/colors';

interface TopicTagProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

export function TopicTag({ label, selected = false, onPress }: TopicTagProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.tag, selected && styles.tagSelected]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tag: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    marginRight: 8,
    marginBottom: 8,
  },
  tagSelected: {
    backgroundColor: Colors.brand.primary,
    borderColor: Colors.brand.primary,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text.secondary,
  },
  labelSelected: {
    color: '#fff',
  },
});
