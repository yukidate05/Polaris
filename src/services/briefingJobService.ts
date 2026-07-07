// Client interface to the server-side briefing generation worker.
//
// The client builds the briefing prompt locally (memory / session / Google /
// external-tool data all live client-side), submits it as a job document at
// users/{uid}/briefingJobs/current, and observes the same document while the
// briefingWorker Cloud Function does all slow work (script gen, news gen, TTS).
// Because the job survives an Android process kill, reopening the app resumes
// from the job's current state instead of re-generating (and re-billing).
import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp,
  type Unsubscribe, type Timestamp,
} from 'firebase/firestore';
import { db } from '@lib/firebase';
import { claudeService, type ChapterDraft, type DialogueTurn } from './claudeService';
import { getSelectedHosts, DEFAULT_HOST_IDS } from './voiceService';
import type { PreparedBriefingInputs } from './briefingService';

export type BriefingJobStatus =
  | 'queued' | 'stage_a' | 'tts_pending' | 'stage_b'
  | 'news_tts_pending' | 'stage_c' | 'completed' | 'error';

export interface BriefingJob {
  jobId:      string;
  status:     BriefingJobStatus;
  createdAt?: Timestamp;
  script?:    { chapters: ChapterDraft[]; dialogue: DialogueTurn[]; estimatedSeconds: number };
  audioUrl?:            string;
  audioEngine?:         'gemini' | 'google';
  audioDurationSec?:    number | null;
  news?:      { chapters: ChapterDraft[]; dialogue: DialogueTurn[]; estimatedSeconds: number; targetMinutes: number };
  newsTheme?:           string;
  newsAudioUrl?:        string;
  newsAudioEngine?:     'gemini' | 'google';
  newsAudioDurationSec?: number | null;
  newsError?:           string;
  error?:               string;
}

function jobRef(uid: string) {
  return doc(db, 'users', uid, 'briefingJobs', 'current');
}

export async function submitBriefingJob(
  uid: string,
  prepared: PreparedBriefingInputs,
  opts: {
    userName:  string;
    language:  string;
    interests: string[];
    topEmails: { from: string; subject: string }[];
    hostIds?:  string[];
    isPro:     boolean;
  },
): Promise<string> {
  const { prompt, systemPrompt } = await claudeService.buildBriefingPrompt(prepared.params);
  const [hostA, hostB] = getSelectedHosts(opts.hostIds ?? DEFAULT_HOST_IDS);

  const jobId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await setDoc(jobRef(uid), {
    jobId,
    status:    'queued',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    payload: {
      scriptPrompt:       prompt,
      scriptSystemPrompt: systemPrompt,
      language:           opts.language,
      userName:           opts.userName,
      interests:          opts.interests,
      topEmails:          opts.topEmails.map(e => ({ from: e.from, subject: e.subject })),
      hostNames:        { A: hostA.name,        B: hostB.name },
      hostVoices:       { A: hostA.voice,       B: hostB.voice },
      hostStyles:       { A: hostA.style,       B: hostB.style },
      hostDescriptions: { A: hostA.description, B: hostB.description },
      isPro:              opts.isPro,
    },
  });
  return jobId;
}

export async function getCurrentJob(uid: string): Promise<BriefingJob | null> {
  try {
    const snap = await getDoc(jobRef(uid));
    return snap.exists() ? (snap.data() as BriefingJob) : null;
  } catch {
    return null;
  }
}

export function subscribeBriefingJob(
  uid: string,
  cb: (job: BriefingJob | null) => void,
): Unsubscribe {
  return onSnapshot(jobRef(uid), (snap) => {
    cb(snap.exists() ? (snap.data() as BriefingJob) : null);
  }, (err) => {
    console.warn('[briefingJob] snapshot error:', err);
  });
}
