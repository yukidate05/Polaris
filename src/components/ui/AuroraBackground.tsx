import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// ── Time-of-day aurora themes ──────────────────────────────────────────────────

interface BandColors {
  colors: string[];
  opMin:  number;
  opMax:  number;
}

interface AuroraTheme {
  bg:    string;
  base:  string[];
  bands: BandColors[];
}

function getTheme(hour: number): AuroraTheme {
  if (hour >= 5 && hour < 10) {
    // Morning: warm pink / gold / soft orange
    return {
      bg:   '#120810',
      base: ['#0E060A', '#160A10', '#0E0608'],
      bands: [
        { colors: ['transparent','rgba(255,150,80,0.58)','rgba(255,90,130,0.40)','transparent'],  opMin:0.20, opMax:0.85 },
        { colors: ['transparent','rgba(255,70,150,0.52)','rgba(210,110,255,0.36)','transparent'], opMin:0.15, opMax:0.72 },
        { colors: ['transparent','rgba(255,190,90,0.48)','rgba(255,130,55,0.34)','transparent'],  opMin:0.12, opMax:0.68 },
        { colors: ['transparent','rgba(180,90,255,0.44)','rgba(255,70,170,0.36)','transparent'],  opMin:0.18, opMax:0.76 },
      ],
    };
  }
  if (hour >= 10 && hour < 17) {
    // Daytime: bright cyan / sky blue / teal
    return {
      bg:   '#030a18',
      base: ['#030816', '#060e24', '#040a18'],
      bands: [
        { colors: ['transparent','rgba(0,210,255,0.58)','rgba(0,155,255,0.40)','transparent'],    opMin:0.18, opMax:0.82 },
        { colors: ['transparent','rgba(0,255,225,0.52)','rgba(0,185,255,0.36)','transparent'],    opMin:0.15, opMax:0.70 },
        { colors: ['transparent','rgba(110,205,255,0.46)','rgba(0,225,205,0.34)','transparent'],  opMin:0.12, opMax:0.65 },
        { colors: ['transparent','rgba(0,185,255,0.44)','rgba(85,245,205,0.36)','transparent'],   opMin:0.20, opMax:0.78 },
      ],
    };
  }
  if (hour >= 17 && hour < 21) {
    // Evening: purple / magenta / deep blue
    return {
      bg:   '#080414',
      base: ['#060210', '#0A0418', '#060210'],
      bands: [
        { colors: ['transparent','rgba(155,45,255,0.60)','rgba(210,75,255,0.42)','transparent'],  opMin:0.20, opMax:0.86 },
        { colors: ['transparent','rgba(255,45,190,0.52)','rgba(155,75,255,0.40)','transparent'],  opMin:0.15, opMax:0.72 },
        { colors: ['transparent','rgba(105,0,255,0.50)','rgba(205,95,255,0.34)','transparent'],   opMin:0.12, opMax:0.68 },
        { colors: ['transparent','rgba(255,75,210,0.44)','rgba(125,35,255,0.36)','transparent'],  opMin:0.18, opMax:0.76 },
      ],
    };
  }
  // Night (21-5): classic aurora — green / teal / blue
  return {
    bg:   '#020610',
    base: ['#030816', '#060e24', '#040a18'],
    bands: [
      { colors: ['transparent','rgba(0,230,180,0.60)','rgba(0,180,230,0.40)','transparent'],    opMin:0.18, opMax:0.85 },
      { colors: ['transparent','rgba(60,100,255,0.55)','rgba(120,220,255,0.38)','transparent'],  opMin:0.15, opMax:0.72 },
      { colors: ['transparent','rgba(150,50,255,0.50)','rgba(80,210,255,0.32)','transparent'],   opMin:0.12, opMax:0.65 },
      { colors: ['transparent','rgba(0,255,140,0.45)','rgba(0,210,190,0.35)','transparent'],     opMin:0.20, opMax:0.78 },
    ],
  };
}

// Band spatial layout (same for all themes)
const POSITIONS = [
  { start:{x:0.0, y:0.08}, end:{x:1.0, y:0.55}, drift:[-28, 18] as [number,number], dur:7200,  delay:0    },
  { start:{x:0.05,y:0.20}, end:{x:0.95,y:0.68}, drift:[ 20,-22] as [number,number], dur:9400,  delay:1800 },
  { start:{x:0.12,y:0.06}, end:{x:0.88,y:0.60}, drift:[-15, 30] as [number,number], dur:8100,  delay:3400 },
  { start:{x:0.18,y:0.26}, end:{x:0.82,y:0.72}, drift:[ 12,-18] as [number,number], dur:10600, delay:900  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function AuroraBackground() {
  const theme = getTheme(new Date().getHours());
  const anims = useRef(POSITIONS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = POSITIONS.map((pos, i) => {
      const steps: Animated.CompositeAnimation[] = [];
      if (pos.delay > 0) steps.push(Animated.delay(pos.delay));
      steps.push(Animated.timing(anims[i], { toValue: 1, duration: pos.dur, useNativeDriver: true }));
      steps.push(Animated.timing(anims[i], { toValue: 0, duration: pos.dur, useNativeDriver: true }));
      return Animated.loop(Animated.sequence(steps));
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]}>
      <LinearGradient
        colors={theme.base as string[]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      {POSITIONS.map((pos, i) => {
        const band    = theme.bands[i];
        const opacity = anims[i].interpolate({ inputRange:[0,1], outputRange:[band.opMin, band.opMax] });
        const translateY = anims[i].interpolate({ inputRange:[0,1], outputRange:pos.drift });
        return (
          <Animated.View key={i} style={[StyleSheet.absoluteFill, { opacity, transform:[{translateY}] }]}>
            <LinearGradient
              colors={band.colors}
              start={pos.start}
              end={pos.end}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}
