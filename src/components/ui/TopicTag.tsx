import { TouchableOpacity, Text, StyleSheet } from 'react-native';

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
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    marginRight: 8,
    marginBottom: 8,
  },
  tagSelected: {
    backgroundColor: 'rgba(0,230,180,0.22)',
    borderColor: 'rgba(0,230,180,0.55)',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.65)',
  },
  labelSelected: {
    color: 'rgba(160,255,220,0.98)',
    fontWeight: '600',
  },
});
