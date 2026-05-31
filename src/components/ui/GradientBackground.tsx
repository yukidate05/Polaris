import { View } from 'react-native';
import { AuroraBackground } from './AuroraBackground';

interface GradientBackgroundProps {
  children: React.ReactNode;
}

export function GradientBackground({ children }: GradientBackgroundProps) {
  return (
    <View style={{ flex: 1, backgroundColor: '#020610' }}>
      <AuroraBackground />
      {children}
    </View>
  );
}
