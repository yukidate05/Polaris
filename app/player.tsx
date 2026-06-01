import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AuroraBackground } from '@components/ui';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useBriefingStore } from '@stores/briefingStore';
import { speechService, SPEECH_RATES, type SpeechRate } from '@services/speechService';
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

  const [isPlaying,  setIsPlaying]  = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec,   setTotalSec]   = useState(script?.estimatedSeconds ?? 0);
  const [rate,       setRate]       = useState(1.0);

  const playerRef = useRef<AudioPlayer | null>(null);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAudio   = !!script?.audioUri;

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
    let idx = 0;
    for (let i = 0; i < dialogueTurns.length; i++) {
      if (currentSec >= dialogueTurns[i].startSec) idx = i;
      else break;
    }
    return idx;
  }, [currentSec, dialogueTurns]);

  const prevTurn = activeTurnIdx > 0 ? dialogueTurns[activeTurnIdx - 1] : null;
  const currTurn = activeTurnIdx >= 0 ? dialogueTurns[activeTurnIdx] : null;
  const nextTurn = activeTurnIdx >= 0 && activeTurnIdx < dialogueTurns.length - 1
    ? dialogueTurns[activeTurnIdx + 1] : null;

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

  // ── Audio setup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!script) return;
    if (isAudio) setupAudioPlayer(script.audioUri!);
    else startSpeech();
    return () => cleanup();
  }, []);

  async function setupAudioPlayer(uri: string) {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
    const p = createAudioPlayer({ uri }, { updateInterval: 250 });
    playerRef.current = p;
    p.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      setCurrentSec(status.currentTime ?? 0);
      if (status.duration) setTotalSec(status.duration);
      setIsPlaying(status.playing);
      if (status.didJustFinish) { setIsPlaying(false); setCurrentSec(0); }
    });
    p.play();
    setIsPlaying(true);
  }

  async function startSpeech() {
    if (!script) return;
    setIsPlaying(true); setCurrentSec(0); setTotalSec(script.estimatedSeconds);
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setCurrentSec(Math.min((Date.now() - startTime) / 1000 / rate, script.estimatedSeconds));
    }, 250);
    await speechService.speak(script.fullText, rate as SpeechRate, {
      onDone:  () => { setIsPlaying(false); clearInterval(timerRef.current!); },
      onError: () => { setIsPlaying(false); clearInterval(timerRef.current!); },
    });
  }

  function cleanup() {
    if (playerRef.current) { playerRef.current.pause(); playerRef.current.remove(); playerRef.current = null; }
    clearInterval(timerRef.current!);
    speechService.stop();
  }

  const handlePlayPause = useCallback(async () => {
    if (isAudio && playerRef.current) {
      isPlaying ? playerRef.current.pause() : playerRef.current.play();
    } else {
      if (isPlaying) { await speechService.stop(); clearInterval(timerRef.current!); setIsPlaying(false); }
      else await startSpeech();
    }
  }, [isPlaying, isAudio]);

  const handleSkip = useCallback(async (deltaSec: number) => {
    if (isAudio && playerRef.current)
      await playerRef.current.seekTo(Math.max(0, Math.min(currentSec + deltaSec, totalSec)));
  }, [isAudio, currentSec, totalSec]);

  async function cycleRate() {
    const newRate = SPEECH_RATES[(SPEECH_RATES.indexOf(rate as SpeechRate) + 1) % SPEECH_RATES.length];
    setRate(newRate);
    if (isAudio && playerRef.current) playerRef.current.setPlaybackRate(newRate);
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
          <TouchableOpacity onPress={() => { cleanup(); router.back(); }} style={styles.navBtn}>
            <Ionicons name="chevron-down" size={26} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
          <View style={styles.navCenter}>
            <Text style={styles.navTitle}>Daily Brief</Text>
            <Text style={styles.navSub}>
              {new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })} • {formatTime(totalSec)}
            </Text>
          </View>
          <TouchableOpacity style={styles.navBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>

        {/* ── 3-slot subtitle area ─────────────────────────────────────── */}
        <View style={styles.subtitleArea}>

          {/* Prev turn — dim, top */}
          <View style={styles.prevSlot}>
            {prevTurn ? (
              <Text style={styles.prevText} numberOfLines={5}>{prevTurn.text}</Text>
            ) : null}
          </View>

          {/* Current turn — bright, center */}
          <Animated.View style={[styles.currSlot, { opacity: fadeAnim }]}>
            {currTurn ? (
              <>
                <View style={styles.activeDot} />
                <Text style={styles.currText}>{currTurn.text}</Text>
              </>
            ) : null}
          </Animated.View>

          {/* Next turn — dim, bottom */}
          <View style={styles.nextSlot}>
            {nextTurn ? (
              <>
                <View style={styles.inactiveDot} />
                <Text style={styles.nextText} numberOfLines={5}>{nextTurn.text}</Text>
              </>
            ) : null}
          </View>

          {/* Edge fades */}
          <LinearGradient colors={['rgba(13,17,23,1)', 'rgba(13,17,23,0)']} style={styles.fadeTop}    pointerEvents="none" />
          <LinearGradient colors={['rgba(13,17,23,0)', 'rgba(13,17,23,1)']} style={styles.fadeBottom} pointerEvents="none" />
        </View>

        {/* ── Bottom controls ──────────────────────────────────────────── */}
        <View style={styles.bottomPanel}>

          <View style={styles.voiceRow}>
            <Ionicons name="sparkles" size={11} color={Colors.brand.primary} />
            <Text style={styles.voiceLabel}>AI Voice • Polaris</Text>
          </View>

          {/* Progress */}
          <View style={styles.progressSection}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
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
                    onPress={() => { if (isAudio && playerRef.current) playerRef.current.seekTo(ch.startSec); }}
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
            <TouchableOpacity onPress={cycleRate} style={styles.sideControl}>
              <Text style={styles.rateText}>{rate}x</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleSkip(-15)} style={styles.skipBtn}>
              <Ionicons name="play-back" size={20} color="rgba(255,255,255,0.6)" />
              <Text style={styles.skipLabel}>15</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handlePlayPause} style={styles.playBtn} activeOpacity={0.85}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color="#0A0A0A"
                style={!isPlaying ? { marginLeft: 4 } : undefined} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleSkip(15)} style={styles.skipBtn}>
              <Ionicons name="play-forward" size={20} color="rgba(255,255,255,0.6)" />
              <Text style={styles.skipLabel}>15</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sideControl}>
              <Ionicons name="bookmark-outline" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
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
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  navCenter: { alignItems: 'center', gap: 2 },
  navTitle:  { fontSize: 15, fontWeight: '700', color: '#fff' },
  navSub:    { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },

  // Subtitle 3-slot
  subtitleArea: { flex: 1, position: 'relative' },

  prevSlot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 28,
    paddingBottom: 28,
    opacity: 0.28,
  },
  prevText: { fontSize: 17, color: '#fff', lineHeight: 26 },

  currSlot: {
    flex: 1.2,
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  activeDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.brand.primary },
  currText:   { fontSize: 22, fontWeight: '700', color: '#fff', lineHeight: 34 },

  nextSlot: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 28,
    opacity: 0.28,
    gap: 10,
  },
  inactiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  nextText:    { fontSize: 17, color: '#fff', lineHeight: 26 },

  fadeTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: 70 },
  fadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 70 },

  // Bottom panel
  bottomPanel: { paddingHorizontal: 20, paddingBottom: 8, gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  voiceRow:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 10 },
  voiceLabel: { fontSize: 11, color: Colors.brand.primary, fontWeight: '600' },

  progressSection: { gap: 6 },
  progressTrack:   { width: '100%', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  progressFill:    { height: '100%', borderRadius: 2, backgroundColor: Colors.brand.primary },
  timeRow:         { flexDirection: 'row', justifyContent: 'space-between' },
  timeText:        { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },

  chapRow:        { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chapChip:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)' },
  chapChipActive: { backgroundColor: Colors.brand.primary },
  chapText:       { fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: '500' },
  chapTextActive: { color: '#fff', fontWeight: '600' },
  chapTime:       { fontSize: 10, color: 'rgba(255,255,255,0.3)' },
  chapTimeActive: { color: 'rgba(255,255,255,0.80)' },

  controls:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  sideControl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  skipBtn:     { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  skipLabel:   { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.4)', position: 'absolute', bottom: 6 },
  playBtn: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.30, shadowRadius: 16, elevation: 8,
  },
  rateText: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
});
