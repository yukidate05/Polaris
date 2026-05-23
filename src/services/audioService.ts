import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import { usePlayerStore } from '@stores/playerStore';
import { Episode } from '@models/index';

let player: AudioPlayer | null = null;

async function configureAudioSession() {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'duckOthers',
  });
}

function onStatusUpdate(status: AudioStatus) {
  const store = usePlayerStore.getState();

  // currentTime and duration are in seconds in expo-audio
  store.setPosition(status.currentTime * 1000);
  if (status.duration) {
    store.setDuration(status.duration * 1000);
  }

  if (status.playing) {
    store.setStatus('playing');
  } else if (status.isBuffering) {
    store.setStatus('loading');
  } else if (status.isLoaded) {
    store.setStatus('paused');
  }

  // Update current chapter based on position
  const { episode } = store;
  if (episode?.chapters.length) {
    const chapter = [...episode.chapters]
      .reverse()
      .find((c) => status.currentTime >= c.startSec);
    store.setCurrentChapter(chapter ?? null);
  }
}

export const audioService = {
  async load(episode: Episode): Promise<void> {
    if (!episode.audioUrl) return;

    await this.unload();
    await configureAudioSession();

    const store = usePlayerStore.getState();
    store.setEpisode(episode);

    player = createAudioPlayer({ uri: episode.audioUrl }, { updateInterval: 500 });
    player.addListener('playbackStatusUpdate', onStatusUpdate);
    store.setStatus('paused');
  },

  play(): void {
    player?.play();
  },

  pause(): void {
    player?.pause();
  },

  togglePlayPause(): void {
    const { status } = usePlayerStore.getState();
    if (status === 'playing') {
      this.pause();
    } else {
      this.play();
    }
  },

  async seekTo(positionMs: number): Promise<void> {
    await player?.seekTo(positionMs / 1000);
  },

  setRate(rate: number): void {
    if (!player) return;
    player.setPlaybackRate(rate);
    usePlayerStore.getState().setPlaybackRate(rate);
  },

  async skipForward(seconds = 30): Promise<void> {
    const { positionMs } = usePlayerStore.getState();
    await this.seekTo(positionMs + seconds * 1000);
  },

  async skipBackward(seconds = 15): Promise<void> {
    const { positionMs } = usePlayerStore.getState();
    await this.seekTo(Math.max(0, positionMs - seconds * 1000));
  },

  unload(): void {
    if (player) {
      player.remove();
      player = null;
    }
    usePlayerStore.getState().reset();
  },
};
