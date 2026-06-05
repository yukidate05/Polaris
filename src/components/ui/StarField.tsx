import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, Dimensions } from 'react-native';

const { width: W, height: H } = Dimensions.get('window');

const STATIC_STARS  = 110;
const TWINKLE_STARS =  22;
const LINE_THRESH   =  58;
const MAX_LINES     = 220;

interface Star { x: number; y: number; r: number; op: number; }
interface Conn { x1: number; y1: number; x2: number; y2: number; op: number; }

function randStars(count: number, maxR = 1.6): Star[] {
  return Array.from({ length: count }, () => ({
    x:  +(Math.random() * W).toFixed(1),
    y:  +(Math.random() * H).toFixed(1),
    r:  +(Math.random() * maxR + 0.3).toFixed(2),
    op: +(Math.random() * 0.45 + 0.25).toFixed(2),
  }));
}

function buildConnections(stars: Star[]): Conn[] {
  const out: Conn[] = [];
  for (let i = 0; i < stars.length && out.length < MAX_LINES; i++) {
    for (let j = i + 1; j < stars.length && out.length < MAX_LINES; j++) {
      const dx   = stars[i].x - stars[j].x;
      const dy   = stars[i].y - stars[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < LINE_THRESH) {
        out.push({
          x1: stars[i].x, y1: stars[i].y,
          x2: stars[j].x, y2: stars[j].y,
          op: +((1 - dist / LINE_THRESH) * 0.10).toFixed(3),
        });
      }
    }
  }
  return out;
}

export function StarField() {
  const staticStars = useMemo(() => randStars(STATIC_STARS, 1.6), []);
  const twinklers   = useMemo(() => randStars(TWINKLE_STARS, 2.0), []);
  const connections = useMemo(() => buildConnections(staticStars), [staticStars]);

  const anims  = useRef(twinklers.map(() => new Animated.Value(Math.random()))).current;
  const delays = useMemo(() => twinklers.map(() => Math.random() * 3500), []);

  useEffect(() => {
    const loops = anims.map((anim, i) => {
      const dur = 1800 + Math.random() * 2800;
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delays[i]),
          Animated.timing(anim, { toValue: 1,    duration: dur * 0.5, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.06, duration: dur * 0.5, useNativeDriver: true }),
        ])
      );
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* 接続線（回転Viewで描画） */}
      {connections.map((c, i) => {
        const dx     = c.x2 - c.x1;
        const dy     = c.y2 - c.y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle  = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={`l${i}`}
            style={{
              position:        'absolute',
              left:            (c.x1 + c.x2) / 2 - length / 2,
              top:             (c.y1 + c.y2) / 2 - 0.5,
              width:           length,
              height:          1,
              backgroundColor: '#ffffff',
              opacity:         c.op,
              transform:       [{ rotate: `${angle}deg` }],
            }}
          />
        );
      })}

      {/* 静的な星 */}
      {staticStars.map((s, i) => (
        <View
          key={`s${i}`}
          style={{
            position:        'absolute',
            left:            s.x - s.r,
            top:             s.y - s.r,
            width:           s.r * 2,
            height:          s.r * 2,
            borderRadius:    s.r,
            backgroundColor: '#ffffff',
            opacity:         s.op,
          }}
        />
      ))}

      {/* 点滅する星 */}
      {twinklers.map((s, i) => (
        <Animated.View
          key={`t${i}`}
          style={{
            position:        'absolute',
            left:            s.x - s.r,
            top:             s.y - s.r,
            width:           s.r * 2,
            height:          s.r * 2,
            borderRadius:    s.r,
            backgroundColor: '#ffffff',
            opacity:         anims[i],
          }}
        />
      ))}
    </View>
  );
}
