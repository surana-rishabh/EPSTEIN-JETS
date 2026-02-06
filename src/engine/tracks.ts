import type { Track, Checkpoint, Obstacle, Powerup, Mission } from './types';
import { vec3 } from './physics';

function makeCircularTrack(
  id: string, name: string, description: string,
  radius: number, checkpointCount: number, height: number,
  difficulty: 'easy' | 'medium' | 'hard',
  environment: Track['environment'],
  obstacleCount: number, powerupCount: number,
  laps: number, parTime: number
): Track {
  const checkpoints: Checkpoint[] = [];
  const obstacles: Obstacle[] = [];
  const powerups: Powerup[] = [];

  for (let i = 0; i < checkpointCount; i++) {
    const angle = (i / checkpointCount) * Math.PI * 2;
    const variation = Math.sin(angle * 3) * radius * 0.2;
    const r = radius + variation;
    checkpoints.push({
      id: i,
      position: vec3(Math.cos(angle) * r, height + Math.sin(angle * 2) * 20, Math.sin(angle) * r),
      radius: 15,
      passed: false,
      isFinish: i === 0,
      nextDirection: vec3(
        -Math.sin(angle + Math.PI / checkpointCount),
        0,
        Math.cos(angle + Math.PI / checkpointCount)
      ),
    });
  }

  for (let i = 0; i < obstacleCount; i++) {
    const angle = (i / obstacleCount) * Math.PI * 2 + 0.5;
    const r = radius + (Math.random() - 0.5) * 30;
    const isMoving = Math.random() > 0.5 && difficulty !== 'easy';
    obstacles.push({
      id: i,
      position: vec3(Math.cos(angle) * r, height + Math.random() * 20 - 10, Math.sin(angle) * r),
      size: vec3(5 + Math.random() * 5, 5 + Math.random() * 5, 5 + Math.random() * 5),
      type: isMoving ? 'moving' : 'static',
      movePattern: isMoving ? {
        axis: Math.random() > 0.5 ? 'y' : 'x',
        range: 10 + Math.random() * 15,
        speed: 1 + Math.random() * 2,
      } : undefined,
      health: difficulty === 'easy' ? 1 : 2,
    });
  }

  const powerupTypes: Array<import('./types').PowerupType> = ['nitro', 'shield', 'magnet', 'doublePoints', 'repair', 'ghost', 'timeSlow'];
  for (let i = 0; i < powerupCount; i++) {
    const angle = (i / powerupCount) * Math.PI * 2 + 1;
    const r = radius + (Math.random() - 0.5) * 20;
    powerups.push({
      id: i,
      type: powerupTypes[i % powerupTypes.length],
      position: vec3(Math.cos(angle) * r, height + Math.random() * 10, Math.sin(angle) * r),
      collected: false,
      respawnTimer: 0,
      active: true,
    });
  }

  return {
    id, name, description, difficulty,
    checkpoints, obstacles, powerups,
    startPosition: vec3(radius, height, 0),
    bounds: {
      min: vec3(-radius * 1.5, 0, -radius * 1.5),
      max: vec3(radius * 1.5, height + 100, radius * 1.5),
    },
    weather: 'clear',
    timeOfDay: 'morning',
    laps,
    parTime,
    starTimes: [parTime, parTime * 0.8, parTime * 0.6],
    environment,
  };
}

function makeFigure8Track(
  id: string, name: string, description: string,
  size: number, checkpointCount: number, height: number,
  difficulty: 'easy' | 'medium' | 'hard',
  environment: Track['environment']
): Track {
  const checkpoints: Checkpoint[] = [];
  for (let i = 0; i < checkpointCount; i++) {
    const t = (i / checkpointCount) * Math.PI * 2;
    const x = Math.sin(t) * size;
    const z = Math.sin(t) * Math.cos(t) * size;
    const y = height + Math.sin(t * 3) * 15;
    checkpoints.push({
      id: i,
      position: vec3(x, y, z),
      radius: 15,
      passed: false,
      isFinish: i === 0,
      nextDirection: vec3(Math.cos(t), 0, Math.cos(2 * t)),
    });
  }

  return {
    id, name, description, difficulty,
    checkpoints,
    obstacles: [],
    powerups: [],
    startPosition: vec3(0, height, 0),
    bounds: { min: vec3(-size * 1.5, 0, -size * 1.5), max: vec3(size * 1.5, height + 100, size * 1.5) },
    weather: 'clear',
    timeOfDay: 'noon',
    laps: 3,
    parTime: 90,
    starTimes: [90, 72, 54],
    environment,
  };
}

export const TRACKS: Track[] = [
  makeCircularTrack('beginner_loop', 'Beginner Loop', 'A simple circular track for new pilots', 100, 8, 40, 'easy', 'city', 3, 4, 3, 60),
  makeCircularTrack('city_circuit', 'City Circuit', 'Navigate through the urban skyline', 120, 10, 50, 'easy', 'city', 5, 5, 3, 75),
  makeFigure8Track('figure_eight', 'Figure Eight', 'Cross paths on this classic track', 100, 12, 45, 'easy', 'city'),
  makeCircularTrack('desert_dash', 'Desert Dash', 'Race across scorching sands', 150, 12, 35, 'medium', 'desert', 8, 6, 3, 90),
  makeCircularTrack('ocean_run', 'Ocean Run', 'Fly over crystal waters', 130, 10, 30, 'medium', 'ocean', 6, 5, 3, 80),
  makeCircularTrack('mountain_pass', 'Mountain Pass', 'Thread through towering peaks', 140, 14, 80, 'medium', 'mountains', 10, 6, 3, 100),
  makeFigure8Track('storm_chase', 'Storm Chase', 'Battle the elements', 120, 14, 55, 'medium', 'ocean'),
  makeCircularTrack('neon_nights', 'Neon Nights', 'Glow through the night city', 110, 10, 45, 'medium', 'city', 7, 7, 3, 85),
  makeCircularTrack('canyon_run', 'Canyon Run', 'Twist through narrow canyons', 160, 16, 60, 'hard', 'desert', 12, 8, 3, 120),
  makeCircularTrack('space_orbit', 'Space Orbit', 'Race beyond the atmosphere', 180, 18, 100, 'hard', 'space', 15, 10, 3, 150),
];

export const CAREER_MISSIONS: Mission[] = [
  {
    id: 1, title: 'First Flight', description: 'Complete the beginner loop and learn the basics',
    trackId: 'beginner_loop', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'time', target: 90, current: 0, description: 'Finish in under 90 seconds' },
    ],
    reward: { xp: 100, coins: 50 }, completed: false, stars: 0, locked: false,
  },
  {
    id: 2, title: 'Ring Master', description: 'Pass through all checkpoints on City Circuit',
    trackId: 'city_circuit', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'collect', target: 10, current: 0, description: 'Collect 10 checkpoints' },
    ],
    reward: { xp: 150, coins: 75 }, completed: false, stars: 0, locked: true,
  },
  {
    id: 3, title: 'Untouched', description: 'Complete Figure Eight with no damage',
    trackId: 'figure_eight', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'noDamage', target: 0, current: 0, description: 'Take no damage' },
    ],
    reward: { xp: 200, coins: 100 }, completed: false, stars: 0, locked: true,
  },
  {
    id: 4, title: 'Desert Storm', description: 'Brave the desert winds',
    trackId: 'desert_dash', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'time', target: 120, current: 0, description: 'Finish in under 2 minutes' },
    ],
    reward: { xp: 250, coins: 125, unlock: 'military' }, completed: false, stars: 0, locked: true,
  },
  {
    id: 5, title: 'Ocean Breeze', description: 'Skim the waves on Ocean Run',
    trackId: 'ocean_run', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'time', target: 100, current: 0, description: 'Finish in under 100 seconds' },
    ],
    reward: { xp: 300, coins: 150 }, completed: false, stars: 0, locked: true,
  },
  {
    id: 6, title: 'Mountain King', description: 'Conquer the mountain peaks',
    trackId: 'mountain_pass', mode: 'obstacle',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the course' },
      { type: 'collect', target: 5, current: 0, description: 'Collect 5 powerups' },
    ],
    reward: { xp: 350, coins: 175 }, completed: false, stars: 0, locked: true,
  },
  {
    id: 7, title: 'Lightning Rider', description: 'Race through the storm',
    trackId: 'storm_chase', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'noDamage', target: 0, current: 0, description: 'Take no damage' },
    ],
    reward: { xp: 400, coins: 200, unlock: 'racing' }, completed: false, stars: 0, locked: true,
  },
  {
    id: 8, title: 'Neon Runner', description: 'Light up the night sky',
    trackId: 'neon_nights', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'time', target: 100, current: 0, description: 'Finish in under 100 seconds' },
    ],
    reward: { xp: 450, coins: 225 }, completed: false, stars: 0, locked: true,
  },
  {
    id: 9, title: 'Boss Race: Shadow', description: 'Defeat the AI Shadow pilot',
    trackId: 'canyon_run', mode: 'career',
    objectives: [
      { type: 'position', target: 1, current: 0, description: 'Finish in 1st place' },
      { type: 'time', target: 150, current: 0, description: 'Finish in under 150 seconds' },
    ],
    reward: { xp: 600, coins: 300, unlock: 'stealth' }, completed: false, stars: 0, locked: true,
  },
  {
    id: 10, title: 'Final Challenge', description: 'The ultimate test of skill',
    trackId: 'space_orbit', mode: 'career',
    objectives: [
      { type: 'position', target: 1, current: 0, description: 'Finish in 1st place' },
      { type: 'noDamage', target: 0, current: 0, description: 'Take no damage' },
      { type: 'time', target: 180, current: 0, description: 'Finish in under 3 minutes' },
    ],
    reward: { xp: 1000, coins: 500, unlock: 'gold' }, completed: false, stars: 0, locked: true,
  },
  {
    id: 11, title: 'Speed Demon', description: 'Push your speed to the limit',
    trackId: 'beginner_loop', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'time', target: 45, current: 0, description: 'Finish in under 45 seconds' },
    ],
    reward: { xp: 500, coins: 250 }, completed: false, stars: 0, locked: true,
  },
  {
    id: 12, title: 'Collector', description: 'Gather all powerups on Desert Dash',
    trackId: 'desert_dash', mode: 'obstacle',
    objectives: [
      { type: 'collect', target: 6, current: 0, description: 'Collect all 6 powerups' },
      { type: 'finish', target: 1, current: 0, description: 'Finish the course' },
    ],
    reward: { xp: 400, coins: 200 }, completed: false, stars: 0, locked: true,
  },
  {
    id: 13, title: 'Night Prowler', description: 'Master the darkness',
    trackId: 'neon_nights', mode: 'obstacle',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the course' },
      { type: 'noDamage', target: 0, current: 0, description: 'Take no damage' },
    ],
    reward: { xp: 500, coins: 250, unlock: 'neonCyan' }, completed: false, stars: 0, locked: true,
  },
  {
    id: 14, title: 'Canyon Legend', description: 'Set a record on Canyon Run',
    trackId: 'canyon_run', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'time', target: 100, current: 0, description: 'Finish in under 100 seconds' },
    ],
    reward: { xp: 700, coins: 350 }, completed: false, stars: 0, locked: true,
  },
  {
    id: 15, title: 'Space Ace', description: 'Conquer the final frontier',
    trackId: 'space_orbit', mode: 'timeTrial',
    objectives: [
      { type: 'finish', target: 1, current: 0, description: 'Finish the race' },
      { type: 'time', target: 120, current: 0, description: 'Finish in under 2 minutes' },
      { type: 'noDamage', target: 0, current: 0, description: 'Take no damage' },
    ],
    reward: { xp: 1500, coins: 750, unlock: 'rainbow' }, completed: false, stars: 0, locked: true,
  },
];

export function resetTrack(track: Track): Track {
  return {
    ...track,
    checkpoints: track.checkpoints.map(cp => ({ ...cp, passed: false })),
    obstacles: track.obstacles.map(obs => ({ ...obs, destroyed: false })),
    powerups: track.powerups.map(pu => ({ ...pu, collected: false, respawnTimer: 0, active: true })),
  };
}

export function getNextCheckpoint(checkpoints: Checkpoint[]): Checkpoint | null {
  return checkpoints.find(cp => !cp.passed) || null;
}

export function getCheckpointProgress(checkpoints: Checkpoint[]): number {
  const passed = checkpoints.filter(cp => cp.passed).length;
  return passed / checkpoints.length;
}
