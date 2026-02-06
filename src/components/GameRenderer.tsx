import { useRef, useEffect, useCallback } from 'react';
import type { PlaneState, Track, WeatherState, AIOpponent, PowerupType } from '../engine/types';
import { POWERUP_INFO } from '../engine/types';
import type {} from '../engine/physics';

interface GameRendererProps {
  plane: PlaneState;
  track: Track;
  weather: WeatherState;
  opponents: AIOpponent[];
  gameTime: number;
  liveryColor: string;
  liveryAccent: string;
  trailColor: string;
  showMinimap: boolean;
  particleQuality: 'low' | 'medium' | 'high';
}

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; color: string;
}

export function GameRenderer({
  plane, track, weather, opponents, gameTime,
  liveryColor, liveryAccent, trailColor, showMinimap, particleQuality,
}: GameRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef(0);

  const project3D = useCallback((pos: { x: number; y: number; z: number }, cam: { x: number; y: number; z: number; yaw: number }, w: number, h: number) => {
    const dx = pos.x - cam.x;
    const dy = pos.y - cam.y;
    const dz = pos.z - cam.z;

    const cosY = Math.cos(-cam.yaw);
    const sinY = Math.sin(-cam.yaw);
    const rx = dx * cosY - dz * sinY;
    const rz = dx * sinY + dz * cosY;
    const ry = dy;

    if (rz < 1) return null;

    const fov = 800;
    const sx = w / 2 + (rx / rz) * fov;
    const sy = h / 2 - (ry / rz) * fov;
    const scale = fov / rz;

    return { x: sx, y: sy, scale, depth: rz };
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Camera behind plane
    const camDist = 25;
    const camHeight = 8;
    const cam = {
      x: plane.position.x - Math.sin(plane.rotation.y) * camDist,
      y: plane.position.y + camHeight,
      z: plane.position.z - Math.cos(plane.rotation.y) * camDist,
      yaw: plane.rotation.y,
    };

    // Sky gradient based on weather/time
    const skyColors = getSkyColors(weather, gameTime);
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, skyColors.top);
    skyGrad.addColorStop(0.5, skyColors.mid);
    skyGrad.addColorStop(1, skyColors.bottom);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // Stars at night
    if (skyColors.isNight) {
      for (let i = 0; i < 80; i++) {
        const sx = ((i * 137.5) % w);
        const sy = ((i * 73.3) % (h * 0.4));
        const brightness = 0.3 + Math.sin(gameTime + i) * 0.3;
        ctx.fillStyle = `rgba(255,255,255,${brightness})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 1 + Math.random(), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Clouds
    drawClouds(ctx, w, h, cam, gameTime, weather);

    // Ground plane
    drawGround(ctx, w, h, cam, track.environment);

    // Collect all renderable objects for depth sorting
    const renderables: Array<{ depth: number; draw: () => void }> = [];

    // Checkpoints
    track.checkpoints.forEach((cp, _i) => {
      const proj = project3D(cp.position, cam, w, h);
      if (!proj || proj.depth > 500) return;
      renderables.push({
        depth: proj.depth,
        draw: () => drawCheckpoint(ctx, proj, cp.passed, cp.isFinish, cp.radius, gameTime),
      });
    });

    // Obstacles
    track.obstacles.forEach(obs => {
      if (obs.destroyed) return;
      const proj = project3D(obs.position, cam, w, h);
      if (!proj || proj.depth > 400) return;
      renderables.push({
        depth: proj.depth,
        draw: () => drawObstacle(ctx, proj, obs.size, obs.type),
      });
    });

    // Powerups
    track.powerups.forEach(pu => {
      if (pu.collected) return;
      const proj = project3D(pu.position, cam, w, h);
      if (!proj || proj.depth > 300) return;
      renderables.push({
        depth: proj.depth,
        draw: () => drawPowerup(ctx, proj, pu.type, gameTime),
      });
    });

    // AI opponents
    opponents.forEach(opp => {
      const proj = project3D(opp.position, cam, w, h);
      if (!proj || proj.depth > 400) return;
      renderables.push({
        depth: proj.depth,
        draw: () => drawOpponentPlane(ctx, proj, opp),
      });
    });

    // Trail
    if (plane.trailPoints.length > 1) {
      for (let i = 1; i < Math.min(plane.trailPoints.length, 30); i++) {
        const proj = project3D(plane.trailPoints[i], cam, w, h);
        if (!proj || proj.depth > 300) continue;
        const alpha = 1 - i / 30;
        renderables.push({
          depth: proj.depth,
          draw: () => {
            ctx.globalAlpha = alpha * 0.6;
            ctx.fillStyle = trailColor;
            ctx.beginPath();
            ctx.arc(proj.x, proj.y, Math.max(1, proj.scale * (3 - i * 0.08)), 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          },
        });
      }
    }

    // Sort by depth (far to near)
    renderables.sort((a, b) => b.depth - a.depth);
    renderables.forEach(r => r.draw());

    // Player plane (always on top, at center-ish)
    drawPlayerPlane(ctx, w, h, plane, liveryColor, liveryAccent, gameTime);

    // Particles
    updateAndDrawParticles(ctx, particlesRef.current, cam, w, h, project3D);

    // Add engine particles
    if (particleQuality !== 'low') {
      const pCount = particleQuality === 'high' ? 3 : 1;
      for (let i = 0; i < pCount; i++) {
        particlesRef.current.push({
          x: plane.position.x + (Math.random() - 0.5) * 2,
          y: plane.position.y + (Math.random() - 0.5) * 2,
          z: plane.position.z + (Math.random() - 0.5) * 2,
          vx: -plane.velocity.x * 0.1 + (Math.random() - 0.5) * 5,
          vy: (Math.random() - 0.5) * 3,
          vz: -plane.velocity.z * 0.1 + (Math.random() - 0.5) * 5,
          life: 0.5 + Math.random() * 0.5,
          maxLife: 1,
          size: 2 + Math.random() * 3,
          color: plane.activePowerup === 'nitro' ? '#ff4400' : trailColor,
        });
      }
    }

    // Weather effects
    drawWeatherEffects(ctx, w, h, weather, gameTime);

    // Boost lines
    if (plane.activePowerup === 'nitro') {
      drawBoostLines(ctx, w, h, gameTime);
    }

    // Damage vignette
    if (plane.health < 50) {
      const damageAlpha = (1 - plane.health / 50) * 0.3 + Math.sin(gameTime * 5) * 0.05;
      ctx.fillStyle = `rgba(255, 0, 0, ${damageAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Shield effect
    if (plane.activePowerup === 'shield') {
      ctx.strokeStyle = `rgba(0, 212, 255, ${0.3 + Math.sin(gameTime * 4) * 0.2})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 + 20, 50 + Math.sin(gameTime * 3) * 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Ghost effect
    if (plane.activePowerup === 'ghost') {
      ctx.fillStyle = `rgba(170, 170, 255, ${0.05 + Math.sin(gameTime * 6) * 0.03})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Stall warning
    if (plane.stalling) {
      const stallAlpha = 0.2 + Math.sin(gameTime * 10) * 0.1;
      ctx.fillStyle = `rgba(255, 165, 0, ${stallAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Keep particles manageable
    if (particlesRef.current.length > 200) {
      particlesRef.current = particlesRef.current.slice(-200);
    }

    frameRef.current = requestAnimationFrame(render);
  }, [plane, track, weather, opponents, gameTime, liveryColor, liveryAccent, trailColor, showMinimap, particleQuality, project3D]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    frameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frameRef.current);
    };
  }, [render]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 1 }}
    />
  );
}

function getSkyColors(weather: WeatherState, time: number): { top: string; mid: string; bottom: string; isNight: boolean } {
  const hour = (time * 0.01) % 24;
  const isNight = hour < 5 || hour > 20;

  if (weather.current === 'storm') return { top: '#1a1a2e', mid: '#2d2d44', bottom: '#3d3d55', isNight: false };
  if (weather.current === 'rain') return { top: '#3a4a5a', mid: '#5a6a7a', bottom: '#7a8a9a', isNight: false };
  if (weather.current === 'fog') return { top: '#8a9aaa', mid: '#9aaaBA', bottom: '#aabbcc', isNight: false };
  if (weather.current === 'snow') return { top: '#6a7a8a', mid: '#8a9aaa', bottom: '#baccdd', isNight: false };
  if (weather.current === 'sandstorm') return { top: '#8a6a3a', mid: '#aa8a5a', bottom: '#ccaa7a', isNight: false };

  if (isNight) return { top: '#0a0e27', mid: '#1a1042', bottom: '#2a1850', isNight: true };
  return { top: '#0a1628', mid: '#1a3a5a', bottom: '#4a8aaa', isNight: false };
}

function drawClouds(ctx: CanvasRenderingContext2D, w: number, _h: number, _cam: { x: number; y: number; z: number; yaw: number }, time: number, weather: WeatherState) {
  if (weather.current === 'clear') return;
  const cloudCount = weather.current === 'cloudy' ? 8 : weather.current === 'storm' ? 12 : 5;
  ctx.globalAlpha = weather.current === 'storm' ? 0.4 : 0.2;
  for (let i = 0; i < cloudCount; i++) {
    const cx = ((i * 200 + time * 20) % (w + 200)) - 100;
    const cy = 30 + (i % 3) * 40;
    ctx.fillStyle = weather.current === 'storm' ? '#333355' : '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 80 + i * 10, 25 + i * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, _cam: { x: number; y: number; z: number; yaw: number }, env: string): void {
  const groundY = h * 0.65;
  const colors: Record<string, [string, string]> = {
    city: ['#1a2a3a', '#0a1a2a'],
    desert: ['#8a7a5a', '#6a5a3a'],
    ocean: ['#0a3a5a', '#083050'],
    mountains: ['#3a5a3a', '#2a4a2a'],
    space: ['#0a0a1a', '#050510'],
  };
  const [c1, c2] = colors[env] || colors.city;
  const grad = ctx.createLinearGradient(0, groundY, 0, h);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, groundY, w, h - groundY);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 20; i++) {
    const y = groundY + (i / 20) * (h - groundY);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawCheckpoint(
  ctx: CanvasRenderingContext2D,
  proj: { x: number; y: number; scale: number },
  passed: boolean, isFinish: boolean, radius: number, time: number
) {
  const size = Math.max(4, proj.scale * radius * 0.5);
  const pulse = Math.sin(time * 4) * 0.3 + 0.7;

  ctx.save();
  ctx.translate(proj.x, proj.y);

  if (isFinish) {
    ctx.strokeStyle = passed ? 'rgba(0,255,136,0.6)' : `rgba(255,204,0,${pulse})`;
    ctx.lineWidth = Math.max(2, size * 0.15);
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeStyle = passed ? 'rgba(0,255,136,0.4)' : `rgba(0,212,255,${pulse})`;
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.stroke();

    if (!passed) {
      ctx.fillStyle = `rgba(0,212,255,${pulse * 0.15})`;
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();

      // Arrow pointing inward
      ctx.fillStyle = `rgba(0,212,255,${pulse * 0.8})`;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.3);
      ctx.lineTo(-size * 0.15, -size * 0.1);
      ctx.lineTo(size * 0.15, -size * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  proj: { x: number; y: number; scale: number },
  size: { x: number; y: number; z: number },
  type: string
) {
  const w = Math.max(4, proj.scale * size.x);
  const ht = Math.max(4, proj.scale * size.y);

  ctx.save();
  ctx.translate(proj.x, proj.y);

  const color = type === 'moving' ? '#ff6633' : type === 'destructible' ? '#ffaa33' : '#ff3366';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(-w / 2, -ht / 2, w, ht);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -ht / 2, w, ht);

  // Warning icon
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.max(10, w * 0.4)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚠', 0, 0);

  ctx.restore();
}

function drawPowerup(
  ctx: CanvasRenderingContext2D,
  proj: { x: number; y: number; scale: number },
  type: PowerupType,
  time: number
) {
  const info = POWERUP_INFO[type];
  const size = Math.max(8, proj.scale * 4);
  const bounce = Math.sin(time * 3) * size * 0.2;

  ctx.save();
  ctx.translate(proj.x, proj.y + bounce);

  // Glow
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.5);
  glow.addColorStop(0, info.color + '44');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, size * 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Circle background
  ctx.fillStyle = info.color + '88';
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = info.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Emoji
  ctx.font = `${Math.max(12, size)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(info.emoji, 0, 0);

  ctx.restore();
}

function drawPlayerPlane(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  plane: PlaneState,
  baseColor: string, accentColor: string,
  time: number
) {
  const cx = w / 2;
  const cy = h / 2 + 20;
  const size = 20;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(plane.rotation.z * 0.5);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(3, 8, size * 1.2, size * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ghost effect
  if (plane.activePowerup === 'ghost') {
    ctx.globalAlpha = 0.5 + Math.sin(time * 8) * 0.2;
  }

  // Fuselage
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(-size * 0.25, -size * 0.3);
  ctx.lineTo(-size * 0.2, size * 0.6);
  ctx.lineTo(0, size * 0.5);
  ctx.lineTo(size * 0.2, size * 0.6);
  ctx.lineTo(size * 0.25, -size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Wings
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.moveTo(-size * 1.2, 0);
  ctx.lineTo(-size * 0.15, -size * 0.2);
  ctx.lineTo(size * 0.15, -size * 0.2);
  ctx.lineTo(size * 1.2, 0);
  ctx.lineTo(size * 0.15, size * 0.05);
  ctx.lineTo(-size * 0.15, size * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.stroke();

  // Wing tips
  ctx.fillStyle = accentColor;
  ctx.fillRect(-size * 1.2, -2, 4, 4);
  ctx.fillRect(size * 1.2 - 4, -2, 4, 4);

  // Tail
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.moveTo(-size * 0.4, size * 0.4);
  ctx.lineTo(0, size * 0.3);
  ctx.lineTo(size * 0.4, size * 0.4);
  ctx.lineTo(size * 0.15, size * 0.55);
  ctx.lineTo(-size * 0.15, size * 0.55);
  ctx.closePath();
  ctx.fill();

  // Vertical stabilizer
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.moveTo(-2, size * 0.2);
  ctx.lineTo(0, size * 0.6);
  ctx.lineTo(2, size * 0.2);
  ctx.closePath();
  ctx.fill();

  // Canopy
  const canopyGrad = ctx.createLinearGradient(0, -size * 0.5, 0, -size * 0.1);
  canopyGrad.addColorStop(0, '#88ccff88');
  canopyGrad.addColorStop(1, '#4488aa88');
  ctx.fillStyle = canopyGrad;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.3, size * 0.12, size * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Engine glow
  if (plane.throttle > 0.3) {
    const glowSize = size * 0.15 * (0.8 + plane.throttle * 0.4);
    const engineGrad = ctx.createRadialGradient(0, size * 0.6, 0, 0, size * 0.6, glowSize * 2);
    engineGrad.addColorStop(0, plane.activePowerup === 'nitro' ? '#ff440088' : '#ff880088');
    engineGrad.addColorStop(0.5, plane.activePowerup === 'nitro' ? '#ff220044' : '#ff440044');
    engineGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = engineGrad;
    ctx.beginPath();
    ctx.arc(0, size * 0.6, glowSize * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawOpponentPlane(
  ctx: CanvasRenderingContext2D,
  proj: { x: number; y: number; scale: number },
  _opp: AIOpponent
) {
  const size = Math.max(6, proj.scale * 5);
  ctx.save();
  ctx.translate(proj.x, proj.y);

  ctx.fillStyle = '#ff3366';
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(-size * 0.8, size * 0.3);
  ctx.lineTo(0, size * 0.1);
  ctx.lineTo(size * 0.8, size * 0.3);
  ctx.closePath();
  ctx.fill();

  // Name tag
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.max(8, size * 0.4)}px Rajdhani`;
  ctx.textAlign = 'center';
  ctx.fillText(_opp.name, 0, -size - 5);

  ctx.restore();
}

function drawWeatherEffects(ctx: CanvasRenderingContext2D, w: number, h: number, weather: WeatherState, time: number) {
  if (weather.current === 'rain' || weather.current === 'storm') {
    ctx.strokeStyle = `rgba(150,180,255,${0.3 + weather.intensity * 0.3})`;
    ctx.lineWidth = 1;
    const drops = weather.current === 'storm' ? 100 : 50;
    for (let i = 0; i < drops; i++) {
      const x = (i * 37 + time * 200) % w;
      const y = (i * 53 + time * 800) % h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 1, y + 10 + Math.random() * 5);
      ctx.stroke();
    }
  }

  if (weather.current === 'snow') {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 60; i++) {
      const x = (i * 43 + time * 30 + Math.sin(time + i) * 20) % w;
      const y = (i * 67 + time * 40) % h;
      ctx.beginPath();
      ctx.arc(x, y, 2 + Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (weather.current === 'fog') {
    ctx.fillStyle = `rgba(180,190,200,${0.2 + Math.sin(time * 0.5) * 0.05})`;
    ctx.fillRect(0, 0, w, h);
  }

  if (weather.current === 'storm') {
    if (Math.sin(time * 7) > 0.98) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  if (weather.current === 'sandstorm') {
    ctx.fillStyle = `rgba(180,150,100,${0.15 + Math.sin(time) * 0.05})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawBoostLines(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  ctx.strokeStyle = 'rgba(0,212,255,0.3)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 15; i++) {
    const y = (i * h / 15 + time * 500) % h;
    const xStart = Math.random() * w * 0.3;
    const xEnd = w - Math.random() * w * 0.3;
    ctx.globalAlpha = 0.1 + Math.random() * 0.2;
    ctx.beginPath();
    ctx.moveTo(xStart, y);
    ctx.lineTo(xEnd, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  cam: { x: number; y: number; z: number; yaw: number },
  w: number, h: number,
  project3D: (pos: { x: number; y: number; z: number }, cam: { x: number; y: number; z: number; yaw: number }, w: number, h: number) => { x: number; y: number; scale: number; depth: number } | null
) {
  const dt = 1 / 60;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.life -= dt;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    const proj = project3D(p, cam, w, h);
    if (!proj || proj.depth > 200) continue;

    const alpha = p.life / p.maxLife;
    const size = Math.max(1, proj.scale * p.size * alpha);

    ctx.globalAlpha = alpha * 0.7;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
