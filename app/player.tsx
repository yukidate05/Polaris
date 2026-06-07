import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, Dimensions, PanResponder,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AuroraBackground } from '@components/ui';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useBriefingStore } from '@stores/briefingStore';
import { useAuthStore } from '@stores/authStore';
import { speechService, SPEECH_RATES, type SpeechRate } from '@services/speechService';
import { sessionService } from '@services/sessionService';
import { Colors } from '@constants/colors';
import type { BriefingChapter } from '@services/briefingService';

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function chapterAtTime(chapters: BriefingChapter[], sec: number): BriefingChapter | null {
  let active: BriefingChapter | null = null;
  for (const ch of chapters) { if (sec >= ch.startSec) active = ch; }
  return active;
}

export default function PlayerScreen() {
  const { script } = useBriefingStore();
  const { user }   = useAuthStore();

  const [isPlaying,  setIsPlaying]  = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec,   setTotalSec]   = useState(script?.estimatedSeconds ?? 0);
  const [rate,       setRate]       = useState(1.0);

  const playerRef          = useRef<AudioPlayer | null>(null);
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const seekOffsetRef      = useRef<number>(0);
  const startTimeRef       = useRef<number>(Date.now());
  const rateRef            = useRef<number>(1.0);
  const isAudio            = !!script?.audioUri;

  // Refs for PanResponder (avoids stale closures)
  const totalSecRef        = useRef(totalSec);
  const isAudioRef         = useRef(isAudio);
  const trackWidthRef      = useRef(0);

  // Subtitle scroll
  const scrollViewRef      = useRef<ScrollView>(null);
  const turnLayoutsRef     = useRef<number[]>([]);
  const userScrollingRef   = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { totalSecRef.current = totalSec; }, [totalSec]);
  useEffect(() => { isAudioRef.current  = isAudio;  }, [isAudio]);

  const progress      = totalSec > 0 ? currentSec / totalSec : 0;
  const activeChapter = script ? chapterAtTime(script.chapters, currentSec) : null;

  // ── Dialogue turns with proportional timestamps ──────────────────────────────

  const dialogueTurns = useMemo(() => {
    const turns = script?.dialogue;
    if (!turns?.length || totalSec === 0) return [];
    const total = turns.reduce((s, t) => s + t.text.length, 0);
    let cum = 0;
    return turns.map((t) => {
      const startSec = total > 0 ? (cum / total) * totalSec : 0;
      cum += t.text.length;
      return { ...t, startSec };
    });
  }, [script?.dialogue, totalSec]);

  const activeTurnIdx = useMemo(() => {
    if (!dialogueTurns.length) return -1;
    const ahead = currentSec + 0.5;
    let idx = 0;
    for (let i = 0; i < dialogueTurns.length; i++) {
      if (ahead >= dialogueTurns[i].startSec) idx = i;
      else break;
    }
    return idx;
  }, [currentSec, dialogueTurns]);

  // ── Auto-scroll subtitle to active turn ──────────────────────────────────────

  useEffect(() => {
    if (userScrollingRef.current || activeTurnIdx < 0) return;
    const y = turnLayoutsRef.current[activeTurnIdx];
    if (y !== undefined) {
      scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: true });
    }
  }, [activeTurnIdx]);

  // ── Fade animation on turn change ────────────────────────────────────────────

  const fadeAnim   = useRef(new Animated.Value(1)).current;
  const prevIdxRef = useRef(activeTurnIdx);

  useEffect(() => {
    if (prevIdxRef.current === activeTurnIdx) return;
    prevIdxRef.current = activeTurnIdx;
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0.35, duration: 130, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1,    duration: 200, useNativeDriver: true }),
    ]).start();
  }, [activeTurnIdx]);

  // ── Seek imperative (ref-stable) ──────────────────────────────────────────────

  const seekToImperative = useCallback(async (newSec: number) => {
    const clamped = Math.max(0, Math.min(newSec, totalSecRef.current));
    setCurrentSec(clamped);
    if (isAudioRef.current && playerRef.current) {
      try { await playerRef.current.seekTo(clamped); } catch {}
    } else {
      seekOffsetRef.current = clamped;
      startTimeRef.current  = Date.now();
    }
  }, []);

  const seekToRef = useRef(seekToImperative);
  useEffect(() => { seekToRef.current = seekToImperative; }, [seekToImperative]);

  // ── Scrub PanResponder ────────────────────────────────────────────────────────

  const scrubPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => {
        const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / (trackWidthRef.current || 1)));
        seekToRef.current(ratio * totalSecRef.current);
      },
      onPanResponderMove: (e) => {
        const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / (trackWidthRef.current || 1)));
        seekToRef.current(ratio * totalSecRef.current);
      },
    })
  ).current;

  // ── Audio setup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!script) return;
    let cancelled = false;

    if (isAudio) {
      setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).then(() => {
        if (cancelled) return;
        const p = createAudioPlayer({ uri: script.audioUri! }, { updateInterval: 100 });
        playerRef.current = p;
        p.addListener('playbackStatusUpdate', (status: AudioStatus) => {
          setCurrentSec(status.currentTime ?? 0);
          if (status.duration) setTotalSec(status.duration);
          setIsPlaying(status.playing);
          if (status.didJustFinish) { setIsPlaying(false); setCurrentSec(0); }
        });
        p.play();
        setIsPlaying(true);
      });
    } else {
      startSpeech();
    }

    return () => { cancelled = true; cleanup(); };
  }, []);

  async function startSpeech(fromSec = 0) {
    if (!script) return;
    clearInterval(timerRef.current!);
    setIsPlaying(true); setCurrentSec(fromSec); setTotalSec(script.estimatedSeconds);
    seekOffsetRef.current = fromSec;
    startTimeRef.current  = Date.now();
    const estimatedSecs = script.estimatedSeconds;
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000 / rateRef.current;
      setCurrentSec(Math.min(seekOffsetRef.current + elapsed, estimatedSecs));
    }, 250);
    await speechService.speak(script.fullText, rateRef.current as SpeechRate, {
      onDone:  () => { setIsPlaying(false); clearInterval(timerRef.current!); },
      onError: () => { setIsPlaying(false); clearInterval(timerRef.current!); },
    });
  }

  function cleanup() {
    if (playerRef.current) { playerRef.current.pause(); playerRef.current.remove(); playerRef.current = null; }
    clearInterval(timerRef.current!);
    speechService.stop();

    if (user?.uid && script && totalSec > 0) {
      const chapterIdx   = script.chapters.indexOf(activeChapter ?? script.chapters[0]);
      const topicSummary = script.chapters.map((c) => c.title).join('、');
      sessionService.saveProgress(user.uid, {
        chapterTitle:  activeChapter?.title ?? script.chapters[0]?.title ?? '',
        chapterIndex:  Math.max(0, chapterIdx),
        completionRate: Math.min(1, currentSec / totalSec),
        topicSummary,
      });
    }
  }

  const handlePlayPause = useCallback(async () => {
    if (isAudio && playerRef.current) {
      isPlaying ? playerRef.current.pause() : playerRef.current.play();
    } else {
      if (isPlaying) { await speechService.stop(); clearInterval(timerRef.current!); setIsPlaying(false); }
      else await startSpeech(currentSec);
    }
  }, [isPlaying, isAudio, currentSec]);

  const handleSkip = useCallback(async (deltaSec: number) => {
    await seekToImperative(currentSec + deltaSec);
  }, [currentSec, seekToImperative]);

  async function cycleRate() {
    const newRate = SPEECH_RATES[(SPEECH_RATES.indexOf(rate as SpeechRate) + 1) % SPEECH_RATES.length];
    setRate(newRate);
    rateRef.current = newRate;
    if (isAudio && playerRef.current) {
      playerRef.current.setPlaybackRate(newRate);
    } else if (isPlaying) {
      seekOffsetRef.current = currentSec;
      startTimeRef.current  = Date.now();
    }
  }

  if (!script) {
    return (
      <View style={styles.bg}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.empty}>
            <Text style={styles.emptyText}>ホーム画面からブリーフィングを生成してください</Text>
            <TouchableOpacity onPress={() => router.back()} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>戻る</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.bg}>
      <AuroraBackground />
      <SafeAreaView style={styles.safe}>

        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => { cleanup(); router.back(); }} style={styles.navBtn} accessibilityLabel="閉じる">
            <Ionicons name="chevron-down" size={26} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
          <View style={styles.navCenter}>
            <Text style={styles.navTitle}>Daily Brief</Text>
            <Text style={styles.navSub}>
              {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} • {Math.ceil(totalSec / 60)}分
            </Text>
          </View>
          <View style={styles.navBtn} />
        </View>

        {/* ── Scrollable subtitle area ─────────────────────────────────────── */}
        <View style={styles.subtitleArea}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.subtitleScroll}
            contentContainerStyle={styles.subtitleContent}
            showsVerticalScrollIndicator={false}
            onScrollBeginDrag={() => {
              userScrollingRef.current = true;
              if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
            }}
            onScrollEndDrag={() => {
              if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
              userScrollTimerRef.current = setTimeout(() => { userScrollingRef.current = false; }, 4000);
            }}
            onMomentumScrollEnd={() => {
              if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
              userScrollTimerRef.current = setTimeout(() => { userScrollingRef.current = false; }, 4000);
            }}
          >
            {dialogueTurns.map((turn, idx) => {
              const isActive = idx === activeTurnIdx;
              const isPast   = idx < activeTurnIdx;
              return (
                <Animated.View
                  key={idx}
                  style={[styles.turnRow, isActive && { opacity: fadeAnim }]}
                  onLayout={(e) => { turnLayoutsRef.current[idx] = e.nativeEvent.layout.y; }}
                >
                  {isActive && <View style={styles.activeDot} />}
                  <Text style={[
                    styles.turnText,
                    isPast   && styles.turnTextPast,
                    isActive && styles.turnTextActive,
                  ]}>
                    {turn.text}
                  </Text>
                </Animated.View>
              );
            })}
          </ScrollView>
          {/* Gradient overlays on top of ScrollView */}
          <LinearGradient colors={['rgba(13,17,23,1)', 'rgba(13,17,23,0)']} style={styles.fadeTop}    pointerEvents="none" />
          <LinearGradient colors={['rgba(13,17,23,0)', 'rgba(13,17,23,1)']} style={styles.fadeBottom} pointerEvents="none" />
        </View>

        {/* ── Bottom controls ──────────────────────────────────────────── */}
        <View style={styles.bottomPanel}>

          <View style={styles.voiceRow}>
            <Ionicons name="sparkles" size={11} color={Colors.brand.primary} />
            <Text style={styles.voiceLabel}>AI Voice • Polaris</Text>
          </View>

          {/* Seekable Progress bar */}
          <View style={styles.progressSection}>
            <View
              style={styles.progressTrack}
              onLayout={(e) => { trackWidthRef.current = e.nativeEvent.layout.width; }}
              {...scrubPanResponder.panHandlers}
            >
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              {/* Scrub thumb */}
              <View style={[styles.scrubThumb, { left: `${progress * 100}%` }]} />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(currentSec)}</Text>
              <Text style={styles.timeText}>{formatTime(totalSec)}</Text>
            </View>
          </View>

          {/* Chapter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chapRow}>
              {script.chapters.map((ch) => {
                const active = activeChapter?.id === ch.id;
                return (
                  <TouchableOpacity
                    key={ch.id}
                    style={[styles.chapChip, active && styles.chapChipActive]}
                    onPress={() => seekToImperative(ch.startSec)}
                  >
                    <Ionicons name={ch.iconName as any} size={11} color={active ? '#fff' : 'rgba(255,255,255,0.45)'} />
                    <Text style={[styles.chapText, active && styles.chapTextActive]}>{ch.title}</Text>
                    <Text style={[styles.chapTime, active && styles.chapTimeActive]}>{formatTime(ch.startSec)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Playback controls */}
          <View style={styles.controls}>
            <TouchableOpacity onPress={cycleRate} style={styles.sideControl} accessibilityLabel={`再生速度 ${rate}倍`}>
              <Text style={styles.rateText}>{rate}x</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleSkip(-15)} style={styles.skipBtn} accessibilityLabel="15秒戻す">
              <Ionicons name="play-back" size={20} color="rgba(255,255,255,0.6)" />
              <Text style={styles.skipLabel}>15</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handlePlayPause} style={styles.playBtn} activeOpacity={0.85} accessibilityLabel={isPlaying ? '一時停止' : '再生'}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color="#0A0A0A"
                style={!isPlaying ? { marginLeft: 4 } : undefined} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleSkip(15)} style={styles.skipBtn} accessibilityLabel="15秒進む">
              <Ionicons name="play-forward" size={20} color="rgba(255,255,255,0.6)" />
              <Text style={styles.skipLabel}>15</Text>
            </TouchableOpacity>
            <View style={styles.sideControl} />
          </View>

        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg:   { flex: 1, backgroundColor: '#0D1117' },
  safe: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emptyText:    { fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  emptyBtn:     { backgroundColor: Colors.brand.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  navBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  navCenter: { alignItems: 'center', gap: 2 },
  navTitle:  { fontSize: 15, fontWeight: '700', color: '#fff' },
  navSub:    { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },

  // Scrollable subtitle
  subtitleArea:    { flex: 1, position: 'relative' },
  subtitleScroll:  { flex: 1 },
  subtitleContent: { paddingHorizontal: 28, paddingVertical: 160 },

  turnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 32,
    opacity: 0.28,
  },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.brand.primary, marginTop: 6, flexShrink: 0 },
  turnText: {
    flex: 1,
    fontSize: 17,
    color: '#fff',
    lineHeight: 26,
  },
  turnTextPast:   {},
  turnTextActive: { fontSize: 22, fontWeight: '700', lineHeight: 34 },

  fadeTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: 120, zIndex: 1 },
  fadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, zIndex: 1 },

  // Bottom panel
  bottomPanel: { paddingHorizontal: 20, paddingBottom: 8, gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  voiceRow:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 10 },
  voiceLabel: { fontSize: 11, color: Colors.brand.primary, fontWeight: '600' },

  progressSection: { gap: 8 },
  progressTrack: {
    width: '100%', height: 14,
    justifyContent: 'center',
    paddingVertical: 5,
  },
  progressFill: {
    height: 4, borderRadius: 2,
    backgroundColor: Colors.brand.primary,
  },
  scrubThumb: {
    position: 'absolute',
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#fff',
    marginLeft: -7,
    top: 0,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 4,
  },
  timeRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },

  chapRow:        { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chapChip:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)' },
  chapChipActive: { backgroundColor: Colors.brand.primary },
  chapText:       { fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: '500' },
  chapTextActive: { color: '#fff', fontWeight: '600' },
  chapTime:       { fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  chapTimeActive: { color: 'rgba(255,255,255,0.80)' },

  controls:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  sideControl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  skipBtn:     { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  skipLabel:   { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.4)', position: 'absolute', bottom: 6 },
  playBtn: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.30, shadowRadius: 16, elevation: 8,
  },
  rateText: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
});
