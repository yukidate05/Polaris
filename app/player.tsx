import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, PanResponder, Dimensions, AppState,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AuroraBackground } from '@components/ui';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useBriefingStore } from '@stores/briefingStore';
import type { NewsSegment } from '@stores/briefingStore';
import { useAuthStore } from '@stores/authStore';
import { speechService, SPEECH_RATES, type SpeechRate } from '@services/speechService';
import { sessionService } from '@services/sessionService';
import { Colors } from '@constants/colors';
import type { BriefingChapter } from '@services/briefingService';

const CURR_LINE_H  = 34;
const CURR_LINES   = 5;
const FAR_H        = 72; // compact height for far turns (3 lines × lineHeight 20 + breathing room)

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

type PlayPhase = 'briefing' | 'transition' | 'news';

export default function PlayerScreen() {
  const { script, newsSegment, transitionAudioUri, newsStatus } = useBriefingStore();
  const { user } = useAuthStore();

  const [playPhase,   setPlayPhase]   = useState<PlayPhase>('briefing');
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [currentSec,  setCurrentSec]  = useState(0);
  const [totalSec,    setTotalSec]    = useState(script?.estimatedSeconds ?? 0);
  const [rate,        setRate]        = useState(1.0);
  const [syncOffset,  setSyncOffset]  = useState(-1.0);

  const playerRef     = useRef<AudioPlayer | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const seekOffsetRef = useRef<number>(0);
  const startTimeRef  = useRef<number>(Date.now());
  const rateRef       = useRef<number>(1.0);
  const lastSeekRef   = useRef<number>(0);
  const isPlayingRef  = useRef<boolean>(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  const playPhaseRef          = useRef<PlayPhase>('briefing');
  const transitionAudioUriRef = useRef<string | null>(null);
  const newsAudioUriRef       = useRef<string | null>(null);
  const completedNaturallyRef = useRef(false); // 自然に最後まで再生されたか（cleanup時のcompletionRate=1.0用）
  useEffect(() => { playPhaseRef.current = playPhase; }, [playPhase]);
  useEffect(() => { transitionAudioUriRef.current = transitionAudioUri ?? null; }, [transitionAudioUri]);
  useEffect(() => { newsAudioUriRef.current = newsSegment?.audioUri ?? null; }, [newsSegment?.audioUri]);

  // 遷移アナウンスが実際に再生開始されたかを追跡（ニュースへの早期スキップ防止）
  const transitionHasPlayedRef = useRef(false);
  useEffect(() => {
    if (playPhase === 'transition' && isPlaying) transitionHasPlayedRef.current = true;
    if (playPhase !== 'transition') transitionHasPlayedRef.current = false;
  }, [playPhase, isPlaying]);

  // 遷移アナウンス終了後にニュースTTSが遅れて届いた場合、ニュースフェーズへ進む
  useEffect(() => {
    if (playPhase === 'transition' && !isPlaying && transitionHasPlayedRef.current && newsSegment?.audioUri) {
      setPlayPhase('news');
    }
  }, [playPhase, isPlaying, newsSegment?.audioUri]);

  // バックグラウンドから戻った時、オーディオが外部割り込みで止まっていたら再開（Problem 3対策）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const p = playerRef.current;
      if (!p) return;
      // isPlayingRef が true（再生中のはず）なのに止まっている場合のみ再開。
      // ユーザーが意図的にポーズした場合（isPlayingRef=false）は再開しない。
      try {
        if (isPlayingRef.current && !p.playing) p.play();
      } catch {}
    });
    return () => sub.remove();
  }, []);

  // フェーズごとの音声URI・データ
  const currentAudioUri = playPhase === 'briefing' ? script?.audioUri
    : playPhase === 'transition' ? transitionAudioUri
    : newsSegment?.audioUri;
  const isAudio = !!currentAudioUri;

  // refs for PanResponder (stale closure対策)
  const totalSecRef   = useRef(totalSec);
  const isAudioRef    = useRef(isAudio);
  const trackWidthRef = useRef(0);
  useEffect(() => { totalSecRef.current = totalSec; }, [totalSec]);
  useEffect(() => { isAudioRef.current  = isAudio;  }, [isAudio]);

  // subtitle scroll
  const scrollViewRef       = useRef<ScrollView>(null);
  const scrollViewHeightRef = useRef(400);
  const userScrollingRef    = useRef(false);
  const userScrollTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // slot height
  const [slotH, setSlotH] = useState(Math.round((Dimensions.get('window').height - 280) / 3));
  const slotHRef = useRef(slotH);
  useEffect(() => { slotHRef.current = slotH; }, [slotH]);

  // フェーズごとのチャプター・ダイアログ
  const activeChapters = playPhase === 'news' ? (newsSegment?.chapters ?? []) : (script?.chapters ?? []);
  const progress       = totalSec > 0 ? currentSec / totalSec : 0;
  const activeChapter  = chapterAtTime(activeChapters, currentSec);

  // ── Dialogue turns ──────────────────────────────────────────────────────────

  const dialogueTurns = useMemo(() => {
    const turns = playPhase === 'news' ? newsSegment?.dialogue : script?.dialogue;
    if (!turns?.length || totalSec === 0) return [];
    const total = turns.reduce((s, t) => s + t.text.length, 0);
    let cum = 0;
    return turns.map((t) => {
      const startSec = total > 0 ? (cum / total) * totalSec : 0;
      cum += t.text.length;
      return { ...t, startSec };
    });
  }, [playPhase, script?.dialogue, newsSegment?.dialogue, totalSec]);

  const activeTurnIdx = useMemo(() => {
    if (!dialogueTurns.length) return -1;
    const ahead = currentSec + syncOffset;
    let idx = 0;
    for (let i = 0; i < dialogueTurns.length; i++) {
      if (ahead >= dialogueTurns[i].startSec) idx = i;
      else break;
    }
    return idx;
  }, [currentSec, dialogueTurns, syncOffset]);

  // ── Auto-scroll to active turn ───────────────────────────────────────────────
  // Each turn has height=slotH, content starts after paddingTop=slotH.
  // To center turn N in the middle slot: offset = N * slotH.

  useEffect(() => {
    if (userScrollingRef.current || activeTurnIdx < 0) return;
    // Far turns use FAR_H; prev turn uses slotH. Offset = sum of heights before active turn.
    const offset = activeTurnIdx === 0 ? 0 : slotHRef.current + (activeTurnIdx - 1) * FAR_H;
    scrollViewRef.current?.scrollTo({ y: offset, animated: true });
  }, [activeTurnIdx, slotH]);

  // ── Fade animation on turn change ───────────────────────────────────────────

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

  // ── Seek (ref-stable for PanResponder) ──────────────────────────────────────

  const seekToImperative = useCallback(async (sec: number) => {
    const clamped = Math.max(0, Math.min(sec, totalSecRef.current));
    setCurrentSec(clamped);
    if (isAudioRef.current && playerRef.current) {
      const wasPlaying = isPlayingRef.current;
      lastSeekRef.current = Date.now();
      try {
        await playerRef.current.seekTo(clamped);
        if (wasPlaying) playerRef.current.play();
      } catch (e) { console.warn('[player] seekTo failed:', e); }
    } else {
      seekOffsetRef.current = clamped;
      startTimeRef.current  = Date.now();
    }
  }, []);

  const seekToRef = useRef(seekToImperative);
  useEffect(() => { seekToRef.current = seekToImperative; }, [seekToImperative]);

  // ── Scrub PanResponder ───────────────────────────────────────────────────────

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

  // ── Audio setup（フェーズ変化時に再セットアップ）──────────────────────────

  useEffect(() => {
    if (!script) return;
    let cancelled = false;

    // 前のプレイヤーを破棄
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.remove();
      playerRef.current = null;
    }
    clearInterval(timerRef.current!);
    setCurrentSec(0);

    if (currentAudioUri) {
      setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'duckOthers' })
        .catch(() => {})
        .then(() => {
        if (cancelled) return;
        try {
        const p = createAudioPlayer({ uri: currentAudioUri }, { updateInterval: 100 });
        playerRef.current = p;
        p.addListener('playbackStatusUpdate', (status: AudioStatus) => {
          // Ignore currentTime updates for 800ms after a seek to prevent snap-back
          if (Date.now() - lastSeekRef.current > 800) {
            setCurrentSec(status.currentTime ?? 0);
          }
          if (status.duration) setTotalSec(status.duration);
          setIsPlaying(status.playing);
          if (status.didJustFinish) {
            const phase      = playPhaseRef.current;
            const transUri   = transitionAudioUriRef.current;
            const newsUri    = newsAudioUriRef.current;
            if (phase === 'briefing' && transUri) {
              setPlayPhase('transition');
            } else if (phase === 'briefing' && newsUri) {
              setPlayPhase('news');
            } else if (phase === 'transition' && newsUri) {
              setPlayPhase('news');
            } else {
              // 全フェーズ終了。プレイヤーを破棄せず先頭にシーク（画面上でそのまま再再生可能にする）
              completedNaturallyRef.current = true;
              setIsPlaying(false);
              setCurrentSec(totalSecRef.current);
              if (playerRef.current) { playerRef.current.seekTo(0).catch(() => {}); }
            }
          }
        });
        p.play();
        setIsPlaying(true);
        } catch (e) {
          console.error('[player] audio setup failed:', e);
          if (playPhase === 'briefing') startSpeech();
        }
      });
    } else if (playPhase === 'briefing') {
      startSpeech();
    } else if (playPhase === 'transition') {
      // transition TTS failed — skip directly to news
      const newsUri = newsAudioUriRef.current;
      if (newsUri) setTimeout(() => setPlayPhase('news'), 300);
      else setIsPlaying(false);
    }

    return () => {
      cancelled = true;
      if (playPhase === 'briefing') cleanup();
      else {
        if (playerRef.current) { playerRef.current.pause(); playerRef.current.remove(); playerRef.current = null; }
        clearInterval(timerRef.current!);
      }
    };
  }, [playPhase]);

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
        chapterTitle:   activeChapter?.title ?? script.chapters[0]?.title ?? '',
        chapterIndex:   Math.max(0, chapterIdx),
        completionRate: completedNaturallyRef.current ? 1.0 : Math.min(1, currentSec / totalSec),
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

  const handleSkip = useCallback((deltaSec: number) => {
    seekToImperative(currentSec + deltaSec);
  }, [currentSec, seekToImperative]);

  async function cycleRate() {
    const newRate = SPEECH_RATES[(SPEECH_RATES.indexOf(rate as SpeechRate) + 1) % SPEECH_RATES.length];
    setRate(newRate); rateRef.current = newRate;
    if (isAudio && playerRef.current) playerRef.current.setPlaybackRate(newRate);
    else if (isPlaying) { seekOffsetRef.current = currentSec; startTimeRef.current = Date.now(); }
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
          <View style={{ width: 44 }} />
        </View>

        {/* ── Transition overlay（ニュースキャスト開始前アナウンス中）─────── */}
        {playPhase === 'transition' && (
          <View style={styles.transitionOverlay}>
            <Text style={styles.transitionText}>
              {newsSegment?.interestText ? `${newsSegment.interestText}\nニュースキャスト` : 'ニュースキャスト'}
            </Text>
            <Text style={styles.transitionSub}>準備中...</Text>
          </View>
        )}

        {/* ── Subtitle area: scrollable with 3-slot visual ─────────────────── */}
        {playPhase !== 'transition' && <View style={styles.subtitleArea}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.subtitleScroll}
            contentContainerStyle={{ paddingHorizontal: 28, paddingVertical: slotH }}
            showsVerticalScrollIndicator={false}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              scrollViewHeightRef.current = h;
              const s = Math.round(h / 3);
              setSlotH(s);
              slotHRef.current = s;
            }}
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
              const isPrev   = idx === activeTurnIdx - 1;
              const isNext   = idx === activeTurnIdx + 1;
              return (
                <Animated.View
                  key={idx}
                  style={[
                    { height: (isActive || isPrev || isNext) ? slotH : FAR_H, justifyContent: 'center' },
                    isActive && { opacity: fadeAnim },
                  ]}
                >
                  {isActive ? (
                    <View style={styles.currSlot}>
                      <View style={styles.activeDot} />
                      <Text style={styles.currText} numberOfLines={CURR_LINES}>{turn.text}</Text>
                    </View>
                  ) : isPrev ? (
                    <Text style={styles.prevText} numberOfLines={3}>{turn.text}</Text>
                  ) : isNext ? (
                    <Text style={styles.nextText} numberOfLines={3}>{turn.text}</Text>
                  ) : (
                    <Text style={styles.farText} numberOfLines={3}>{turn.text}</Text>
                  )}
                </Animated.View>
              );
            })}
          </ScrollView>
          <LinearGradient colors={['rgba(13,17,23,1)', 'rgba(13,17,23,0)']} style={[styles.fadeTop,    { height: slotH * 0.6 }]} pointerEvents="none" />
          <LinearGradient colors={['rgba(13,17,23,0)', 'rgba(13,17,23,1)']} style={[styles.fadeBottom, { height: slotH * 0.6 }]} pointerEvents="none" />
        </View>}

        {/* ── Bottom controls ──────────────────────────────────────────────── */}
        <View style={styles.bottomPanel}>

          <View style={styles.metaRow}>
            <View style={styles.voiceRow}>
              <Ionicons name="sparkles" size={11} color={Colors.brand.primary} />
              <Text style={styles.voiceLabel}>AI Voice • Polaris</Text>
            </View>
            <View style={styles.syncRow}>
              <TouchableOpacity
                onPress={() => setSyncOffset(v => Math.max(parseFloat((v - 0.5).toFixed(1)), -4))}
                style={styles.syncBtn}
                accessibilityLabel="字幕を遅らせる"
              >
                <Text style={styles.syncBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.syncValue}>{syncOffset > 0 ? '+' : ''}{syncOffset.toFixed(1)}s</Text>
              <TouchableOpacity
                onPress={() => setSyncOffset(v => Math.min(parseFloat((v + 0.5).toFixed(1)), 2))}
                style={styles.syncBtn}
                accessibilityLabel="字幕を早める"
              >
                <Text style={styles.syncBtnText}>＋</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Seekable progress bar */}
          <View style={styles.progressSection}>
            <View
              style={styles.progressTrack}
              onLayout={(e) => { trackWidthRef.current = e.nativeEvent.layout.width; }}
              {...scrubPanResponder.panHandlers}
            >
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
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
              {activeChapters.map((ch) => {
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

          {/* Playback controls (transition中は下の専用コントロールを使う) */}
          {playPhase !== 'transition' && (
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
          )}

        </View>

        {/* transition フェーズ中もコントロールを表示 */}
        {playPhase === 'transition' && (
          <View style={styles.controls}>
            <View style={styles.sideControl} />
            <View style={styles.skipBtn} />
            <TouchableOpacity onPress={handlePlayPause} style={styles.playBtn} activeOpacity={0.85}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color="#0A0A0A"
                style={!isPlaying ? { marginLeft: 4 } : undefined} />
            </TouchableOpacity>
            <View style={styles.skipBtn} />
            <View style={styles.sideControl} />
          </View>
        )}

      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg:   { flex: 1, backgroundColor: '#0D1117' },
  safe: { flex: 1 },
  transitionOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  transitionText:    { fontSize: 22, fontWeight: '700', color: '#fff', textAlign: 'center', lineHeight: 32 },
  transitionSub:     { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 12 },
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

  // Subtitle
  subtitleArea:   { flex: 1, position: 'relative' },
  subtitleScroll: { flex: 1 },

  // Active turn (middle slot)
  currSlot:  { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.brand.primary, marginTop: 6, flexShrink: 0 },
  currText:  { flex: 1, fontSize: 22, fontWeight: '700', color: '#fff', lineHeight: CURR_LINE_H },

  // Adjacent turns (prev = top slot, next = bottom slot)
  prevText: { fontSize: 15, color: 'rgba(255,255,255,0.35)', lineHeight: 23 },
  nextText: { fontSize: 15, color: 'rgba(255,255,255,0.35)', lineHeight: 23 },
  farText:  { fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 20 },

  fadeTop:    { position: 'absolute', top: 0,    left: 0, right: 0 },
  fadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },

  // Bottom panel
  bottomPanel: { paddingHorizontal: 20, paddingBottom: 8, gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  metaRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  voiceRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voiceLabel: { fontSize: 11, color: Colors.brand.primary, fontWeight: '600' },
  syncRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  syncBtn:    { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  syncBtnText:{ fontSize: 16, color: 'rgba(255,255,255,0.55)', lineHeight: 20 },
  syncValue:  { fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: '600', minWidth: 36, textAlign: 'center' },

  // Seekable progress
  progressSection: { gap: 8 },
  progressTrack: {
    width: '100%', height: 14, justifyContent: 'center',
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: Colors.brand.primary },
  scrubThumb: {
    position: 'absolute', width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#fff', marginLeft: -7, top: 0,
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
