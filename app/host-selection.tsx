import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Animated, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Asset } from 'expo-asset';
import { GradientBackground } from '@components/ui';
import { HOSTS, type Host } from '@services/voiceService';
import { useUserPreferencesStore } from '@stores/userPreferencesStore';
import { Colors } from '@constants/colors';

// ── ローカルMP3アセット（assets/voices/ に配置）──────────────────────────────
// Google AI Studio で各ボイスのサンプル音声を生成し、
// assets/voices/{id}.mp3 として保存してください
const VOICE_ASSETS: Record<string, any> = {
  aria:  require('../assets/voices/aria.mp3'),
  kai:   require('../assets/voices/kai.mp3'),
  luna:  require('../assets/voices/luna.mp3'),
  nova:  require('../assets/voices/nova.mp3'),
  crest: require('../assets/voices/crest.mp3'),
  ember: require('../assets/voices/ember.mp3'),
  drift: require('../assets/voices/drift.mp3'),
  sage:  require('../assets/voices/sage.mp3'),
};


// ── AvatarCircle ──────────────────────────────────────────────────────────────

function AvatarCircle({ host, size = 52 }: { host: Host; size?: number }) {
  return (
    <View style={[styles.avatarWrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <LinearGradient
        colors={host.colors as [string, string]}
        start={{ x: 0.15, y: 0.1 }}
        end={{ x: 0.85, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={[styles.avatarLetter, { fontSize: size * 0.38 }]}>
        {host.name[0]}
      </Text>
    </View>
  );
}

// ── HostRow ───────────────────────────────────────────────────────────────────

function HostRow({
  host,
  selectionIndex,
  onToggle,
  onPreview,
  isPlaying,
  isLoading,
  disabled,
}: {
  host: Host;
  selectionIndex: number;
  onToggle: () => void;
  onPreview: () => void;
  isPlaying: boolean;
  isLoading: boolean;
  disabled: boolean;
}) {
  const selected = selectionIndex >= 0;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const playAnim  = useRef(new Animated.Value(1)).current;

  // Bounce on select
  useEffect(() => {
    if (selected) {
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 0.96, duration: 80, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 200 }),
      ]).start();
    }
  }, [selected]);

  // Play button pulse
  useEffect(() => {
    if (isPlaying) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(playAnim, { toValue: 0.7, duration: 500, useNativeDriver: true }),
          Animated.timing(playAnim, { toValue: 1,   duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      playAnim.setValue(1);
    }
  }, [isPlaying]);

  const roleLabel = selectionIndex === 0 ? 'MC-A' : selectionIndex === 1 ? 'MC-B' : null;

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        activeOpacity={0.80}
        onPress={onToggle}
        disabled={disabled && !selected}
        style={[styles.hostRow, selected && { borderColor: host.colors[0] + '66' }]}
      >
        {/* Glass blur */}
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[styles.hostRowBg, selected && { backgroundColor: host.colors[1] + '14' }]} />

        {/* Selection badge */}
        <View style={styles.badgeWrap}>
          {selected ? (
            <LinearGradient
              colors={host.colors as [string, string]}
              style={styles.badgeFilled}
            >
              <Text style={styles.badgeLabel}>{roleLabel}</Text>
            </LinearGradient>
          ) : (
            <View style={[styles.badgeEmpty, disabled && { opacity: 0.3 }]}>
              <View style={styles.badgeEmptyInner} />
            </View>
          )}
        </View>

        {/* Avatar */}
        <AvatarCircle host={host} size={48} />

        {/* Name + mood */}
        <View style={styles.hostInfo}>
          <Text style={[styles.hostName, disabled && !selected && { opacity: 0.45 }]}>
            {host.name}
          </Text>
          <Text style={[styles.hostMood, { color: host.colors[0] }, disabled && !selected && { opacity: 0.35 }]}>
            {host.mood}
          </Text>
        </View>

        {/* Preview button */}
        <TouchableOpacity
          onPress={onPreview}
          activeOpacity={0.75}
          style={styles.previewBtn}
          disabled={isLoading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Animated.View style={[styles.previewBtnInner, { opacity: playAnim }]}>
            <LinearGradient
              colors={isPlaying ? host.colors as [string, string] : ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.08)']}
              style={StyleSheet.absoluteFill}
            />
            {isLoading ? (
              <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
            ) : (
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={16}
                color={isPlaying ? '#fff' : 'rgba(255,255,255,0.7)'}
                style={isPlaying ? undefined : { marginLeft: 2 }}
              />
            )}
          </Animated.View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function HostSelectionScreen() {
  const { selectedHostIds, setSelectedHostIds } = useUserPreferencesStore();
  const [selected,  setSelected]  = useState<string[]>([...selectedHostIds]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef  = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    return () => {
      playerRef.current?.pause();
      playerRef.current?.remove();
    };
  }, []);

  function handleToggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2)  return [...prev.slice(1), id];
      return [...prev, id];
    });
  }

  const handlePreview = useCallback(async (host: Host) => {
    if (playingId === host.id) {
      playerRef.current?.pause();
      setPlayingId(null);
      return;
    }
    playerRef.current?.pause();
    playerRef.current?.remove();
    playerRef.current = null;

    const module = VOICE_ASSETS[host.id];
    if (!module) return;

    try {
      // expo-asset でローカルURIを解決してから再生
      const asset = Asset.fromModule(module);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;

      const player = createAudioPlayer({ uri });
      playerRef.current = player;
      player.addListener('playbackStatusUpdate', (status: any) => {
        if (status.didJustFinish) setPlayingId(null);
      });
      player.play();
      setPlayingId(host.id);
    } catch (e) {
      console.warn('[preview] playback failed:', host.id, e);
      setPlayingId(null);
    }
  }, [playingId]);

  function handleSave() {
    if (selected.length < 2) return;
    setSelectedHostIds(selected);
    router.back();
  }

  const canSave = selected.length === 2;

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

        {/* ── Nav ── */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>ホストを選ぶ</Text>
          <View style={styles.navBtn} />
        </View>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headlineTop}>Hosts</Text>
          <Text style={styles.subtitle}>
            2人を選んでください。先に選んだ方がMC-A（メイン）、{'\n'}
            後が MC-B（深掘り）になります
          </Text>

          {/* Selected preview chips */}
          <View style={styles.chipRow}>
            {[0, 1].map((idx) => {
              const id   = selected[idx];
              const host = HOSTS.find((h) => h.id === id);
              return (
                <View
                  key={idx}
                  style={[
                    styles.chip,
                    host ? { borderColor: host.colors[0] + '55' } : styles.chipEmpty,
                  ]}
                >
                  {host ? (
                    <>
                      <LinearGradient colors={host.colors as [string, string]} style={styles.chipDot} />
                      <Text style={[styles.chipText, { color: host.colors[0] }]}>{host.name}</Text>
                    </>
                  ) : (
                    <Text style={styles.chipPlaceholder}>MC-{idx === 0 ? 'A' : 'B'} を選択</Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Host list ── */}
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {HOSTS.map((host) => {
            const idx  = selected.indexOf(host.id);
            const full = selected.length >= 2 && idx === -1;
            return (
              <HostRow
                key={host.id}
                host={host}
                selectionIndex={idx}
                onToggle={() => handleToggle(host.id)}
                onPreview={() => handlePreview(host)}
                isPlaying={playingId === host.id}
                isLoading={false}
                disabled={full}
              />
            );
          })}
        </ScrollView>

        {/* ── Save button ── */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.88}
          >
            {canSave ? (
              <LinearGradient
                colors={['rgba(255,255,255,0.25)', 'rgba(255,255,255,0.15)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Text style={[styles.saveBtnText, !canSave && { color: 'rgba(255,255,255,0.35)' }]}>
              {canSave ? '保存する' : `あと ${2 - selected.length} 人選んでください`}
            </Text>
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </GradientBackground>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  navBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: {
    fontSize: 16, fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.2,
  },

  header: {
    paddingHorizontal: 22,
    paddingBottom: 16,
    gap: 8,
  },
  headlineTop: {
    fontSize: 36, fontWeight: '800',
    color: '#fff', letterSpacing: -1,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.50)',
    lineHeight: 19,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  chipEmpty: {
    borderColor: 'rgba(255,255,255,0.14)',
    borderStyle: 'dashed',
  },
  chipDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  chipText: {
    fontSize: 13, fontWeight: '600',
  },
  chipPlaceholder: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.28)',
    fontWeight: '500',
  },

  list: {
    paddingHorizontal: 18,
    paddingBottom: 16,
    gap: 10,
  },

  // Host row
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  hostRowBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  // Selection badge
  badgeWrap: {
    width: 30, height: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeFilled: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeLabel: {
    fontSize: 9, fontWeight: '800',
    color: '#fff', letterSpacing: 0.3,
  },
  badgeEmpty: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeEmptyInner: {
    width: 8, height: 8, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  // Avatar
  avatarWrap: {
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLetter: {
    color: '#fff', fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Host info
  hostInfo: { flex: 1, gap: 3 },
  hostName: {
    fontSize: 16, fontWeight: '700',
    color: '#fff', letterSpacing: -0.2,
  },
  hostMood: {
    fontSize: 12, fontWeight: '500',
  },

  // Preview button
  previewBtn: {
    width: 36, height: 36,
  },
  previewBtnInner: {
    width: 36, height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },

  // Footer
  footer: {
    paddingHorizontal: 22,
    paddingBottom: 8,
    paddingTop: 4,
  },
  saveBtn: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  saveBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  saveBtnText: {
    fontSize: 16, fontWeight: '700',
    color: '#fff', letterSpacing: 0.1,
  },
});
