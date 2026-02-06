import type { Vec3, PlaneState, Checkpoint, Obstacle, Powerup, WeatherState, PowerupType } from './types';

export function vec3(x = 0, y = 0, z = 0): Vec3 { return { x, y, z }; }
export function addVec3(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function subVec3(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scaleVec3(v: Vec3, s: number): Vec3 { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
export function lengthVec3(v: Vec3): number { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
export function normalizeVec3(v: Vec3): Vec3 {
  const l = lengthVec3(v);
  return l > 0 ? scaleVec3(v, 1 / l) : vec3();
}
export function distVec3(a: Vec3, b: Vec3): number { return lengthVec3(subVec3(a, b)); }
export function dotVec3(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// Constants
const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;
const WING_AREA = 0.5;
const DRAG_COEFFICIENT = 0.03;
const LIFT_COEFFICIENT = 1.2;
const MAX_SPEED = 500;
const MIN_SPEED = 20;
const STALL_SPEED = 30;
const ACCELERATION = 120;
const TURN_RATE = 2.5;
const PITCH_RATE = 2.0;
const ROLL_RATE = 3.0;
const BOOST_MULTIPLIER = 3.0;
const BOOST_DRAIN_RATE = 33;
const BOOST_CHARGE_RATE = 5;

export interface PhysicsInput {
  pitch: number;    // -1 to 1
  yaw: number;      // -1 to 1
  roll: number;     // -1 to 1
  throttle: number; // 0 to 1
  boost: boolean;
  brake: boolean;
}

export function createPlaneState(): PlaneState {
  return {
    position: vec3(0, 50, 0),
    velocity: vec3(0, 0, 80),
    rotation: vec3(0, 0, 0),
    speed: 80,
    throttle: 0.5,
    health: 100,
    maxHealth: 100,
    boost: 100,
    maxBoost: 100,
    altitude: 50,
    gForce: 1,
    stalling: false,
    damage: 0,
    activePowerup: null,
    powerupTimer: 0,
    trailPoints: [],
  };
}

export function updatePhysics(
  plane: PlaneState,
  input: PhysicsInput,
  dt: number,
  weather: WeatherState,
  timeFactor: number = 1
): PlaneState {
  const effectiveDt = dt * timeFactor;
  const newPlane = { ...plane };

  // Throttle
  newPlane.throttle = Math.max(0, Math.min(1, input.throttle));

  // Calculate thrust
  let thrust = newPlane.throttle * ACCELERATION;
  if (input.boost && newPlane.boost > 0) {
    thrust *= BOOST_MULTIPLIER;
    newPlane.boost = Math.max(0, newPlane.boost - BOOST_DRAIN_RATE * effectiveDt);
  } else if (!input.boost) {
    newPlane.boost = Math.min(newPlane.maxBoost, newPlane.boost + BOOST_CHARGE_RATE * effectiveDt);
  }

  // Brake
  if (input.brake) {
    thrust *= 0.3;
  }

  // Speed calculation with drag
  const dragForce = 0.5 * AIR_DENSITY * DRAG_COEFFICIENT * WING_AREA * newPlane.speed * newPlane.speed;
  const liftForce = 0.5 * AIR_DENSITY * LIFT_COEFFICIENT * WING_AREA * newPlane.speed * newPlane.speed;

  newPlane.speed += (thrust - dragForce * 0.01) * effectiveDt;

  // Weather effects on handling
  let weatherTurnMod = 1.0;
  let weatherDragMod = 1.0;
  if (weather.current === 'rain') { weatherTurnMod = 0.8; weatherDragMod = 1.1; }
  if (weather.current === 'storm') { weatherTurnMod = 0.6; weatherDragMod = 1.2; }
  if (weather.current === 'snow') { weatherTurnMod = 0.7; weatherDragMod = 1.05; }

  newPlane.speed *= (1 - (weatherDragMod - 1) * effectiveDt);

  // Stall check
  newPlane.stalling = newPlane.speed < STALL_SPEED;
  if (newPlane.stalling) {
    newPlane.velocity.y -= GRAVITY * 2 * effectiveDt;
    newPlane.speed = Math.max(10, newPlane.speed);
  }

  // Clamp speed
  newPlane.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, newPlane.speed));

  // Ghost powerup prevents stalling
  if (newPlane.activePowerup === 'ghost') {
    newPlane.stalling = false;
  }

  // Nitro speed override
  if (newPlane.activePowerup === 'nitro') {
    newPlane.speed = Math.min(MAX_SPEED, newPlane.speed * 1.02);
  }

  // Rotation updates
  const turnMod = weatherTurnMod * (newPlane.stalling ? 0.3 : 1);
  newPlane.rotation.x += input.pitch * PITCH_RATE * turnMod * effectiveDt;
  newPlane.rotation.y += input.yaw * TURN_RATE * turnMod * effectiveDt;
  newPlane.rotation.z += input.roll * ROLL_RATE * turnMod * effectiveDt;

  // Clamp pitch
  newPlane.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, newPlane.rotation.x));

  // Roll auto-stabilize
  newPlane.rotation.z *= 0.95;

  // G-force calculation
  const turnG = Math.abs(input.yaw) * (newPlane.speed / 100) * 3;
  const pitchG = Math.abs(input.pitch) * (newPlane.speed / 100) * 2;
  newPlane.gForce = 1 + turnG + pitchG;

  // Calculate velocity from rotation + speed
  const cosP = Math.cos(newPlane.rotation.x);
  const sinP = Math.sin(newPlane.rotation.x);
  const cosY = Math.cos(newPlane.rotation.y);
  const sinY = Math.sin(newPlane.rotation.y);

  newPlane.velocity = {
    x: sinY * cosP * newPlane.speed,
    y: -sinP * newPlane.speed + (newPlane.stalling ? -GRAVITY * 2 : (liftForce * 0.0001 - GRAVITY) * 0.1),
    z: cosY * cosP * newPlane.speed,
  };

  // Wind effects
  newPlane.velocity.x += weather.windDirection.x * weather.windSpeed * effectiveDt;
  newPlane.velocity.z += weather.windDirection.z * weather.windSpeed * effectiveDt;

  // Update position
  newPlane.position = addVec3(newPlane.position, scaleVec3(newPlane.velocity, effectiveDt));

  // Altitude
  newPlane.altitude = Math.max(0, newPlane.position.y);

  // Ground collision
  if (newPlane.position.y < 2) {
    newPlane.position.y = 2;
    newPlane.velocity.y = Math.abs(newPlane.velocity.y) * 0.3;
    if (newPlane.speed > 50) {
      newPlane.health -= 10;
      newPlane.damage++;
    }
  }

  // Ceiling
  if (newPlane.position.y > 500) {
    newPlane.position.y = 500;
    newPlane.velocity.y = -10;
  }

  // Powerup timer
  if (newPlane.activePowerup && newPlane.powerupTimer > 0) {
    newPlane.powerupTimer -= effectiveDt;
    if (newPlane.powerupTimer <= 0) {
      newPlane.activePowerup = null;
      newPlane.powerupTimer = 0;
    }
  }

  // Trail points
  newPlane.trailPoints = [{ ...newPlane.position }, ...newPlane.trailPoints.slice(0, 50)];

  return newPlane;
}

export function checkCheckpointCollision(plane: PlaneState, checkpoint: Checkpoint): boolean {
  if (checkpoint.passed) return false;
  return distVec3(plane.position, checkpoint.position) < checkpoint.radius;
}

export function checkObstacleCollision(plane: PlaneState, obstacle: Obstacle): boolean {
  if (obstacle.destroyed) return false;
  if (plane.activePowerup === 'ghost') return false;

  const dx = Math.abs(plane.position.x - obstacle.position.x);
  const dy = Math.abs(plane.position.y - obstacle.position.y);
  const dz = Math.abs(plane.position.z - obstacle.position.z);

  return dx < obstacle.size.x && dy < obstacle.size.y && dz < obstacle.size.z;
}

export function checkPowerupCollision(plane: PlaneState, powerup: Powerup): boolean {
  if (powerup.collected) return false;
  const magnetRange = plane.activePowerup === 'magnet' ? 30 : 5;
  return distVec3(plane.position, powerup.position) < magnetRange;
}

export function applyDamage(plane: PlaneState, amount: number): PlaneState {
  if (plane.activePowerup === 'shield') {
    return { ...plane, activePowerup: null, powerupTimer: 0 };
  }
  return {
    ...plane,
    health: Math.max(0, plane.health - amount),
    damage: plane.damage + 1,
  };
}

export function applyPowerupToPlane(plane: PlaneState, type: PowerupType): PlaneState {
  const durations: Record<string, number> = {
    nitro: 3, shield: 10, lightning: 0, magnet: 8,
    timeSlow: 5, ghost: 3, tornado: 5, doublePoints: 10,
    repair: 0, mystery: 0,
  };

  if (type === 'repair') {
    return { ...plane, health: plane.maxHealth, damage: 0 };
  }
  if (type === 'mystery') {
    const types: PowerupType[] = ['nitro', 'shield', 'magnet', 'timeSlow', 'ghost', 'doublePoints'];
    type = types[Math.floor(Math.random() * types.length)];
  }

  return {
    ...plane,
    activePowerup: type,
    powerupTimer: durations[type] || 5,
  };
}

export function updateObstacles(obstacles: Obstacle[], time: number): Obstacle[] {
  return obstacles.map(obs => {
    if (obs.type !== 'moving' || !obs.movePattern) return obs;
    const { axis, range, speed } = obs.movePattern;
    const offset = Math.sin(time * speed) * range;
    const newPos = { ...obs.position };
    newPos[axis] += offset;
    return { ...obs, position: newPos };
  });
}
