// Core game types

export type GameMode = 'career' | 'timeTrial' | 'obstacle' | 'freestyle' | 'multiplayer';
export type GameState = 'menu' | 'loading' | 'playing' | 'paused' | 'finished' | 'crashed' | 'countdown';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog' | 'sandstorm';
export type TimeOfDay = 'sunrise' | 'morning' | 'noon' | 'afternoon' | 'sunset' | 'night';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlaneState {
  position: Vec3;
  velocity: Vec3;
  rotation: Vec3; // pitch, yaw, roll
  speed: number;
  throttle: number;
  health: number;
  maxHealth: number;
  boost: number;
  maxBoost: number;
  altitude: number;
  gForce: number;
  stalling: boolean;
  damage: number;
  activePowerup: PowerupType | null;
  powerupTimer: number;
  trailPoints: Vec3[];
}

export interface Checkpoint {
  id: number;
  position: Vec3;
  radius: number;
  passed: boolean;
  isFinish: boolean;
  nextDirection: Vec3;
}

export interface Obstacle {
  id: number;
  position: Vec3;
  size: Vec3;
  type: 'static' | 'moving' | 'destructible';
  movePattern?: { axis: 'x' | 'y' | 'z'; range: number; speed: number };
  health?: number;
  destroyed?: boolean;
}

export type PowerupType = 'nitro' | 'shield' | 'lightning' | 'magnet' | 'timeSlow' | 'ghost' | 'tornado' | 'doublePoints' | 'repair' | 'mystery';

export interface Powerup {
  id: number;
  type: PowerupType;
  position: Vec3;
  collected: boolean;
  respawnTimer: number;
  active: boolean;
}

export interface Track {
  id: string;
  name: string;
  description: string;
  difficulty: Difficulty;
  checkpoints: Checkpoint[];
  obstacles: Obstacle[];
  powerups: Powerup[];
  startPosition: Vec3;
  bounds: { min: Vec3; max: Vec3 };
  weather: Weather;
  timeOfDay: TimeOfDay;
  laps: number;
  parTime: number;
  starTimes: [number, number, number];
  environment: 'city' | 'desert' | 'ocean' | 'mountains' | 'space';
}

export interface Mission {
  id: number;
  title: string;
  description: string;
  trackId: string;
  mode: GameMode;
  objectives: MissionObjective[];
  reward: { xp: number; coins: number; unlock?: string };
  completed: boolean;
  stars: number;
  locked: boolean;
}

export interface MissionObjective {
  type: 'finish' | 'time' | 'collect' | 'noDamage' | 'tricks' | 'position';
  target: number;
  current: number;
  description: string;
}

export interface LiveryConfig {
  id: string;
  name: string;
  baseColor: string;
  accentColor: string;
  pattern: string;
  unlockLevel: number;
  unlockCost: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  unlocked: boolean;
}

export interface TrailEffect {
  id: string;
  name: string;
  color: string;
  particleType: string;
  unlockLevel: number;
  unlocked: boolean;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  progress: number;
  target: number;
  unlocked: boolean;
  hidden: boolean;
  reward: { xp: number; coins: number };
}

export interface PlayerProfile {
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
  coins: number;
  gems: number;
  selectedLivery: string;
  selectedTrail: string;
  totalRaces: number;
  totalWins: number;
  totalPlayTime: number;
  bestTimes: Record<string, number>;
  achievements: Achievement[];
  unlockedLiveries: string[];
  unlockedTrails: string[];
  dailyMissions: DailyMission[];
  settings: GameSettings;
}

export interface DailyMission {
  id: string;
  description: string;
  progress: number;
  target: number;
  reward: { coins: number; xp: number };
  completed: boolean;
  claimed: boolean;
}

export interface GameSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  sensitivity: number;
  invertY: boolean;
  showFPS: boolean;
  showMinimap: boolean;
  particleQuality: 'low' | 'medium' | 'high';
  cameraMode: 'chase' | 'cockpit' | 'cinematic';
  colorblindMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  reducedMotion: boolean;
  highContrast: boolean;
  hudScale: number;
  hudOpacity: number;
}

export interface RaceResult {
  position: number;
  time: number;
  bestLap: number;
  coins: number;
  xp: number;
  stars: number;
  checkpointsPassed: number;
  totalCheckpoints: number;
  damagesTaken: number;
  powerupsCollected: number;
  tricksPerformed: number;
  topSpeed: number;
  averageSpeed: number;
}

export interface AIOpponent {
  id: string;
  name: string;
  livery: string;
  difficulty: Difficulty;
  personality: 'aggressive' | 'defensive' | 'balanced';
  position: Vec3;
  rotation: Vec3;
  speed: number;
  currentCheckpoint: number;
  progress: number;
}

export interface MultiplayerRoom {
  code: string;
  host: string;
  players: MultiplayerPlayer[];
  maxPlayers: number;
  trackId: string;
  status: 'lobby' | 'racing' | 'finished';
  isPublic: boolean;
}

export interface MultiplayerPlayer {
  id: string;
  name: string;
  livery: string;
  position: Vec3;
  rotation: Vec3;
  speed: number;
  ready: boolean;
  ping: number;
  finished: boolean;
  finishTime?: number;
}

export interface WeatherState {
  current: Weather;
  intensity: number;
  windDirection: Vec3;
  windSpeed: number;
  visibility: number;
  precipitation: number;
  lightningTimer: number;
}

export interface Notification {
  id: string;
  type: 'achievement' | 'levelUp' | 'unlock' | 'info' | 'warning';
  title: string;
  message: string;
  icon: string;
  timestamp: number;
  duration: number;
}

export const POWERUP_INFO: Record<PowerupType, { emoji: string; name: string; duration: number; description: string; color: string }> = {
  nitro: { emoji: '🔥', name: 'Nitro Boost', duration: 3, description: '300% speed burst', color: '#ff4400' },
  shield: { emoji: '🛡️', name: 'Shield', duration: 10, description: 'Absorb next collision', color: '#00d4ff' },
  lightning: { emoji: '⚡', name: 'Lightning', duration: 0, description: 'Stun nearby opponents', color: '#ffcc00' },
  magnet: { emoji: '🎯', name: 'Magnet', duration: 8, description: 'Auto-collect nearby coins', color: '#ff3366' },
  timeSlow: { emoji: '⏱️', name: 'Time Freeze', duration: 5, description: 'Slow down time', color: '#9d4edd' },
  ghost: { emoji: '👻', name: 'Ghost', duration: 3, description: 'Fly through obstacles', color: '#aaaaff' },
  tornado: { emoji: '🌪️', name: 'Tornado', duration: 5, description: 'Create air vortex', color: '#88ccff' },
  doublePoints: { emoji: '💎', name: 'Double Points', duration: 10, description: '2x score multiplier', color: '#ffd700' },
  repair: { emoji: '🔧', name: 'Repair', duration: 0, description: 'Fix all damage', color: '#00ff88' },
  mystery: { emoji: '🎲', name: 'Mystery Box', duration: 0, description: 'Random powerup', color: '#ff88ff' },
};

export const LIVERIES: LiveryConfig[] = [
  { id: 'default', name: 'Default Red', baseColor: '#ff3333', accentColor: '#ffffff', pattern: 'solid', unlockLevel: 0, unlockCost: 0, rarity: 'common', unlocked: true },
  { id: 'military', name: 'Military Camo', baseColor: '#4a5d23', accentColor: '#2d3a14', pattern: 'camo', unlockLevel: 5, unlockCost: 500, rarity: 'common', unlocked: false },
  { id: 'racing', name: 'Racing Stripes', baseColor: '#0066ff', accentColor: '#ffffff', pattern: 'stripes', unlockLevel: 10, unlockCost: 750, rarity: 'rare', unlocked: false },
  { id: 'galaxy', name: 'Galaxy Paint', baseColor: '#1a0033', accentColor: '#9d4edd', pattern: 'galaxy', unlockLevel: 15, unlockCost: 1000, rarity: 'rare', unlocked: false },
  { id: 'chrome', name: 'Chrome Finish', baseColor: '#c0c0c0', accentColor: '#e0e0e0', pattern: 'chrome', unlockLevel: 20, unlockCost: 1500, rarity: 'epic', unlocked: false },
  { id: 'stealth', name: 'Stealth Black', baseColor: '#111111', accentColor: '#333333', pattern: 'matte', unlockLevel: 25, unlockCost: 2000, rarity: 'epic', unlocked: false },
  { id: 'neonCyan', name: 'Neon Cyan', baseColor: '#00d4ff', accentColor: '#004466', pattern: 'neon', unlockLevel: 8, unlockCost: 600, rarity: 'rare', unlocked: false },
  { id: 'neonPink', name: 'Neon Pink', baseColor: '#ff3366', accentColor: '#660022', pattern: 'neon', unlockLevel: 12, unlockCost: 600, rarity: 'rare', unlocked: false },
  { id: 'neonGreen', name: 'Neon Green', baseColor: '#00ff88', accentColor: '#004422', pattern: 'neon', unlockLevel: 16, unlockCost: 600, rarity: 'rare', unlocked: false },
  { id: 'neonPurple', name: 'Neon Purple', baseColor: '#9d4edd', accentColor: '#330066', pattern: 'neon', unlockLevel: 22, unlockCost: 600, rarity: 'rare', unlocked: false },
  { id: 'gold', name: 'Gold Luxury', baseColor: '#ffd700', accentColor: '#ff8c00', pattern: 'metallic', unlockLevel: 30, unlockCost: 3000, rarity: 'legendary', unlocked: false },
  { id: 'carbon', name: 'Carbon Fiber', baseColor: '#222222', accentColor: '#444444', pattern: 'carbon', unlockLevel: 18, unlockCost: 1200, rarity: 'epic', unlocked: false },
  { id: 'holographic', name: 'Holographic', baseColor: '#ff00ff', accentColor: '#00ffff', pattern: 'holo', unlockLevel: 35, unlockCost: 4000, rarity: 'legendary', unlocked: false },
  { id: 'lightning', name: 'Lightning Bolt', baseColor: '#ffcc00', accentColor: '#1a1042', pattern: 'lightning', unlockLevel: 28, unlockCost: 2500, rarity: 'epic', unlocked: false },
  { id: 'rainbow', name: 'RGB Rainbow', baseColor: '#ff0000', accentColor: '#00ff00', pattern: 'rainbow', unlockLevel: 50, unlockCost: 10000, rarity: 'legendary', unlocked: false },
];

export const TRAIL_EFFECTS: TrailEffect[] = [
  { id: 'default', name: 'Classic White', color: '#ffffff', particleType: 'smoke', unlockLevel: 0, unlocked: true },
  { id: 'fire', name: 'Fire Trail', color: '#ff4400', particleType: 'fire', unlockLevel: 5, unlocked: false },
  { id: 'rainbow', name: 'Rainbow', color: '#ff0000', particleType: 'rainbow', unlockLevel: 10, unlocked: false },
  { id: 'stars', name: 'Star Trail', color: '#ffcc00', particleType: 'star', unlockLevel: 15, unlocked: false },
  { id: 'electric', name: 'Electric Sparks', color: '#00d4ff', particleType: 'spark', unlockLevel: 20, unlocked: false },
  { id: 'ice', name: 'Ice Crystals', color: '#88ddff', particleType: 'crystal', unlockLevel: 25, unlocked: false },
  { id: 'hearts', name: 'Hearts', color: '#ff3366', particleType: 'heart', unlockLevel: 30, unlocked: false },
  { id: 'music', name: 'Music Notes', color: '#9d4edd', particleType: 'note', unlockLevel: 35, unlocked: false },
  { id: 'binary', name: 'Binary Code', color: '#00ff88', particleType: 'text', unlockLevel: 40, unlocked: false },
  { id: 'custom', name: 'Custom Color', color: '#ffffff', particleType: 'smoke', unlockLevel: 45, unlocked: false },
];
