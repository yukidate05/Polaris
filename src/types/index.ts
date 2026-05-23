// ─── User ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  uid:         string;
  email:       string | null;
  displayName: string | null;
  photoURL:    string | null;
  plan:        SubscriptionPlan;
  locale:      string;
  timezone:    string;
  createdAt:   Date;
  updatedAt:   Date;
}

export type SubscriptionPlan = 'free' | 'plus' | 'pro';

// ─── Episode / Briefing ───────────────────────────────────────────────────────

export type EpisodeType = 'daily_brief' | 'deepcast' | 'live_station';
export type EpisodeStatus = 'queued' | 'generating' | 'ready' | 'failed';

export interface Episode {
  id:          string;
  userId:      string;
  type:        EpisodeType;
  title:       string;
  summary:     string;
  audioUrl:    string | null;
  durationSec: number;
  status:      EpisodeStatus;
  chapters:    Chapter[];
  topics:      string[];
  thumbnailUrl:string | null;
  createdAt:   Date;
}

export interface Chapter {
  id:       string;
  title:    string;
  startSec: number;
  endSec:   number;
}

// ─── Source Connections ───────────────────────────────────────────────────────

export type SourceProvider =
  | 'google_calendar'
  | 'gmail'
  | 'slack'
  | 'notion'
  | 'chatwork'
  | 'discord'
  | 'google_drive'
  | 'rss';

export interface SourceConnection {
  id:         string;
  userId:     string;
  provider:   SourceProvider;
  status:     'connected' | 'disconnected' | 'error';
  lastSyncAt: Date | null;
  createdAt:  Date;
}

// ─── Audio Player ─────────────────────────────────────────────────────────────

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface PlayerState {
  episode:        Episode | null;
  status:         PlayerStatus;
  positionMs:     number;
  durationMs:     number;
  playbackRate:   number;
  currentChapter: Chapter | null;
}

// ─── User Preferences ─────────────────────────────────────────────────────────

export interface UserPreferences {
  briefingTime:    string;   // HH:MM
  language:        string;   // ja, en, etc.
  voiceStyle:      string;
  notificationsEnabled: boolean;
  topicsOfInterest: string[];
}

// ─── Notification ─────────────────────────────────────────────────────────────

export interface AppNotification {
  id:        string;
  title:     string;
  body:      string;
  type:      'briefing_ready' | 'agent_alert' | 'system';
  read:      boolean;
  createdAt: Date;
}
