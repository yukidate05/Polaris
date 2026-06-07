import Svg, { Path } from 'react-native-svg';

// Chatwork ロゴの4枚花びら（ティアドロップ×4を90°ずつ回転）
const PETAL = 'M 12 12 C 12 6 9.5 1.5 6.5 1.5 C 2 1.5 1.5 6 1.5 6.5 C 1.5 9.5 6 12 12 12 Z';

interface Props {
  size?:  number;
  color?: string;
}

export function ChatworkIcon({ size = 17, color = 'rgba(255,255,255,0.7)' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PETAL} fill={color} />
      <Path d={PETAL} fill={color} transform="rotate(90, 12, 12)" />
      <Path d={PETAL} fill={color} transform="rotate(180, 12, 12)" />
      <Path d={PETAL} fill={color} transform="rotate(270, 12, 12)" />
    </Svg>
  );
}
