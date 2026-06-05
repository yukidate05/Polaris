import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

const TRACKS = {
  morning: [
    require('../../assets/bgm/morning/Cedar Steam.mp3'),
    require('../../assets/bgm/morning/Cedar Steam2.mp3'),
    require('../../assets/bgm/morning/Coffee Circuit.mp3'),
    require('../../assets/bgm/morning/Coffee Circuit2.mp3'),
  ],
  afternoon: [
    require('../../assets/bgm/afternoon/Snowgrain Sonata.mp3'),
    require('../../assets/bgm/afternoon/Snowgrain Sonata2.mp3'),
    require('../../assets/bgm/afternoon/Sunlight Spreads.mp3'),
    require('../../assets/bgm/afternoon/Sunlight Spreads2.mp3'),
  ],
  evening: [
    require('../../assets/bgm/evening/Midnight Coffee Code.mp3'),
    require('../../assets/bgm/evening/Midnight Coffee Code2.mp3'),
    require('../../assets/bgm/evening/Midnight Espresso.mp3'),
    require('../../assets/bgm/evening/Midnight Espresso 2.mp3'),
  ],
};

const BGM_VOLUME = 0.4;
const FADE_DURATION_MS = 1500;
const FADE_STEPS = 30;

function getTimeSlot(): keyof typeof TRACKS {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  return 'evening';
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

let _player: AudioPlayer | null = null;
let _session = 0;

async function play(): Promise<void> {
  const session = ++_session;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'duckOthers',
    });
    // 古い呼び出しや stop() が割り込んでいたらキャンセル
    if (session !== _session || _player) return;
    const track = pickRandom(TRACKS[getTimeSlot()]);
    const player = createAudioPlayer(track);
    player.volume = BGM_VOLUME;
    player.loop = true;
    player.play();
    _player = player;
  } catch (e) {
    console.warn('[bgm] play error:', e);
  }
}

async function fadeOutAndStop(): Promise<void> {
  const p = _player;
  if (!p) return;
  _player = null;

  const stepInterval = FADE_DURATION_MS / FADE_STEPS;
  for (let i = FADE_STEPS - 1; i >= 0; i--) {
    try { p.volume = (i / FADE_STEPS) * BGM_VOLUME; } catch {}
    await new Promise((r) => setTimeout(r, stepInterval));
  }
  try { p.remove(); } catch {}
}

function stop(): void {
  _session++; // 進行中のplay()をキャンセル
  const p = _player;
  if (!p) return;
  _player = null;
  try { p.remove(); } catch {}
}

export const bgmService = { play, fadeOutAndStop, stop };
