import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  GameMode, GameState, PlayerProfile, Track, Mission,
  PlaneState, WeatherState, RaceResult,
  Notification, Achievement,
} from './engine/types';
import { POWERUP_INFO, LIVERIES, TRAIL_EFFECTS } from './engine/types';
import {
  updatePhysics,
  checkCheckpointCollision, checkObstacleCollision,
  checkPowerupCollision, applyDamage, applyPowerupToPlane,
} from './engine/physics';
import type { PhysicsInput } from './engine/physics';
import { TRACKS, CAREER_MISSIONS, resetTrack } from './engine/tracks';
import { createStore, saveGame, addXP, calculateStars, startRace } from './engine/store';
import type { GameStore } from './engine/store';
import { GameRenderer } from './components/GameRenderer';
import * as Audio from './engine/audio';

type Screen = GameStore['screen'];

export function App() {
  const [store, setStore] = useState<GameStore>(() => createStore());
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [touchControls, setTouchControls] = useState({ pitch: 0, yaw: 0, throttle: 0.5, boost: false });
  const [gameTime, setGameTime] = useState(0);
  const gameLoopRef = useRef<number>(0);
  const lastTimeRef = useRef(0);
  const notifIdRef = useRef(0);

  // Keyboard input
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      setKeys(prev => new Set(prev).add(e.key.toLowerCase()));
      if (e.key === 'Escape') {
        setStore(prev => {
          if (prev.gameState === 'playing') return { ...prev, showPause: !prev.showPause, gameState: prev.showPause ? 'playing' : 'paused' };
          return prev;
        });
      }
    };
    const up = (e: KeyboardEvent) => {
      setKeys(prev => { const n = new Set(prev); n.delete(e.key.toLowerCase()); return n; });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Add notification
  const addNotification = useCallback((type: Notification['type'], title: string, message: string, icon = '🔔') => {
    const id = `notif_${notifIdRef.current++}`;
    const notif: Notification = { id, type, title, message, icon, timestamp: Date.now(), duration: 4000 };
    setStore(prev => ({ ...prev, notifications: [...prev.notifications, notif] }));
    setTimeout(() => {
      setStore(prev => ({ ...prev, notifications: prev.notifications.filter(n => n.id !== id) }));
    }, 4000);
  }, []);

  // Check achievement progress
  const checkAchievements = useCallback((profile: PlayerProfile): PlayerProfile => {
    const achievements = profile.achievements.map(a => {
      if (a.unlocked) return a;
      let newProgress = a.progress;

      switch (a.id) {
        case 'collector': newProgress = profile.coins; break;
        case 'veteran': newProgress = profile.level; break;
        case 'ring_master': newProgress = a.progress; break;
        case 'fashionista': newProgress = profile.unlockedLiveries.length; break;
      }

      if (newProgress >= a.target && !a.unlocked) {
        setTimeout(() => {
          Audio.playAchievementSound();
          addNotification('achievement', 'Achievement Unlocked!', a.name, a.icon);
        }, 500);
        return { ...a, progress: newProgress, unlocked: true };
      }
      return { ...a, progress: newProgress };
    });
    return { ...profile, achievements };
  }, [addNotification]);

  // Game loop
  useEffect(() => {
    if (store.gameState !== 'playing' && store.gameState !== 'countdown') return;

    const loop = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = timestamp;

      setGameTime(prev => prev + dt);

      setStore(prev => {
        if (prev.gameState === 'countdown') {
          const newCountdown = prev.countdown - dt;
          if (newCountdown <= 0) {
            Audio.playCountdownBeep(true);
            Audio.startEngineSound();
            return { ...prev, gameState: 'playing', countdown: 0 };
          }
          if (Math.floor(prev.countdown) !== Math.floor(newCountdown) && newCountdown > 0) {
            Audio.playCountdownBeep();
          }
          return { ...prev, countdown: newCountdown };
        }

        if (prev.gameState !== 'playing' || prev.showPause || !prev.currentTrack) return prev;

        // Input
        const input: PhysicsInput = {
          pitch: (keys.has('arrowup') || keys.has('w') ? -1 : 0) + (keys.has('arrowdown') || keys.has('s') ? 1 : 0) + touchControls.pitch,
          yaw: (keys.has('arrowleft') || keys.has('a') ? -1 : 0) + (keys.has('arrowright') || keys.has('d') ? 1 : 0) + touchControls.yaw,
          roll: (keys.has('q') ? -1 : 0) + (keys.has('e') ? 1 : 0),
          throttle: touchControls.throttle + (keys.has('shift') ? 0.3 : 0),
          boost: keys.has(' ') || touchControls.boost,
          brake: keys.has('control'),
        };

        const timeFactor = prev.plane.activePowerup === 'timeSlow' ? 0.5 : 1;
        const newPlane = updatePhysics(prev.plane, input, dt, prev.weather, timeFactor);
        Audio.updateEngineSound(newPlane.speed, newPlane.throttle);

        let newTrack = { ...prev.currentTrack };
        let newScore = prev.score;
        let newCombo = prev.combo;
        let newComboTimer = prev.comboTimer - dt;
        let newLap = prev.currentLap;
        let finished = false;
        let damaged = false;

        if (newComboTimer <= 0) { newCombo = 1; newComboTimer = 0; }

        // Checkpoint collisions
        newTrack.checkpoints = newTrack.checkpoints.map(cp => {
          if (checkCheckpointCollision(newPlane, cp)) {
            Audio.playCheckpointSound();
            newScore += 100 * newCombo;
            newCombo = Math.min(newCombo + 1, 10);
            newComboTimer = 5;

            if (cp.isFinish && newTrack.checkpoints.every(c => c.id === cp.id || c.passed)) {
              if (newLap >= prev.totalLaps) {
                finished = true;
              } else {
                newLap++;
                return { ...cp, passed: false };
              }
            }
            return { ...cp, passed: true };
          }
          return cp;
        });

        // Obstacle collisions
        newTrack.obstacles = newTrack.obstacles.map(obs => {
          if (checkObstacleCollision(newPlane, obs)) {
            if (obs.type === 'destructible') {
              Audio.playCollisionSound(1);
              newScore += 25;
              return { ...obs, destroyed: true };
            }
            if (!damaged) {
              Audio.playCollisionSound(2);
              damaged = true;
            }
            return obs;
          }
          return obs;
        });

        // Apply damage
        let plane = damaged ? applyDamage(newPlane, 20) : newPlane;

        // Powerup collisions
        newTrack.powerups = newTrack.powerups.map(pu => {
          if (checkPowerupCollision(plane, pu)) {
            Audio.playPowerupSound();
            plane = applyPowerupToPlane(plane, pu.type);
            newScore += 50 * newCombo;
            return { ...pu, collected: true };
          }
          return pu;
        });

        // Respawn powerups
        newTrack.powerups = newTrack.powerups.map(pu => {
          if (pu.collected) {
            const timer = pu.respawnTimer + dt;
            if (timer >= 10) return { ...pu, collected: false, respawnTimer: 0 };
            return { ...pu, respawnTimer: timer };
          }
          return pu;
        });

        // Update AI opponents
        const newOpponents = prev.opponents.map(opp => {
          const cp = newTrack.checkpoints[opp.currentCheckpoint % newTrack.checkpoints.length];
          if (!cp) return opp;
          const dir = {
            x: cp.position.x - opp.position.x,
            y: cp.position.y - opp.position.y,
            z: cp.position.z - opp.position.z,
          };
          const dist = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
          if (dist < cp.radius) {
            return { ...opp, currentCheckpoint: opp.currentCheckpoint + 1, progress: opp.progress + 1 };
          }
          const aiSpeed = opp.difficulty === 'hard' ? 85 : opp.difficulty === 'medium' ? 70 : 55;
          const norm = dist > 0 ? { x: dir.x / dist, y: dir.y / dist, z: dir.z / dist } : { x: 0, y: 0, z: 0 };
          return {
            ...opp,
            position: {
              x: opp.position.x + norm.x * aiSpeed * dt,
              y: opp.position.y + norm.y * aiSpeed * dt,
              z: opp.position.z + norm.z * aiSpeed * dt,
            },
            speed: aiSpeed,
            rotation: {
              x: Math.atan2(-norm.y, 1),
              y: Math.atan2(norm.x, norm.z),
              z: 0,
            },
          };
        });

        // Check crash
        if (plane.health <= 0) {
          Audio.playCollisionSound(3);
          Audio.stopEngineSound();
          const result = generateResult(prev, plane, newTrack, 0);
          return { ...prev, gameState: 'crashed' as GameState, plane, raceResult: result, currentTrack: newTrack };
        }

        // Check finished
        if (finished) {
          Audio.playVictoryFanfare();
          Audio.stopEngineSound();
          const raceTime = prev.raceTime + dt;
          const result = generateResult(prev, plane, newTrack, raceTime);
          return {
            ...prev,
            gameState: 'finished' as GameState,
            plane,
            raceResult: result,
            raceTime,
            currentTrack: newTrack,
            score: newScore,
          };
        }

        // Stall warning
        if (plane.stalling && !prev.plane.stalling) {
          Audio.playStallWarning();
        }

        return {
          ...prev,
          plane,
          currentTrack: newTrack,
          opponents: newOpponents,
          raceTime: prev.raceTime + dt,
          lapTime: prev.lapTime + dt,
          currentLap: newLap,
          score: newScore,
          combo: newCombo,
          comboTimer: newComboTimer,
          gameState: 'playing' as GameState,
        };
      });

      gameLoopRef.current = requestAnimationFrame(loop);
    };

    gameLoopRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(gameLoopRef.current);
  }, [store.gameState, store.showPause, keys, touchControls]);

  // FPS counter
  useEffect(() => {
    let frames = 0;
    let lastFpsTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const fps = Math.round(frames / ((now - lastFpsTime) / 1000));
      frames = 0;
      lastFpsTime = now;
      setStore(prev => ({ ...prev, fps }));
    }, 1000);
    const countFrame = () => { frames++; requestAnimationFrame(countFrame); };
    requestAnimationFrame(countFrame);
    return () => clearInterval(interval);
  }, []);

  // Auto-save
  useEffect(() => {
    const interval = setInterval(() => {
      saveGame(store.profile, store.missions);
    }, 30000);
    return () => clearInterval(interval);
  }, [store.profile, store.missions]);

  const generateResult = (prev: GameStore, plane: PlaneState, track: Track, raceTime: number): RaceResult => {
    const passed = track.checkpoints.filter(cp => cp.passed).length;
    const total = track.checkpoints.length;
    const stars = calculateStars(raceTime, track.starTimes);
    const position = plane.health > 0 ? 1 : prev.opponents.length + 1;
    return {
      position,
      time: raceTime,
      bestLap: prev.lapTime,
      coins: Math.floor(prev.score / 10),
      xp: Math.floor(prev.score / 5) + (position === 1 ? 100 : position === 2 ? 75 : 50),
      stars,
      checkpointsPassed: passed,
      totalCheckpoints: total,
      damagesTaken: plane.damage,
      powerupsCollected: track.powerups.filter(p => p.collected).length,
      tricksPerformed: 0,
      topSpeed: plane.speed,
      averageSpeed: plane.speed * 0.7,
    };
  };

  const navigateTo = (screen: Screen) => {
    Audio.playUIClick();
    setStore(prev => ({ ...prev, screen }));
  };

  const handleStartRace = (trackId: string, mode: GameMode, missionId?: number) => {
    Audio.playUIClick();
    setGameTime(0);
    lastTimeRef.current = 0;
    setStore(prev => startRace(prev, trackId, mode, missionId));
  };

  const handleFinishRace = () => {
    if (!store.raceResult) return;
    const result = store.raceResult;

    // Award XP and coins
    let profile = {
      ...store.profile,
      coins: store.profile.coins + result.coins,
      totalRaces: store.profile.totalRaces + 1,
      totalWins: store.profile.totalWins + (result.position === 1 ? 1 : 0),
    };

    const { profile: xpProfile, leveledUp } = addXP(profile, result.xp);
    profile = xpProfile;

    if (leveledUp) {
      Audio.playLevelUp();
      addNotification('levelUp', 'Level Up!', `You reached level ${profile.level}!`, '🎉');

      // Check for livery unlocks
      LIVERIES.forEach(l => {
        if (l.unlockLevel <= profile.level && !profile.unlockedLiveries.includes(l.id)) {
          profile.unlockedLiveries = [...profile.unlockedLiveries, l.id];
          addNotification('unlock', 'New Livery!', `Unlocked: ${l.name}`, '🎨');
        }
      });
      TRAIL_EFFECTS.forEach(t => {
        if (t.unlockLevel <= profile.level && !profile.unlockedTrails.includes(t.id)) {
          profile.unlockedTrails = [...profile.unlockedTrails, t.id];
          addNotification('unlock', 'New Trail!', `Unlocked: ${t.name}`, '✨');
        }
      });
    }

    // Best time
    if (store.currentTrack) {
      const key = store.currentTrack.id;
      if (!profile.bestTimes[key] || result.time < profile.bestTimes[key]) {
        profile.bestTimes[key] = result.time;
      }
    }

    // Career progress
    let missions = [...store.missions];
    if (store.currentMission) {
      missions = missions.map(m => {
        if (m.id === store.currentMission!.id) {
          const completed = result.position <= 1 && result.checkpointsPassed >= result.totalCheckpoints * 0.8;
          return { ...m, completed: completed || m.completed, stars: Math.max(m.stars, result.stars) };
        }
        // Unlock next mission
        if (m.id === store.currentMission!.id + 1 && result.position <= 1) {
          return { ...m, locked: false };
        }
        return m;
      });
    }

    // Check achievements
    profile = checkAchievements(profile);

    // Save
    saveGame(profile, missions);

    setStore(prev => ({
      ...prev,
      screen: 'results',
      profile,
      missions,
      liveries: prev.liveries.map(l => ({
        ...l,
        unlocked: profile.unlockedLiveries.includes(l.id),
      })),
      trails: prev.trails.map(t => ({
        ...t,
        unlocked: profile.unlockedTrails.includes(t.id),
      })),
    }));
  };

  const handleRetry = () => {
    if (store.currentTrack) {
      handleStartRace(
        store.currentTrack.id,
        store.gameMode,
        store.currentMission?.id
      );
    }
  };

  const goHome = () => {
    Audio.stopEngineSound();
    Audio.stopMusic();
    setStore(prev => ({
      ...prev,
      screen: 'mainMenu',
      gameState: 'menu',
      showPause: false,
      raceResult: null,
    }));
  };

  const selectedLivery = LIVERIES.find(l => l.id === store.profile.selectedLivery) || LIVERIES[0];
  const selectedTrail = TRAIL_EFFECTS.find(t => t.id === store.profile.selectedTrail) || TRAIL_EFFECTS[0];

  return (
    <div className="w-full h-full overflow-hidden relative" style={{ background: 'var(--dark-900)' }}>
      {/* Background particles */}
      {store.screen !== 'game' && <BackgroundEffect />}

      {/* Main content */}
      {store.screen === 'mainMenu' && <MainMenu profile={store.profile} onNavigate={navigateTo} />}
      {store.screen === 'modeSelect' && <ModeSelect onSelect={(mode) => { setStore(prev => ({ ...prev, gameMode: mode })); navigateTo('trackSelect'); }} onBack={() => navigateTo('mainMenu')} />}
      {store.screen === 'trackSelect' && <TrackSelect tracks={store.tracks} mode={store.gameMode} profile={store.profile} onStart={handleStartRace} onBack={() => navigateTo('modeSelect')} />}
      {store.screen === 'career' && <CareerScreen missions={store.missions} onStart={(m) => handleStartRace(m.trackId, m.mode, m.id)} onBack={() => navigateTo('mainMenu')} />}
      {store.screen === 'garage' && <GarageScreen profile={store.profile} liveries={store.liveries} trails={store.trails} onSelect={(livery, trail) => { setStore(prev => ({ ...prev, profile: { ...prev.profile, selectedLivery: livery, selectedTrail: trail } })); }} onBack={() => navigateTo('mainMenu')} />}
      {store.screen === 'settings' && <SettingsScreen settings={store.profile.settings} onChange={(settings) => setStore(prev => ({ ...prev, profile: { ...prev.profile, settings } }))} onBack={() => navigateTo('mainMenu')} />}
      {store.screen === 'achievements' && <AchievementsScreen achievements={store.profile.achievements} onBack={() => navigateTo('mainMenu')} />}
      {store.screen === 'leaderboard' && <LeaderboardScreen profile={store.profile} onBack={() => navigateTo('mainMenu')} />}
      {store.screen === 'tutorial' && <TutorialScreen onComplete={() => { setStore(prev => ({ ...prev, showTutorial: false })); navigateTo('mainMenu'); }} />}

      {/* Game screen */}
      {store.screen === 'game' && store.currentTrack && (
        <>
          <GameRenderer
            plane={store.plane}
            track={store.currentTrack}
            weather={store.weather}
            opponents={store.opponents}
            gameTime={gameTime}
            liveryColor={selectedLivery.baseColor}
            liveryAccent={selectedLivery.accentColor}
            trailColor={selectedTrail.color}
            showMinimap={store.profile.settings.showMinimap}
            particleQuality={store.profile.settings.particleQuality}
          />
          <GameHUD
            plane={store.plane}
            raceTime={store.raceTime}
            lap={store.currentLap}
            totalLaps={store.totalLaps}
            score={store.score}
            combo={store.combo}
            comboTimer={store.comboTimer}
            countdown={store.countdown}
            gameState={store.gameState}
            track={store.currentTrack}
            fps={store.fps}
            showFPS={store.profile.settings.showFPS}
            showMinimap={store.profile.settings.showMinimap}
            weather={store.weather}
            hudScale={store.profile.settings.hudScale}
            hudOpacity={store.profile.settings.hudOpacity}
          />
          <TouchControls
            onChange={setTouchControls}
            onPause={() => setStore(prev => ({ ...prev, showPause: true, gameState: 'paused' }))}
          />

          {/* Pause menu */}
          {store.showPause && (
            <PauseMenu
              onResume={() => setStore(prev => ({ ...prev, showPause: false, gameState: 'playing' }))}
              onRestart={handleRetry}
              onQuit={goHome}
              settings={store.profile.settings}
              onSettingsChange={(settings) => setStore(prev => ({ ...prev, profile: { ...prev.profile, settings } }))}
            />
          )}

          {/* Crashed overlay */}
          {store.gameState === 'crashed' && (
            <CrashedOverlay onRetry={handleRetry} onQuit={goHome} />
          )}

          {/* Finished overlay */}
          {store.gameState === 'finished' && (
            <FinishedOverlay result={store.raceResult!} onContinue={handleFinishRace} onRetry={handleRetry} />
          )}
        </>
      )}

      {/* Results screen */}
      {store.screen === 'results' && store.raceResult && (
        <ResultsScreen result={store.raceResult} profile={store.profile} onHome={goHome} onRetry={handleRetry} />
      )}

      {/* Notifications */}
      <NotificationStack notifications={store.notifications} />

      {/* Tutorial overlay */}
      {store.showTutorial && store.screen === 'mainMenu' && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/70 animate-fade-in">
          <div className="glass rounded-2xl p-8 max-w-md text-center">
            <div className="text-5xl mb-4">✈️</div>
            <h2 className="font-orbitron text-2xl mb-2 gradient-text">Welcome, Pilot!</h2>
            <p className="text-gray-300 mb-6">Ready to take to the skies? Start with the tutorial to learn the basics, or jump straight into the action!</p>
            <div className="flex gap-3 justify-center">
              <button className="btn-primary" onClick={() => navigateTo('tutorial')}>Tutorial</button>
              <button className="btn-secondary" onClick={() => setStore(prev => ({ ...prev, showTutorial: false }))}>Skip</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ BACKGROUND EFFECT ============
function BackgroundEffect() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="stars-bg opacity-30" />
      {/* Floating orbs */}
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full blur-3xl animate-float"
          style={{
            width: 200 + i * 50,
            height: 200 + i * 50,
            left: `${10 + i * 18}%`,
            top: `${20 + (i % 3) * 25}%`,
            background: i % 2 === 0
              ? 'radial-gradient(circle, rgba(0,212,255,0.08), transparent)'
              : 'radial-gradient(circle, rgba(255,51,102,0.06), transparent)',
            animationDelay: `${i * 0.7}s`,
            animationDuration: `${4 + i}s`,
          }}
        />
      ))}
    </div>
  );
}

// ============ MAIN MENU ============
function MainMenu({ profile, onNavigate }: { profile: PlayerProfile; onNavigate: (s: Screen) => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 animate-fade-in p-4">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="text-6xl mb-2">✈️</div>
        <h1 className="font-orbitron text-5xl md:text-7xl font-black gradient-text mb-2 tracking-tight">
          EPSTEIN JETS
        </h1>
        <p className="text-gray-400 font-rajdhani text-lg tracking-[0.3em] uppercase">Advanced AR Racing</p>
      </div>

      {/* Player card */}
      <div className="glass rounded-xl px-6 py-3 mb-8 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-pink-500 flex items-center justify-center font-orbitron font-bold text-sm">
          {profile.level}
        </div>
        <div>
          <div className="font-orbitron text-sm">{profile.name}</div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>💰 {profile.coins}</span>
            <span>🏆 {profile.totalWins}</span>
          </div>
        </div>
        <div className="ml-4">
          <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
            <div className="progress-bar" style={{ width: `${(profile.xp / profile.xpToNext) * 100}%` }} />
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">{profile.xp}/{profile.xpToNext} XP</div>
        </div>
      </div>

      {/* Menu buttons */}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button className="btn-gold w-full text-center" onClick={() => onNavigate('modeSelect')}>
          🚀 Quick Play
        </button>
        <button className="btn-primary w-full text-center" onClick={() => onNavigate('career')}>
          🏆 Career Mode
        </button>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secondary w-full text-center text-xs" onClick={() => onNavigate('garage')}>
            🎨 Garage
          </button>
          <button className="btn-secondary w-full text-center text-xs" onClick={() => onNavigate('leaderboard')}>
            📊 Leaderboard
          </button>
          <button className="btn-secondary w-full text-center text-xs" onClick={() => onNavigate('achievements')}>
            🏅 Achievements
          </button>
          <button className="btn-secondary w-full text-center text-xs" onClick={() => onNavigate('settings')}>
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Version */}
      <div className="absolute bottom-4 text-[10px] text-gray-600 font-orbitron">v2.0.0 • EPSTEIN JETS PRO</div>
    </div>
  );
}

// ============ MODE SELECT ============
function ModeSelect({ onSelect, onBack }: { onSelect: (mode: GameMode) => void; onBack: () => void }) {
  const modes: Array<{ id: GameMode; name: string; icon: string; desc: string; color: string }> = [
    { id: 'timeTrial', name: 'Time Trial', icon: '⏱️', desc: 'Race against the clock', color: '#00d4ff' },
    { id: 'obstacle', name: 'Obstacle Course', icon: '🚧', desc: 'Navigate challenging courses', color: '#ff3366' },
    { id: 'freestyle', name: 'Freestyle', icon: '🌀', desc: 'Open sandbox stunts', color: '#9d4edd' },
    { id: 'career', name: 'Career', icon: '🏆', desc: 'Progressive missions', color: '#ffcc00' },
    { id: 'multiplayer', name: 'Multiplayer', icon: '👥', desc: 'Race online', color: '#00ff88' },
  ];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 animate-fade-in p-4">
      <button className="absolute top-4 left-4 btn-secondary text-xs" onClick={onBack}>← Back</button>
      <h2 className="font-orbitron text-3xl font-bold gradient-text mb-8">Select Mode</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl w-full">
        {modes.map(mode => (
          <button
            key={mode.id}
            className="glass rounded-xl p-6 text-left card-hover group"
            onClick={() => onSelect(mode.id)}
            style={{ borderColor: mode.color + '33' }}
          >
            <div className="text-4xl mb-3">{mode.icon}</div>
            <h3 className="font-orbitron text-lg font-bold mb-1" style={{ color: mode.color }}>{mode.name}</h3>
            <p className="text-gray-400 text-sm">{mode.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============ TRACK SELECT ============
function TrackSelect({ tracks, mode, profile, onStart, onBack }: {
  tracks: Track[]; mode: GameMode; profile: PlayerProfile;
  onStart: (trackId: string, mode: GameMode) => void; onBack: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const track = tracks[selected];

  const diffColors = { easy: '#00ff88', medium: '#ffcc00', hard: '#ff3366' };
  const envIcons: Record<string, string> = { city: '🏙️', desert: '🏜️', ocean: '🌊', mountains: '⛰️', space: '🌌' };

  return (
    <div className="absolute inset-0 flex flex-col z-10 animate-fade-in p-4">
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary text-xs" onClick={onBack}>← Back</button>
        <h2 className="font-orbitron text-xl font-bold gradient-text">Select Track</h2>
        <div className="w-20" />
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
        {/* Track list */}
        <div className="md:w-1/3 overflow-y-auto space-y-2 pr-2">
          {tracks.map((t, i) => (
            <button
              key={t.id}
              className={`glass rounded-lg p-3 w-full text-left transition-all ${selected === i ? 'glow-cyan border-cyan-400/50' : ''}`}
              onClick={() => { setSelected(i); Audio.playUIHover(); }}
            >
              <div className="flex items-center gap-2">
                <span>{envIcons[t.environment] || '🗺️'}</span>
                <div>
                  <div className="font-orbitron text-sm font-bold">{t.name}</div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span style={{ color: diffColors[t.difficulty] }}>{t.difficulty.toUpperCase()}</span>
                    <span>•</span>
                    <span>{t.laps} laps</span>
                  </div>
                </div>
                {profile.bestTimes[t.id] && (
                  <div className="ml-auto text-xs text-cyan-400">{formatTime(profile.bestTimes[t.id])}</div>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Track details */}
        <div className="md:w-2/3 glass rounded-xl p-6 flex flex-col">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-orbitron text-2xl font-bold">{track.name}</h3>
              <p className="text-gray-400 mt-1">{track.description}</p>
            </div>
            <span className="text-4xl">{envIcons[track.environment]}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Difficulty" value={track.difficulty.toUpperCase()} color={diffColors[track.difficulty]} />
            <StatCard label="Checkpoints" value={String(track.checkpoints.length)} color="#00d4ff" />
            <StatCard label="Obstacles" value={String(track.obstacles.length)} color="#ff3366" />
            <StatCard label="Powerups" value={String(track.powerups.length)} color="#ffcc00" />
          </div>

          <div className="glass-dark rounded-lg p-4 mb-4">
            <div className="text-xs text-gray-500 font-orbitron mb-2">STAR TARGETS</div>
            <div className="flex gap-4">
              {track.starTimes.map((t, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-yellow-400">{'⭐'.repeat(i + 1)}</span>
                  <span className="text-sm text-gray-300">{formatTime(t)}</span>
                </div>
              ))}
            </div>
          </div>

          {profile.bestTimes[track.id] && (
            <div className="glass-dark rounded-lg p-4 mb-4">
              <div className="text-xs text-gray-500 font-orbitron mb-1">YOUR BEST</div>
              <div className="font-orbitron text-2xl text-cyan-400">{formatTime(profile.bestTimes[track.id])}</div>
            </div>
          )}

          <div className="mt-auto">
            <button className="btn-gold w-full text-center" onClick={() => onStart(track.id, mode)}>
              🏁 START RACE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="glass-dark rounded-lg p-3 text-center">
      <div className="text-[10px] text-gray-500 font-orbitron uppercase mb-1">{label}</div>
      <div className="font-orbitron text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

// ============ CAREER SCREEN ============
function CareerScreen({ missions, onStart, onBack }: {
  missions: Mission[]; onStart: (m: Mission) => void; onBack: () => void;
}) {
  const completed = missions.filter(m => m.completed).length;
  const totalStars = missions.reduce((s, m) => s + m.stars, 0);

  return (
    <div className="absolute inset-0 flex flex-col z-10 animate-fade-in p-4">
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary text-xs" onClick={onBack}>← Back</button>
        <div className="text-center">
          <h2 className="font-orbitron text-xl font-bold gradient-text">Career Mode</h2>
          <div className="text-xs text-gray-400">
            {completed}/{missions.length} Completed • ⭐ {totalStars}/{missions.length * 3}
          </div>
        </div>
        <div className="w-20" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {missions.map((mission) => (
            <div
              key={mission.id}
              className={`glass rounded-xl p-5 card-hover ${mission.locked ? 'opacity-40' : ''} ${mission.completed ? 'border-green-500/30' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-orbitron text-xs text-gray-500">MISSION {mission.id}</span>
                <div className="flex">
                  {[1, 2, 3].map(star => (
                    <span key={star} className={star <= mission.stars ? 'text-yellow-400' : 'text-gray-700'}>⭐</span>
                  ))}
                </div>
              </div>
              <h3 className="font-orbitron text-lg font-bold mb-1">{mission.title}</h3>
              <p className="text-gray-400 text-sm mb-3">{mission.description}</p>
              <div className="space-y-1 mb-4">
                {mission.objectives.map((obj, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{mission.completed ? '✅' : '⬜'}</span>
                    <span>{obj.description}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  +{mission.reward.xp} XP • +{mission.reward.coins} 💰
                  {mission.reward.unlock && <span className="text-yellow-400 ml-1">🎨</span>}
                </div>
                <button
                  className={`${mission.locked ? 'btn-secondary opacity-50' : mission.completed ? 'btn-secondary' : 'btn-primary'} text-xs`}
                  disabled={mission.locked}
                  onClick={() => !mission.locked && onStart(mission)}
                >
                  {mission.locked ? '🔒' : mission.completed ? 'Replay' : 'Start'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ GARAGE SCREEN ============
function GarageScreen({ profile, liveries, trails, onSelect, onBack }: {
  profile: PlayerProfile; liveries: LiveryConfig[]; trails: TrailEffect[];
  onSelect: (livery: string, trail: string) => void; onBack: () => void;
}) {
  const [tab, setTab] = useState<'liveries' | 'trails'>('liveries');
  const [selectedLivery, setSelectedLivery] = useState(profile.selectedLivery);
  const [selectedTrail, setSelectedTrail] = useState(profile.selectedTrail);

  const currentLivery = liveries.find(l => l.id === selectedLivery) || liveries[0];
  const rarityColors = { common: '#888', rare: '#00d4ff', epic: '#9d4edd', legendary: '#ffd700' };

  return (
    <div className="absolute inset-0 flex flex-col z-10 animate-fade-in p-4">
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary text-xs" onClick={onBack}>← Back</button>
        <h2 className="font-orbitron text-xl font-bold gradient-text">Garage</h2>
        <button className="btn-primary text-xs" onClick={() => { onSelect(selectedLivery, selectedTrail); onBack(); }}>Save</button>
      </div>

      {/* Preview */}
      <div className="glass rounded-xl p-6 mb-4 flex items-center justify-center" style={{ minHeight: 180 }}>
        <div className="relative">
          <PlanePreview color={currentLivery.baseColor} accent={currentLivery.accentColor} size={120} />
          <div className="text-center mt-4">
            <div className="font-orbitron text-lg font-bold">{currentLivery.name}</div>
            <div className="text-xs uppercase font-orbitron" style={{ color: rarityColors[currentLivery.rarity] }}>
              {currentLivery.rarity}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button className={`flex-1 py-2 rounded-lg font-orbitron text-sm ${tab === 'liveries' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'glass'}`} onClick={() => setTab('liveries')}>
          🎨 Liveries
        </button>
        <button className={`flex-1 py-2 rounded-lg font-orbitron text-sm ${tab === 'trails' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'glass'}`} onClick={() => setTab('trails')}>
          ✨ Trails
        </button>
      </div>

      {/* Items grid */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'liveries' && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {liveries.map(l => (
              <button
                key={l.id}
                className={`glass rounded-lg p-3 text-center card-hover ${selectedLivery === l.id ? 'glow-cyan' : ''} ${!l.unlocked ? 'opacity-40' : ''}`}
                onClick={() => l.unlocked && setSelectedLivery(l.id)}
              >
                <div className="w-10 h-10 mx-auto rounded-full mb-2 border-2"
                  style={{ background: l.baseColor, borderColor: l.accentColor }} />
                <div className="text-[10px] font-orbitron truncate">{l.name}</div>
                {!l.unlocked && <div className="text-[9px] text-gray-500 mt-1">🔒 Lvl {l.unlockLevel}</div>}
                <div className="text-[8px] mt-1" style={{ color: rarityColors[l.rarity] }}>{l.rarity}</div>
              </button>
            ))}
          </div>
        )}
        {tab === 'trails' && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {trails.map(t => (
              <button
                key={t.id}
                className={`glass rounded-lg p-3 text-center card-hover ${selectedTrail === t.id ? 'glow-cyan' : ''} ${!t.unlocked ? 'opacity-40' : ''}`}
                onClick={() => t.unlocked && setSelectedTrail(t.id)}
              >
                <div className="w-10 h-3 mx-auto rounded-full mb-2"
                  style={{ background: `linear-gradient(90deg, ${t.color}, transparent)` }} />
                <div className="text-[10px] font-orbitron truncate">{t.name}</div>
                {!t.unlocked && <div className="text-[9px] text-gray-500 mt-1">🔒 Lvl {t.unlockLevel}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanePreview({ color, accent, size }: { color: string; accent: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="-60 -60 120 120" className="animate-float">
      {/* Shadow */}
      <ellipse cx="2" cy="30" rx="35" ry="8" fill="rgba(0,0,0,0.2)" />
      {/* Fuselage */}
      <path d="M0,-45 L-8,-10 L-6,25 L0,20 L6,25 L8,-10 Z" fill={color} stroke={accent} strokeWidth="1.5" />
      {/* Wings */}
      <path d="M-45,0 L-5,-8 L5,-8 L45,0 L5,2 L-5,2 Z" fill={color} stroke={accent} strokeWidth="1" />
      {/* Tail */}
      <path d="M-15,18 L0,12 L15,18 L5,22 L-5,22 Z" fill={accent} />
      {/* Vertical stabilizer */}
      <path d="M-2,8 L0,25 L2,8 Z" fill={accent} />
      {/* Canopy */}
      <ellipse cx="0" cy="-15" rx="4" ry="7" fill="rgba(100,180,255,0.5)" />
      {/* Wing tips */}
      <rect x="-46" y="-2" width="4" height="4" rx="1" fill={accent} />
      <rect x="42" y="-2" width="4" height="4" rx="1" fill={accent} />
    </svg>
  );
}

// ============ SETTINGS SCREEN ============
function SettingsScreen({ settings, onChange, onBack }: {
  settings: import('./engine/types').GameSettings;
  onChange: (s: import('./engine/types').GameSettings) => void;
  onBack: () => void;
}) {
  const update = (key: string, value: unknown) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className="absolute inset-0 flex flex-col z-10 animate-fade-in p-4">
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary text-xs" onClick={onBack}>← Back</button>
        <h2 className="font-orbitron text-xl font-bold gradient-text">Settings</h2>
        <div className="w-20" />
      </div>

      <div className="flex-1 overflow-y-auto max-w-lg mx-auto w-full space-y-4">
        <SettingsSection title="Audio">
          <SliderSetting label="Master Volume" value={settings.masterVolume} onChange={v => { update('masterVolume', v); Audio.setVolumes(v, settings.sfxVolume, settings.musicVolume); }} />
          <SliderSetting label="Music Volume" value={settings.musicVolume} onChange={v => update('musicVolume', v)} />
          <SliderSetting label="SFX Volume" value={settings.sfxVolume} onChange={v => update('sfxVolume', v)} />
        </SettingsSection>

        <SettingsSection title="Controls">
          <SliderSetting label="Sensitivity" value={settings.sensitivity} onChange={v => update('sensitivity', v)} min={0.1} max={2} />
          <ToggleSetting label="Invert Y Axis" value={settings.invertY} onChange={v => update('invertY', v)} />
        </SettingsSection>

        <SettingsSection title="Display">
          <ToggleSetting label="Show FPS" value={settings.showFPS} onChange={v => update('showFPS', v)} />
          <ToggleSetting label="Show Minimap" value={settings.showMinimap} onChange={v => update('showMinimap', v)} />
          <SliderSetting label="HUD Scale" value={settings.hudScale} onChange={v => update('hudScale', v)} min={0.5} max={1.5} />
          <SliderSetting label="HUD Opacity" value={settings.hudOpacity} onChange={v => update('hudOpacity', v)} />
          <SelectSetting label="Particle Quality" value={settings.particleQuality} options={['low', 'medium', 'high']} onChange={v => update('particleQuality', v)} />
          <SelectSetting label="Camera Mode" value={settings.cameraMode} options={['chase', 'cockpit', 'cinematic']} onChange={v => update('cameraMode', v)} />
        </SettingsSection>

        <SettingsSection title="Accessibility">
          <SelectSetting label="Colorblind Mode" value={settings.colorblindMode} options={['none', 'protanopia', 'deuteranopia', 'tritanopia']} onChange={v => update('colorblindMode', v)} />
          <ToggleSetting label="Reduced Motion" value={settings.reducedMotion} onChange={v => update('reducedMotion', v)} />
          <ToggleSetting label="High Contrast" value={settings.highContrast} onChange={v => update('highContrast', v)} />
        </SettingsSection>
      </div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4">
      <h3 className="font-orbitron text-sm font-bold text-cyan-400 mb-3 uppercase">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SliderSetting({ label, value, onChange, min = 0, max = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-300">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="range" min={min * 100} max={max * 100} value={value * 100}
          onChange={e => onChange(Number(e.target.value) / 100)}
          className="w-24 accent-cyan-400"
        />
        <span className="text-xs text-gray-400 w-10 text-right">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

function ToggleSetting({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-300">{label}</span>
      <button
        className={`w-12 h-6 rounded-full transition-all ${value ? 'bg-cyan-500' : 'bg-gray-700'}`}
        onClick={() => onChange(!value)}
      >
        <div className={`w-5 h-5 rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function SelectSetting({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-300">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-white/10 border border-white/10 rounded-lg px-3 py-1 text-sm text-gray-300 outline-none"
      >
        {options.map(o => <option key={o} value={o} className="bg-gray-900">{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
      </select>
    </div>
  );
}

// ============ ACHIEVEMENTS ============
function AchievementsScreen({ achievements, onBack }: { achievements: Achievement[]; onBack: () => void }) {
  const unlocked = achievements.filter(a => a.unlocked).length;
  return (
    <div className="absolute inset-0 flex flex-col z-10 animate-fade-in p-4">
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary text-xs" onClick={onBack}>← Back</button>
        <div className="text-center">
          <h2 className="font-orbitron text-xl font-bold gradient-text">Achievements</h2>
          <div className="text-xs text-gray-400">{unlocked}/{achievements.length} Unlocked</div>
        </div>
        <div className="w-20" />
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
          {achievements.map(a => (
            <div key={a.id} className={`glass rounded-lg p-4 flex items-center gap-3 ${a.unlocked ? 'border-yellow-500/30' : ''} ${a.hidden && !a.unlocked ? 'opacity-30' : ''}`}>
              <div className="text-3xl">{a.hidden && !a.unlocked ? '❓' : a.icon}</div>
              <div className="flex-1">
                <div className="font-orbitron text-sm font-bold">{a.hidden && !a.unlocked ? 'Hidden' : a.name}</div>
                <div className="text-xs text-gray-400">{a.hidden && !a.unlocked ? '???' : a.description}</div>
                {!a.unlocked && !a.hidden && (
                  <div className="mt-1">
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="progress-bar" style={{ width: `${Math.min(100, (a.progress / a.target) * 100)}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{a.progress}/{a.target}</div>
                  </div>
                )}
              </div>
              {a.unlocked && <span className="text-green-400 text-lg">✅</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ LEADERBOARD ============
function LeaderboardScreen({ profile, onBack }: { profile: PlayerProfile; onBack: () => void }) {
  const entries = [
    { rank: 1, name: 'AceFlyer', level: 47, score: 125000, isPlayer: false },
    { rank: 2, name: 'SkyWolf', level: 42, score: 98000, isPlayer: false },
    { rank: 3, name: 'JetStorm', level: 38, score: 87500, isPlayer: false },
    { rank: 4, name: profile.name, level: profile.level, score: profile.totalWins * 1000 + profile.coins, isPlayer: true },
    { rank: 5, name: 'CloudRider', level: 29, score: 54000, isPlayer: false },
    { rank: 6, name: 'TurboFox', level: 25, score: 42000, isPlayer: false },
    { rank: 7, name: 'WindDancer', level: 21, score: 35000, isPlayer: false },
    { rank: 8, name: 'BlueArrow', level: 18, score: 28000, isPlayer: false },
    { rank: 9, name: 'NightHawk', level: 14, score: 21000, isPlayer: false },
    { rank: 10, name: 'StarPilot', level: 10, score: 15000, isPlayer: false },
  ].sort((a, b) => b.score - a.score).map((e, i) => ({ ...e, rank: i + 1 }));

  return (
    <div className="absolute inset-0 flex flex-col z-10 animate-fade-in p-4">
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary text-xs" onClick={onBack}>← Back</button>
        <h2 className="font-orbitron text-xl font-bold gradient-text">Leaderboard</h2>
        <div className="w-20" />
      </div>
      <div className="flex-1 overflow-y-auto max-w-lg mx-auto w-full">
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.rank} className={`glass rounded-lg p-4 flex items-center gap-3 ${e.isPlayer ? 'glow-cyan border-cyan-400/30' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-orbitron text-sm font-bold ${e.rank <= 3 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-black' : 'bg-white/10'}`}>
                {e.rank}
              </div>
              <div className="flex-1">
                <div className="font-orbitron text-sm font-bold">{e.name}</div>
                <div className="text-xs text-gray-400">Level {e.level}</div>
              </div>
              <div className="font-orbitron text-sm text-cyan-400">{e.score.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ TUTORIAL ============
function TutorialScreen({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    { title: 'Welcome to EPSTEIN JETS!', text: 'An advanced AR racing game with 5 game modes, customizable planes, and competitive multiplayer.', icon: '✈️' },
    { title: 'Controls', text: '🖥️ Desktop: WASD/Arrows to steer, Space for boost, Shift for throttle, Ctrl to brake\n📱 Mobile: Use the on-screen joystick and buttons', icon: '🎮' },
    { title: 'Checkpoints', text: 'Fly through the glowing rings to progress. Blue rings are regular checkpoints, gold rings are the finish line.', icon: '🎯' },
    { title: 'Powerups', text: 'Collect powerups for advantages: 🔥 Nitro, 🛡️ Shield, 👻 Ghost, 💎 Double Points, and more!', icon: '⚡' },
    { title: 'Progression', text: 'Earn XP and coins from races. Level up to unlock new liveries and trail effects. Complete career missions for exclusive rewards!', icon: '📈' },
    { title: 'Ready to Fly!', text: 'Start with Career Mode for guided missions, or jump into Time Trial for pure speed. Good luck, pilot!', icon: '🚀' },
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/60 animate-fade-in p-4">
      <div className="glass rounded-2xl p-8 max-w-md w-full text-center animate-scale-in">
        <div className="text-6xl mb-4">{steps[step].icon}</div>
        <h2 className="font-orbitron text-xl font-bold mb-3 gradient-text">{steps[step].title}</h2>
        <p className="text-gray-300 text-sm mb-6 whitespace-pre-line">{steps[step].text}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full ${i === step ? 'bg-cyan-400' : 'bg-white/20'}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && <button className="btn-secondary text-xs" onClick={() => setStep(step - 1)}>Back</button>}
            {step < steps.length - 1 ? (
              <button className="btn-primary text-xs" onClick={() => setStep(step + 1)}>Next</button>
            ) : (
              <button className="btn-gold text-xs" onClick={onComplete}>Let's Go!</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ GAME HUD ============
function GameHUD({ plane, raceTime, lap, totalLaps, score, combo, comboTimer, countdown, gameState, track, fps, showFPS, showMinimap, weather, hudScale, hudOpacity }: {
  plane: PlaneState; raceTime: number; lap: number; totalLaps: number;
  score: number; combo: number; comboTimer: number; countdown: number;
  gameState: GameState; track: Track; fps: number; showFPS: boolean;
  showMinimap: boolean; weather: WeatherState; hudScale: number; hudOpacity: number;
}) {
  const nextCp = track.checkpoints.find(cp => !cp.passed);
  const checkpointsPassed = track.checkpoints.filter(cp => cp.passed).length;
  const totalCheckpoints = track.checkpoints.length;
  const speedKmh = Math.round(plane.speed * 3.6);

  return (
    <div className="absolute inset-0 pointer-events-none z-10" style={{ opacity: hudOpacity, transform: `scale(${hudScale})`, transformOrigin: 'top left' }}>
      {/* Countdown */}
      {gameState === 'countdown' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-orbitron text-8xl font-black text-glow-cyan" style={{ animation: 'countdown-pulse 1s ease-out' }}>
            {Math.ceil(countdown) || 'GO!'}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-2 left-2 right-2 flex items-start justify-between">
        {/* Time & Lap */}
        <div className="glass-dark rounded-lg px-3 py-2">
          <div className="font-orbitron text-2xl text-cyan-400">{formatTime(raceTime)}</div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>LAP {lap}/{totalLaps}</span>
            <span>•</span>
            <span>CP {checkpointsPassed}/{totalCheckpoints}</span>
          </div>
        </div>

        {/* Score & Combo */}
        <div className="glass-dark rounded-lg px-3 py-2 text-right">
          <div className="font-orbitron text-xl text-yellow-400">{score.toLocaleString()}</div>
          {combo > 1 && (
            <div className="text-xs text-orange-400 font-orbitron animate-pulse">
              x{combo} COMBO
            </div>
          )}
        </div>
      </div>

      {/* Bottom HUD */}
      <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
        {/* Speed & Health */}
        <div className="glass-dark rounded-lg px-3 py-2">
          {/* Speed */}
          <div className="flex items-baseline gap-1">
            <span className="font-orbitron text-3xl font-bold" style={{
              color: speedKmh > 400 ? '#ff3366' : speedKmh > 200 ? '#ffcc00' : '#00d4ff',
            }}>
              {speedKmh}
            </span>
            <span className="text-xs text-gray-500">km/h</span>
          </div>

          {/* Health bar */}
          <div className="mt-1">
            <div className="text-[10px] text-gray-500 font-orbitron">HEALTH</div>
            <div className="w-28 h-2 bg-black/40 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width: `${plane.health}%`,
                background: plane.health > 60 ? '#00ff88' : plane.health > 30 ? '#ffcc00' : '#ff4444',
              }} />
            </div>
          </div>

          {/* Boost bar */}
          <div className="mt-1">
            <div className="text-[10px] text-gray-500 font-orbitron">BOOST</div>
            <div className="w-28 h-2 bg-black/40 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${plane.boost}%` }} />
            </div>
          </div>

          {/* Altitude */}
          <div className="text-[10px] text-gray-500 mt-1">
            ALT: <span className="text-cyan-300">{Math.round(plane.altitude)}m</span>
            {' • G: '}
            <span className={plane.gForce > 3 ? 'text-red-400' : 'text-gray-300'}>{plane.gForce.toFixed(1)}</span>
          </div>
        </div>

        {/* Active powerup */}
        <div className="flex flex-col items-center gap-2">
          {plane.activePowerup && (
            <div className="glass-dark rounded-lg px-3 py-2 text-center animate-scale-in">
              <div className="text-2xl">{POWERUP_INFO[plane.activePowerup].emoji}</div>
              <div className="text-[10px] font-orbitron text-gray-300">{POWERUP_INFO[plane.activePowerup].name}</div>
              {plane.powerupTimer > 0 && (
                <div className="text-xs text-yellow-400">{plane.powerupTimer.toFixed(1)}s</div>
              )}
            </div>
          )}

          {/* Stall warning */}
          {plane.stalling && (
            <div className="glass-dark rounded-lg px-3 py-1 bg-red-500/20 border border-red-500/40 animate-pulse">
              <div className="font-orbitron text-xs text-red-400">⚠ STALL</div>
            </div>
          )}
        </div>

        {/* Minimap */}
        {showMinimap && (
          <div className="glass-dark rounded-lg p-2" style={{ width: 120, height: 120 }}>
            <Minimap plane={plane} track={track} size={108} />
          </div>
        )}
      </div>

      {/* Next checkpoint indicator */}
      {nextCp && gameState === 'playing' && (
        <NextCheckpointArrow plane={plane} checkpoint={nextCp} />
      )}

      {/* FPS */}
      {showFPS && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 font-orbitron text-[10px] text-gray-600">
          {fps} FPS
        </div>
      )}

      {/* Weather indicator */}
      {weather.current !== 'clear' && (
        <div className="absolute top-14 left-2 glass-dark rounded-lg px-2 py-1 text-xs">
          {weather.current === 'rain' ? '🌧️' : weather.current === 'storm' ? '⛈️' : weather.current === 'snow' ? '🌨️' : weather.current === 'fog' ? '🌫️' : '🏜️'}
          <span className="ml-1 text-gray-400 capitalize">{weather.current}</span>
        </div>
      )}
    </div>
  );
}

function Minimap({ plane, track, size }: { plane: PlaneState; track: Track; size: number }) {
  const bounds = track.bounds;
  const rangeX = bounds.max.x - bounds.min.x;
  const rangeZ = bounds.max.z - bounds.min.z;
  const range = Math.max(rangeX, rangeZ) || 1;

  const toMinimap = (pos: { x: number; z: number }) => ({
    x: ((pos.x - bounds.min.x) / range) * size,
    y: ((pos.z - bounds.min.z) / range) * size,
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Checkpoint dots */}
      {track.checkpoints.map((cp, i) => {
        const p = toMinimap(cp.position);
        return (
          <circle
            key={i} cx={p.x} cy={p.y} r={3}
            fill={cp.passed ? '#00ff8888' : cp.isFinish ? '#ffcc00' : '#00d4ff88'}
          />
        );
      })}
      {/* Checkpoint lines */}
      {track.checkpoints.map((cp, i) => {
        if (i === 0) return null;
        const p1 = toMinimap(track.checkpoints[i - 1].position);
        const p2 = toMinimap(cp.position);
        return <line key={`l${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(0,212,255,0.2)" strokeWidth="1" />;
      })}
      {/* Player */}
      {(() => {
        const p = toMinimap(plane.position);
        return (
          <>
            <circle cx={p.x} cy={p.y} r={5} fill="#00d4ff" stroke="white" strokeWidth="1" />
            <line
              x1={p.x} y1={p.y}
              x2={p.x + Math.sin(plane.rotation.y) * 8}
              y2={p.y + Math.cos(plane.rotation.y) * 8}
              stroke="white" strokeWidth="1"
            />
          </>
        );
      })()}
    </svg>
  );
}

function NextCheckpointArrow({ plane, checkpoint }: { plane: PlaneState; checkpoint: import('./engine/types').Checkpoint }) {
  const dx = checkpoint.position.x - plane.position.x;
  const dz = checkpoint.position.z - plane.position.z;
  const angle = Math.atan2(dx, dz) - plane.rotation.y;
  const dist = Math.sqrt(dx * dx + dz * dz);

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
      <div style={{ transform: `rotate(${-angle}rad)`, transition: 'transform 0.2s' }}>
        <div className="text-cyan-400 text-3xl" style={{ transform: 'translateY(-60px)' }}>▲</div>
      </div>
      <div className="text-center mt-16">
        <div className="text-xs text-gray-400 font-orbitron">{Math.round(dist)}m</div>
      </div>
    </div>
  );
}

// ============ TOUCH CONTROLS ============
function TouchControls({ onChange, onPause }: {
  onChange: (c: { pitch: number; yaw: number; throttle: number; boost: boolean }) => void;
  onPause: () => void;
}) {
  const [touching, setTouching] = useState(false);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = ((touch.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((touch.clientY - rect.top) / rect.height - 0.5) * 2;
    onChange({ pitch: -y, yaw: x, throttle: 0.7, boost: false });
    setTouching(true);
  }, [onChange]);

  const handleTouchEnd = useCallback(() => {
    onChange({ pitch: 0, yaw: 0, throttle: 0.5, boost: false });
    setTouching(false);
  }, [onChange]);

  return (
    <>
      {/* Touch area */}
      <div
        className="absolute inset-0 z-20 pointer-events-auto"
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      />

      {/* Pause button */}
      <button
        className="absolute top-3 right-3 z-30 glass-dark rounded-lg w-10 h-10 flex items-center justify-center pointer-events-auto"
        onClick={onPause}
      >
        <span className="text-lg">⏸</span>
      </button>

      {/* Boost button */}
      <button
        className="absolute bottom-20 right-4 z-30 glass-dark rounded-full w-16 h-16 flex items-center justify-center pointer-events-auto active:glow-cyan"
        onTouchStart={(e) => { e.stopPropagation(); onChange({ ...{pitch: 0, yaw: 0, throttle: 0.9}, boost: true }); }}
        onTouchEnd={(e) => { e.stopPropagation(); onChange({ pitch: 0, yaw: 0, throttle: 0.5, boost: false }); }}
      >
        <span className="font-orbitron text-xs text-cyan-400">BOOST</span>
      </button>

      {/* Throttle buttons */}
      <div className="absolute bottom-20 left-4 z-30 flex flex-col gap-2 pointer-events-auto">
        <button
          className="glass-dark rounded-lg w-12 h-12 flex items-center justify-center active:glow-cyan"
          onTouchStart={(e) => { e.stopPropagation(); onChange({ pitch: 0, yaw: 0, throttle: 1, boost: false }); }}
          onTouchEnd={(e) => { e.stopPropagation(); onChange({ pitch: 0, yaw: 0, throttle: 0.5, boost: false }); }}
        >
          <span className="text-lg">▲</span>
        </button>
        <button
          className="glass-dark rounded-lg w-12 h-12 flex items-center justify-center active:glow-pink"
          onTouchStart={(e) => { e.stopPropagation(); onChange({ pitch: 0, yaw: 0, throttle: 0.1, boost: false }); }}
          onTouchEnd={(e) => { e.stopPropagation(); onChange({ pitch: 0, yaw: 0, throttle: 0.5, boost: false }); }}
        >
          <span className="text-lg">▼</span>
        </button>
      </div>
    </>
  );
}

// ============ PAUSE MENU ============
function PauseMenu({ onResume, onRestart, onQuit, settings, onSettingsChange }: {
  onResume: () => void; onRestart: () => void; onQuit: () => void;
  settings: import('./engine/types').GameSettings;
  onSettingsChange: (s: import('./engine/types').GameSettings) => void;
}) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in pointer-events-auto">
      <div className="glass rounded-2xl p-8 max-w-sm w-full text-center animate-scale-in">
        <h2 className="font-orbitron text-3xl font-bold gradient-text mb-6">PAUSED</h2>
        {!showSettings ? (
          <div className="flex flex-col gap-3">
            <button className="btn-primary w-full" onClick={onResume}>▶ Resume</button>
            <button className="btn-secondary w-full" onClick={onRestart}>🔄 Restart</button>
            <button className="btn-secondary w-full" onClick={() => setShowSettings(true)}>⚙️ Settings</button>
            <button className="btn-danger w-full" onClick={onQuit}>🏠 Quit</button>
          </div>
        ) : (
          <div>
            <SliderSetting label="Master Volume" value={settings.masterVolume} onChange={v => onSettingsChange({ ...settings, masterVolume: v })} />
            <SliderSetting label="Sensitivity" value={settings.sensitivity} onChange={v => onSettingsChange({ ...settings, sensitivity: v })} min={0.1} max={2} />
            <ToggleSetting label="Show FPS" value={settings.showFPS} onChange={v => onSettingsChange({ ...settings, showFPS: v })} />
            <button className="btn-secondary w-full mt-4" onClick={() => setShowSettings(false)}>← Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ CRASHED OVERLAY ============
function CrashedOverlay({ onRetry, onQuit }: { onRetry: () => void; onQuit: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-red-900/40 animate-fade-in pointer-events-auto">
      <div className="glass rounded-2xl p-8 max-w-sm w-full text-center animate-shake">
        <div className="text-6xl mb-4">💥</div>
        <h2 className="font-orbitron text-3xl font-bold text-red-400 mb-2">CRASHED!</h2>
        <p className="text-gray-400 mb-6">Your plane took too much damage</p>
        <div className="flex gap-3 justify-center">
          <button className="btn-primary" onClick={onRetry}>🔄 Retry</button>
          <button className="btn-secondary" onClick={onQuit}>🏠 Quit</button>
        </div>
      </div>
    </div>
  );
}

// ============ FINISHED OVERLAY ============
function FinishedOverlay({ result, onContinue, onRetry }: {
  result: RaceResult; onContinue: () => void; onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in pointer-events-auto">
      <div className="glass rounded-2xl p-8 max-w-sm w-full text-center animate-scale-in">
        <div className="text-6xl mb-2">🏁</div>
        <h2 className="font-orbitron text-3xl font-bold gradient-text-gold mb-1">FINISH!</h2>
        <div className="text-4xl my-3">
          {'⭐'.repeat(result.stars)}{'☆'.repeat(3 - result.stars)}
        </div>
        <div className="font-orbitron text-2xl text-cyan-400 mb-4">{formatTime(result.time)}</div>
        <div className="flex gap-3 justify-center">
          <button className="btn-gold" onClick={onContinue}>Continue</button>
          <button className="btn-secondary" onClick={onRetry}>🔄 Retry</button>
        </div>
      </div>
    </div>
  );
}

// ============ RESULTS SCREEN ============
function ResultsScreen({ result, profile, onHome, onRetry }: {
  result: RaceResult; profile: PlayerProfile; onHome: () => void; onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 animate-fade-in p-4">
      <div className="glass rounded-2xl p-8 max-w-md w-full">
        <h2 className="font-orbitron text-3xl font-bold text-center gradient-text-gold mb-2">Race Results</h2>

        <div className="text-center my-4">
          <div className="text-4xl mb-2">
            {'⭐'.repeat(result.stars)}{'☆'.repeat(3 - result.stars)}
          </div>
          <div className="font-orbitron text-3xl text-cyan-400">{formatTime(result.time)}</div>
          {result.position <= 3 && (
            <div className="font-orbitron text-lg text-yellow-400 mt-1">
              {result.position === 1 ? '🥇 1st Place' : result.position === 2 ? '🥈 2nd Place' : '🥉 3rd Place'}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <ResultStat icon="⏱️" label="Best Lap" value={formatTime(result.bestLap)} />
          <ResultStat icon="🏎️" label="Top Speed" value={`${Math.round(result.topSpeed * 3.6)} km/h`} />
          <ResultStat icon="🎯" label="Checkpoints" value={`${result.checkpointsPassed}/${result.totalCheckpoints}`} />
          <ResultStat icon="💥" label="Damages" value={String(result.damagesTaken)} />
          <ResultStat icon="⚡" label="Powerups" value={String(result.powerupsCollected)} />
          <ResultStat icon="🌟" label="Avg Speed" value={`${Math.round(result.averageSpeed * 3.6)} km/h`} />
        </div>

        <div className="glass-dark rounded-lg p-4 mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-gray-400">Coins earned</span>
            <span className="font-orbitron text-yellow-400">+{result.coins} 💰</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">XP earned</span>
            <span className="font-orbitron text-cyan-400">+{result.xp} XP</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button className="btn-primary flex-1" onClick={onHome}>🏠 Home</button>
          <button className="btn-gold flex-1" onClick={onRetry}>🔄 Retry</button>
        </div>
      </div>
    </div>
  );
}

function ResultStat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="glass-dark rounded-lg p-3 text-center">
      <div className="text-lg">{icon}</div>
      <div className="text-[10px] text-gray-500 font-orbitron uppercase">{label}</div>
      <div className="font-orbitron text-sm text-white">{value}</div>
    </div>
  );
}

// ============ NOTIFICATIONS ============
function NotificationStack({ notifications }: { notifications: Notification[] }) {
  return (
    <div className="absolute top-16 right-4 z-[100] space-y-2 pointer-events-none">
      {notifications.slice(-3).map(notif => (
        <div
          key={notif.id}
          className="glass rounded-lg px-4 py-3 flex items-center gap-3 max-w-xs animate-slide-in-right"
          style={{
            borderLeft: `3px solid ${
              notif.type === 'achievement' ? '#ffd700' :
              notif.type === 'levelUp' ? '#00ff88' :
              notif.type === 'unlock' ? '#9d4edd' : '#00d4ff'
            }`,
          }}
        >
          <span className="text-2xl">{notif.icon}</span>
          <div>
            <div className="font-orbitron text-xs font-bold">{notif.title}</div>
            <div className="text-xs text-gray-400">{notif.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============ HELPERS ============
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}
