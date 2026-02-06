import type {
  GameMode, GameState, PlayerProfile, GameSettings, Achievement,
  DailyMission, RaceResult, WeatherState, Notification, LiveryConfig,
  TrailEffect, PlaneState, Track, AIOpponent,
} from './types';
import { LIVERIES, TRAIL_EFFECTS } from './types';
import { createPlaneState, vec3 } from './physics';
import { TRACKS, CAREER_MISSIONS, resetTrack } from './tracks';
import type { Mission } from './types';

const SAVE_KEY = 'epstein_jets_save';

const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.7,
  sensitivity: 1.0,
  invertY: false,
  showFPS: false,
  showMinimap: true,
  particleQuality: 'high',
  cameraMode: 'chase',
  colorblindMode: 'none',
  reducedMotion: false,
  highContrast: false,
  hudScale: 1.0,
  hudOpacity: 0.9,
};

const DEFAULT_ACHIEVEMENTS: Achievement[] = [
  { id: 'first_flight', name: 'First Flight', description: 'Complete the tutorial', icon: '✈️', progress: 0, target: 1, unlocked: false, hidden: false, reward: { xp: 50, coins: 25 } },
  { id: 'speed_demon', name: 'Speed Demon', description: 'Reach 500 km/h', icon: '🏎️', progress: 0, target: 500, unlocked: false, hidden: false, reward: { xp: 100, coins: 50 } },
  { id: 'collector', name: 'Collector', description: 'Collect 100 coins', icon: '💰', progress: 0, target: 100, unlocked: false, hidden: false, reward: { xp: 100, coins: 100 } },
  { id: 'perfect_run', name: 'Perfect Run', description: 'Complete a race with no damage', icon: '⭐', progress: 0, target: 1, unlocked: false, hidden: false, reward: { xp: 150, coins: 75 } },
  { id: 'ring_master', name: 'Ring Master', description: 'Pass through 1000 checkpoints', icon: '🎯', progress: 0, target: 1000, unlocked: false, hidden: false, reward: { xp: 200, coins: 100 } },
  { id: 'stunt_pilot', name: 'Stunt Pilot', description: 'Perform 50 tricks', icon: '🌀', progress: 0, target: 50, unlocked: false, hidden: false, reward: { xp: 200, coins: 100 } },
  { id: 'social', name: 'Social Butterfly', description: 'Complete 10 multiplayer races', icon: '🦋', progress: 0, target: 10, unlocked: false, hidden: false, reward: { xp: 150, coins: 75 } },
  { id: 'untouchable', name: 'Untouchable', description: 'Win a race without getting hit', icon: '🛡️', progress: 0, target: 1, unlocked: false, hidden: false, reward: { xp: 300, coins: 150 } },
  { id: 'veteran', name: 'Veteran', description: 'Reach level 25', icon: '🎖️', progress: 0, target: 25, unlocked: false, hidden: false, reward: { xp: 500, coins: 250 } },
  { id: 'legend', name: 'Legend', description: 'Complete career mode', icon: '🏆', progress: 0, target: 1, unlocked: false, hidden: false, reward: { xp: 1000, coins: 500 } },
  { id: 'marathon', name: 'Marathon', description: 'Fly 100km total', icon: '🌍', progress: 0, target: 100000, unlocked: false, hidden: true, reward: { xp: 200, coins: 100 } },
  { id: 'booster', name: 'Booster', description: 'Use 100 nitro boosts', icon: '🔥', progress: 0, target: 100, unlocked: false, hidden: true, reward: { xp: 150, coins: 75 } },
  { id: 'survivor', name: 'Survivor', description: 'Survive 3 crashes in one race', icon: '💪', progress: 0, target: 3, unlocked: false, hidden: true, reward: { xp: 100, coins: 50 } },
  { id: 'night_owl', name: 'Night Owl', description: 'Complete 10 night races', icon: '🦉', progress: 0, target: 10, unlocked: false, hidden: true, reward: { xp: 200, coins: 100 } },
  { id: 'weather_warrior', name: 'Weather Warrior', description: 'Race in all weather conditions', icon: '⛈️', progress: 0, target: 7, unlocked: false, hidden: true, reward: { xp: 300, coins: 150 } },
  { id: 'powerup_master', name: 'Powerup Master', description: 'Use every powerup type', icon: '🎲', progress: 0, target: 10, unlocked: false, hidden: true, reward: { xp: 200, coins: 100 } },
  { id: 'ghost_rider', name: 'Ghost Rider', description: 'Beat your ghost 10 times', icon: '👻', progress: 0, target: 10, unlocked: false, hidden: true, reward: { xp: 250, coins: 125 } },
  { id: 'early_bird', name: 'Early Bird', description: 'Play at sunrise', icon: '🌅', progress: 0, target: 1, unlocked: false, hidden: true, reward: { xp: 100, coins: 50 } },
  { id: 'fashionista', name: 'Fashionista', description: 'Unlock 10 liveries', icon: '🎨', progress: 0, target: 10, unlocked: false, hidden: true, reward: { xp: 300, coins: 150 } },
  { id: 'completionist', name: 'Completionist', description: 'Complete all achievements', icon: '💯', progress: 0, target: 19, unlocked: false, hidden: true, reward: { xp: 2000, coins: 1000 } },
];

function generateDailyMissions(): DailyMission[] {
  const templates = [
    { desc: 'Complete 3 races', target: 3 },
    { desc: 'Collect 50 coins', target: 50 },
    { desc: 'Reach speed 300 km/h', target: 300 },
    { desc: 'Pass 20 checkpoints', target: 20 },
    { desc: 'Use 5 powerups', target: 5 },
    { desc: 'Fly 5000m total', target: 5000 },
  ];
  const selected = templates.sort(() => Math.random() - 0.5).slice(0, 3);
  return selected.map((t, i) => ({
    id: `daily_${i}`,
    description: t.desc,
    progress: 0,
    target: t.target,
    reward: { coins: 50 + i * 25, xp: 50 + i * 25 },
    completed: false,
    claimed: false,
  }));
}

function createDefaultProfile(): PlayerProfile {
  return {
    name: 'Pilot',
    level: 1,
    xp: 0,
    xpToNext: 100,
    coins: 100,
    gems: 0,
    selectedLivery: 'default',
    selectedTrail: 'default',
    totalRaces: 0,
    totalWins: 0,
    totalPlayTime: 0,
    bestTimes: {},
    achievements: [...DEFAULT_ACHIEVEMENTS],
    unlockedLiveries: ['default'],
    unlockedTrails: ['default'],
    dailyMissions: generateDailyMissions(),
    settings: { ...DEFAULT_SETTINGS },
  };
}

export interface GameStore {
  // UI state
  screen: 'mainMenu' | 'modeSelect' | 'trackSelect' | 'garage' | 'career' | 'settings' | 'achievements' | 'leaderboard' | 'game' | 'results' | 'tutorial' | 'multiplayer';
  gameState: GameState;
  gameMode: GameMode;

  // Player
  profile: PlayerProfile;

  // Active game
  currentTrack: Track | null;
  currentMission: Mission | null;
  plane: PlaneState;
  opponents: AIOpponent[];
  raceTime: number;
  lapTime: number;
  currentLap: number;
  totalLaps: number;
  countdown: number;
  raceResult: RaceResult | null;
  score: number;
  combo: number;
  comboTimer: number;

  // Weather
  weather: WeatherState;

  // UI
  notifications: Notification[];
  showTutorial: boolean;
  tutorialStep: number;
  showPause: boolean;
  fps: number;

  // Tracks & missions
  tracks: Track[];
  missions: Mission[];

  // Liveries
  liveries: LiveryConfig[];
  trails: TrailEffect[];
}

export function createStore(): GameStore {
  const saved = loadSave();
  return {
    screen: 'mainMenu',
    gameState: 'menu',
    gameMode: 'timeTrial',
    profile: saved || createDefaultProfile(),
    currentTrack: null,
    currentMission: null,
    plane: createPlaneState(),
    opponents: [],
    raceTime: 0,
    lapTime: 0,
    currentLap: 1,
    totalLaps: 3,
    countdown: 3,
    raceResult: null,
    score: 0,
    combo: 1,
    comboTimer: 0,
    weather: {
      current: 'clear',
      intensity: 0,
      windDirection: vec3(1, 0, 0),
      windSpeed: 0,
      visibility: 1000,
      precipitation: 0,
      lightningTimer: 0,
    },
    notifications: [],
    showTutorial: !saved,
    tutorialStep: 0,
    showPause: false,
    fps: 60,
    tracks: TRACKS,
    missions: saved ? loadMissions() : [...CAREER_MISSIONS],
    liveries: LIVERIES.map(l => ({
      ...l,
      unlocked: saved ? saved.unlockedLiveries.includes(l.id) : l.id === 'default',
    })),
    trails: TRAIL_EFFECTS.map(t => ({
      ...t,
      unlocked: saved ? saved.unlockedTrails.includes(t.id) : t.id === 'default',
    })),
  };
}

export function saveGame(profile: PlayerProfile, missions: Mission[]): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ profile, missions, timestamp: Date.now() }));
  } catch { /* quota exceeded */ }
}

function loadSave(): PlayerProfile | null {
  try {
    const data = localStorage.getItem(SAVE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      return parsed.profile;
    }
  } catch { /* corrupt data */ }
  return null;
}

function loadMissions(): Mission[] {
  try {
    const data = localStorage.getItem(SAVE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      return parsed.missions || [...CAREER_MISSIONS];
    }
  } catch { /* corrupt data */ }
  return [...CAREER_MISSIONS];
}

export function addXP(profile: PlayerProfile, amount: number): { profile: PlayerProfile; leveledUp: boolean } {
  const newProfile = { ...profile, xp: profile.xp + amount };
  let leveledUp = false;
  while (newProfile.xp >= newProfile.xpToNext) {
    newProfile.xp -= newProfile.xpToNext;
    newProfile.level++;
    newProfile.xpToNext = Math.floor(100 * Math.pow(1.15, newProfile.level - 1));
    leveledUp = true;
  }
  return { profile: newProfile, leveledUp };
}

export function calculateStars(time: number, starTimes: [number, number, number]): number {
  if (time <= starTimes[2]) return 3;
  if (time <= starTimes[1]) return 2;
  if (time <= starTimes[0]) return 1;
  return 0;
}

export function startRace(store: GameStore, trackId: string, mode: GameMode, missionId?: number): GameStore {
  const track = store.tracks.find(t => t.id === trackId);
  if (!track) return store;

  const resetedTrack = resetTrack(track);
  const mission = missionId !== undefined ? store.missions.find(m => m.id === missionId) || null : null;

  const opponents: AIOpponent[] = mode === 'career' ? [
    {
      id: 'ai_1', name: 'Shadow', livery: 'stealth', difficulty: 'medium',
      personality: 'balanced', position: vec3(track.startPosition.x + 15, track.startPosition.y, track.startPosition.z),
      rotation: vec3(0, 0, 0), speed: 70, currentCheckpoint: 0, progress: 0,
    },
    {
      id: 'ai_2', name: 'Blaze', livery: 'neonPink', difficulty: 'easy',
      personality: 'aggressive', position: vec3(track.startPosition.x - 15, track.startPosition.y, track.startPosition.z),
      rotation: vec3(0, 0, 0), speed: 65, currentCheckpoint: 0, progress: 0,
    },
  ] : [];

  return {
    ...store,
    screen: 'game',
    gameState: 'countdown',
    gameMode: mode,
    currentTrack: resetedTrack,
    currentMission: mission,
    plane: {
      ...createPlaneState(),
      position: { ...track.startPosition },
    },
    opponents,
    raceTime: 0,
    lapTime: 0,
    currentLap: 1,
    totalLaps: track.laps,
    countdown: 3,
    raceResult: null,
    score: 0,
    combo: 1,
    comboTimer: 0,
    showPause: false,
    weather: {
      current: track.weather,
      intensity: track.weather === 'clear' ? 0 : 0.5,
      windDirection: vec3(Math.random() - 0.5, 0, Math.random() - 0.5),
      windSpeed: track.weather === 'storm' ? 15 : track.weather === 'rain' ? 8 : 2,
      visibility: track.weather === 'fog' ? 20 : track.weather === 'rain' ? 100 : 1000,
      precipitation: track.weather === 'rain' ? 0.7 : track.weather === 'snow' ? 0.5 : 0,
      lightningTimer: track.weather === 'storm' ? 5 + Math.random() * 10 : 0,
    },
  };
}
