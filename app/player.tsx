import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { GradientBackground, PolarisOrb } from '@components/ui';
import { useBriefingStore } from '@stores/briefingStore';
import { speechService, SPEECH_RATES, type SpeechRate } from '@services/speechService';
import { Colors } from '@constants/colors';
import type { BriefingChapter } from '@services/briefingService';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function chapterAtTime(chapters: BriefingChapter[], sec: number): BriefingChapter | null {
  let active: BriefingChapter | null = null;
  for (const ch of chapters) {
    if (sec >= ch.startSec) active = ch;
  }
  return active;
}

// ── Waveform bar ───────────────────────────────────────────────────────────────

function WaveBar({ index, progress }: { index: number; progress: number }) {
  const heights = [18, 28, 22, 36, 24, 40, 20, 32, 26, 44, 22, 38, 18, 30, 42, 24, 36, 20, 28, 16,
                   34, 26, 44, 20, 38, 24, 32, 18, 42, 28, 36, 22, 40, 26, 34, 20, 28, 44, 18, 36];
  const h      = heights[index % heights.length];
  const active = index / 40 < progress;
  return (
    <View style={[styles.waveBar, { height: h }, active ? styles.waveBarActive : styles.waveBarInactive]} />
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function PlayerScreen() {
  const { script } = useBriefingStore();

  // Playback state
  const [isPlaying,  setIsPlaying]  = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec,   setTotalSec]   = useState(script?.estimatedSeconds ?? 0);
  const [rate,       setRate]       = useState(1.0);

  const playerRef  = useRef<AudioPlayer | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAudio    = !!script?.audioUri;

  const progress       = totalSec > 0 ? currentSec / totalSec : 0;
  const activeChapter  = script ? chapterAtTime(script.chapters, currentSec) : null;

  // Setup audio or speech
  useEffect(() => {
    if (!script) return;

    if (isAudio) {
      setupAudioPlayer(script.audioUri!);
    } else {
      startSpeech();
    }

    return () => cleanup();
  }, []);

  async function setupAudioPlayer(uri: string) {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
    const p = createAudioPlayer({ uri }, { updateInterval: 500 });
    playerRef.current = p;

    p.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      setCurrentSec(status.currentTime ?? 0);
      if (status.duration) setTotalSec(status.duration);
      setIsPlaying(status.playing);
      if (status.didJustFinish) {
        setIsPlaying(false);
        setCurrentSec(0);
      }
    });

    p.play();
    setIsPlaying(true);
  }

  async function startSpeech() {
    if (!script) return;
    setIsPlaying(true);
    setCurrentSec(0);
    setTotalSec(script.estimatedSeconds);

    // Track progress via timer (expo-speech has no position callback)
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000 / rate;
      setCurrentSec(Math.min(elapsed, script.estimatedSeconds));
    }, 300);

    await speechService.speak(script.fullText, rate as SpeechRate, {
      onDone:  () => { setIsPlaying(false); clearInterval(timerRef.current!); },
      onError: () => { setIsPlaying(false); clearInterval(timerRef.current!); },
    });
  }

  function cleanup() {
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.remove();
      playerRef.current = null;
    }
    clearInterval(timerRef.current!);
    speechService.stop();
  }

  const handlePlayPause = useCallback(async () => {
    if (isAudio && playerRef.current) {
      if (isPlaying) {
        playerRef.current.pause();
      } else {
        playerRef.current.play();
      }
    } else {
      if (isPlaying) {
        await speechService.stop();
        clearInterval(timerRef.current!);
        setIsPlaying(false);
      } else {
        await startSpeech();
      }
    }
  }, [isPlaying, isAudio]);

  const handleSkip = useCallback(async (deltaSec: number) => {
    if (isAudio && playerRef.current) {
      const newPos = Math.max(0, Math.min(currentSec + deltaSec, totalSec));
      await playerRef.current.seekTo(newPos);
    }
  }, [isAudio, currentSec, totalSec]);

  const handleBack = useCallback(async () => {
    cleanup();
    router.back();
  }, []);

  async function cycleRate() {
    const idx     = SPEECH_RATES.indexOf(rate as SpeechRate);
    const newRate = SPEECH_RATES[(idx + 1) % SPEECH_RATES.length];
    setRate(newRate);
    if (isAudio && playerRef.current) {
      playerRef.current.setPlaybackRate(newRate);
    }
  }

  if (!script) {
    return (
      <GradientBackground>
        <SafeAreaView style={styles.safe}>
          <View style={styles.empty}>
            <Text style={styles.emptyText}>ホーム画面からブリーフィングを生成してください</Text>
            <TouchableOpacity onPress={() => router.back()} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>戻る</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </GradientBackground>
    );
  }

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe}>
        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={handleBack} style={styles.navBtn}>
            <Ionicons name="chevron-down" size={26} color={Colors.text.primary} />
          </TouchableOpacity>
          <View style={styles.navCenter}>
            <Text style={styles.navTitle}>Daily Brief</Text>
            <Text style={styles.navSub}>
              {new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })} • {formatTime(totalSec)}
            </Text>
          </View>
          <TouchableOpacity style={styles.navBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color={Colors.text.secondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Orb */}
          <View style={styles.orbWrap}>
            <PolarisOrb size={160} animate={isPlaying} />
          </View>

          {/* Voice label */}
          <View style={styles.voiceRow}>
            <Ionicons name="sparkles" size={12} color={Colors.brand.primary} />
            <Text style={styles.voiceLabel}>
              {isAudio ? 'AI Voice • Polaris' : '音声合成 • Polaris'}
            </Text>
          </View>

          {/* Title */}
          <View style={styles.titleArea}>
            <Text style={styles.trackTitle}>{script.topic}</Text>
            {activeChapter && (
              <Text style={styles.trackSub}>{activeChapter.text.slice(0, 60)}...</Text>
            )}
          </View>

          {/* Waveform */}
          <View style={styles.waveform}>
            {Array.from({ length: 40 }, (_, i) => (
              <WaveBar key={i} index={i} progress={progress} />
            ))}
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

          {/* Chapter tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chapScroll}>
            <View style={styles.chapRow}>
              {script.chapters.map((ch) => {
                const active = activeChapter?.id === ch.id;
                return (
                  <TouchableOpacity
                    key={ch.id}
                    style={[styles.chapChip, active && styles.chapChipActive]}
                    onPress={() => {
                      if (isAudio && playerRef.current) {
                        playerRef.current.seekTo(ch.startSec);
                      }
                    }}
                  >
                    <Ionicons
                      name={ch.iconName as any}
                      size={11}
                      color={active ? '#fff' : Colors.text.secondary}
                    />
                    <Text style={[styles.chapText, active && styles.chapTextActive]}>
                      {ch.title}
                    </Text>
                    <Text style={[styles.chapTime, active && styles.chapTimeActive]}>
                      {formatTime(ch.startSec)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Controls */}
          <View style={styles.controls}>
            {/* Speed */}
            <TouchableOpacity onPress={cycleRate} style={styles.sideControl}>
              <Text style={styles.rateText}>{rate}x</Text>
            </TouchableOpacity>

            {/* Skip back 15 */}
            <TouchableOpacity onPress={() => handleSkip(-15)} style={styles.skipBtn}>
              <Ionicons name="play-back" size={20} color={Colors.text.secondary} />
              <Text style={styles.skipLabel}>15</Text>
            </TouchableOpacity>

            {/* Play / Pause */}
            <TouchableOpacity onPress={handlePlayPause} style={styles.playBtn} activeOpacity={0.85}>
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={32}
                color="#fff"
                style={!isPlaying ? { marginLeft: 4 } : undefined}
              />
            </TouchableOpacity>

            {/* Skip forward 15 */}
            <TouchableOpacity onPress={() => handleSkip(15)} style={styles.skipBtn}>
              <Ionicons name="play-forward" size={20} color={Colors.text.secondary} />
              <Text style={styles.skipLabel}>15</Text>
            </TouchableOpacity>

            {/* Save */}
            <TouchableOpacity style={styles.sideControl}>
              <Ionicons name="bookmark-outline" size={22} color={Colors.text.secondary} />
            </TouchableOpacity>
          </View>

          {/* Bottom actions */}
          <View style={styles.bottomActions}>
            <TouchableOpacity style={styles.actionChip}>
              <Ionicons name="list-outline" size={14} color={Colors.text.secondary} />
              <Text style={styles.actionChipText}>ソース</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionChip}>
              <Ionicons name="albums-outline" size={14} color={Colors.text.secondary} />
              <Text style={styles.actionChipText}>チャプター</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:  { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emptyText: { fontSize: 15, color: Colors.text.secondary, textAlign: 'center' },
  emptyBtn:  { backgroundColor: Colors.brand.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  navBtn:    { width: 40, alignItems: 'center' },
  navCenter: { alignItems: 'center', gap: 2 },
  navTitle:  { fontSize: 15, fontWeight: '700', color: Colors.text.primary },
  navSub:    { fontSize: 11, color: Colors.text.tertiary, fontWeight: '500' },

  content: {
    paddingHorizontal: 28,
    paddingBottom: 40,
    gap: 20,
    alignItems: 'center',
  },

  // Orb
  orbWrap: { height: 200, alignItems: 'center', justifyContent: 'center' },

  // Voice label
  voiceRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voiceLabel:{ fontSize: 12, color: Colors.brand.primary, fontWeight: '600' },

  // Title
  titleArea: { alignItems: 'center', gap: 6, width: '100%' },
  trackTitle:{ fontSize: 22, fontWeight: '800', color: Colors.text.primary, letterSpacing: -0.5, textAlign: 'center' },
  trackSub:  { fontSize: 13, color: Colors.text.secondary, textAlign: 'center', lineHeight: 19 },

  // Waveform
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    width: '100%',
    height: 50,
    justifyContent: 'center',
  },
  waveBar: { width: 3, borderRadius: 2 },
  waveBarActive:   { backgroundColor: '#EF7F7F' },
  waveBarInactive: { backgroundColor: 'rgba(107,140,255,0.20)' },

  // Progress
  progressSection: { width: '100%', gap: 8 },
  progressTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(107,140,255,0.15)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: Colors.brand.primary,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { fontSize: 11, color: Colors.text.tertiary, fontWeight: '500' },

  // Chapter tabs
  chapScroll: { width: '100%' },
  chapRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chapChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  chapChipActive: { backgroundColor: Colors.brand.primary },
  chapText: { fontSize: 11, color: Colors.text.secondary, fontWeight: '500' },
  chapTextActive: { color: '#fff', fontWeight: '600' },
  chapTime: { fontSize: 10, color: Colors.text.tertiary },
  chapTimeActive: { color: 'rgba(255,255,255,0.80)' },

  // Controls
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    width: '100%',
  },
  sideControl: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  skipLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: Colors.text.tertiary,
    position: 'absolute',
    bottom: 6,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.40,
    shadowRadius: 16,
    elevation: 8,
  },
  rateText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text.secondary,
  },

  // Bottom actions
  bottomActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  actionChipText: {
    fontSize: 13,
    color: Colors.text.secondary,
    fontWeight: '500',
  },
});
