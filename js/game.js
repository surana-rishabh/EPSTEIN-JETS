// ============================================================
// Game Manager – levels, checkpoints, timer, scoring, UI
// ============================================================
import * as THREE from 'three';
import {
    LEVELS,
    getUnlockedLevels,
    markLevelCompleted,
    generateCheckpointPositions,
} from './levels.js';

export class GameManager {
    constructor(scene) {
        this.scene = scene;

        // State
        this.isPlaced       = false;
        this.isFlying       = false;
        this.currentLevel   = 0;
        this.checksCollected = 0;
        this.timeLeft       = 0;
        this.gameTimer      = null;

        // Scene objects
        this.checkpoints = [];
        this.finishFlag  = null;

        // Callbacks (set by app.js)
        this.onGameEnd = null;
        this.onReset   = null;

        this._setupUI();
    }

    /* ======================================================
     *  UI SETUP
     * ====================================================== */

    _setupUI() {
        this._buildLevelSelector();

        document.getElementById('restartBtn')
            .addEventListener('click', () => this.resetGame());

        const nextBtn = document.getElementById('nextLevelBtn');
        if (nextBtn)
            nextBtn.addEventListener('click', () => this.nextLevel());
    }

    _buildLevelSelector() {
        const container = document.getElementById('levelSelect');
        if (!container) return;
        container.innerHTML = '';

        const levels = getUnlockedLevels();
        levels.forEach((level, i) => {
            const btn       = document.createElement('button');
            btn.className   = 'levelBtn'
                + (i === this.currentLevel ? ' selected' : '')
                + (!level.unlocked ? ' locked' : '');
            btn.textContent = `L${level.id}`;
            btn.title       = level.name + (level.unlocked ? '' : ' 🔒');

            if (level.unlocked) {
                btn.addEventListener('click', () => {
                    this.currentLevel = i;
                    container.querySelectorAll('.levelBtn')
                        .forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    this._updateLevelDesc();
                });
            }
            container.appendChild(btn);
        });

        this._updateLevelDesc();
    }

    _updateLevelDesc() {
        const level = LEVELS[this.currentLevel];
        const el    = document.getElementById('levelDesc');
        if (el) el.textContent = `${level.name}: ${level.description}`;
    }

    getLevelConfig() {
        return LEVELS[this.currentLevel];
    }

    /* ======================================================
     *  CHECKPOINTS & FINISH FLAG
     * ====================================================== */

    createCheckpoints() {
        // Dispose previous
        this.checkpoints.forEach(cp => {
            this.scene.remove(cp);
            cp.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        });
        this.checkpoints = [];

        const level     = this.getLevelConfig();
        const positions = generateCheckpointPositions(level);

        positions.forEach((pos, i) => {
            const ringGeo = new THREE.TorusGeometry(
                level.ringSize, level.ringSize * 0.12, 16, 32
            );
            const ringMat = new THREE.MeshStandardMaterial({
                color: 0x00ff00,
                emissive: 0x00ff00,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.9,
            });

            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.set(pos.x, pos.y, pos.z);

            // Face toward next checkpoint
            const next = positions[(i + 1) % positions.length];
            ring.lookAt(next.x, pos.y, next.z);

            // Number label
            const canvas = document.createElement('canvas');
            canvas.width  = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle    = '#00ff00';
            ctx.font         = 'bold 72px Arial';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((i + 1).toString(), 64, 64);

            const tex    = new THREE.CanvasTexture(canvas);
            const numMat = new THREE.MeshBasicMaterial({
                map: tex, transparent: true, side: THREE.DoubleSide,
            });
            const label = new THREE.Mesh(
                new THREE.PlaneGeometry(0.4, 0.4), numMat
            );
            label.position.z = 0.15;
            ring.add(label);

            ring.userData   = { collected: false, index: i, timer: 0 };
            ring.renderOrder = 0;
            this.scene.add(ring);
            this.checkpoints.push(ring);
        });
    }

    createFinishFlag() {
        if (this.finishFlag) this.scene.remove(this.finishFlag);

        this.finishFlag = new THREE.Group();
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.5, 12);

        const p1 = new THREE.Mesh(poleGeo, poleMat);
        p1.position.set(-2.5, 1.75, 0);
        this.finishFlag.add(p1);

        const p2 = new THREE.Mesh(poleGeo, poleMat);
        p2.position.set(2.5, 1.75, 0);
        this.finishFlag.add(p2);

        // Checkered banner
        const cv  = document.createElement('canvas');
        cv.width  = 256;
        cv.height = 128;
        const ctx = cv.getContext('2d');
        const s   = 32;
        for (let x = 0; x < 8; x++)
            for (let y = 0; y < 4; y++) {
                ctx.fillStyle = (x + y) % 2 === 0 ? '#000' : '#fff';
                ctx.fillRect(x * s, y * s, s, s);
            }

        const flagMat = new THREE.MeshStandardMaterial({
            map: new THREE.CanvasTexture(cv),
            side: THREE.DoubleSide,
            emissive: 0xffffff,
            emissiveIntensity: 0.2,
        });
        const flag = new THREE.Mesh(
            new THREE.PlaneGeometry(5, 2.5), flagMat
        );
        flag.position.set(0, 2.5, 0);
        this.finishFlag.add(flag);

        this.finishFlag.visible     = false;
        this.finishFlag.renderOrder = 0;
        this.scene.add(this.finishFlag);
    }

    /* ======================================================
     *  START / TIMER
     * ====================================================== */

    startLevel() {
        const level = this.getLevelConfig();
        this.checksCollected = 0;
        this.timeLeft        = level.timeLimit;
        this.isFlying        = true;
        this.isPlaced        = true;

        this.createCheckpoints();
        this.createFinishFlag();
        this.finishFlag.visible = true;

        this._updateHUD();
        this._startTimer();

        document.getElementById('spawnUI').style.display = 'none';
        document.getElementById('info').textContent =
            `Level ${level.id}: Fly through ${level.checkpointCount} checkpoints!`;

        const li = document.getElementById('levelIndicator');
        li.textContent  = `Level ${level.id}: ${level.name}`;
        li.style.display = 'block';
    }

    _startTimer() {
        if (this.gameTimer) clearInterval(this.gameTimer);
        this.gameTimer = setInterval(() => {
            this.timeLeft--;
            document.getElementById('time').textContent = this.timeLeft;

            if (this.timeLeft <= 10)
                document.getElementById('time').style.color = '#ff0000';

            if (this.timeLeft <= 0)
                this.endGame('TIME UP!', 'Out of time!', false);
        }, 1000);
    }

    /* ======================================================
     *  GAMEPLAY CHECKS
     * ====================================================== */

    checkCheckpoints(planePos) {
        const level = this.getLevelConfig();

        this.checkpoints.forEach(cp => {
            if (cp.userData.collected) {
                cp.material.opacity = Math.max(0, cp.material.opacity - 0.02);
                return;
            }

            const dist = planePos.distanceTo(cp.position);
            if (dist < level.ringSize + 0.25) {
                const toPlane   = new THREE.Vector3()
                    .subVectors(planePos, cp.position).normalize();
                const ringNorm  = new THREE.Vector3(0, 0, 1)
                    .applyQuaternion(cp.quaternion);
                const dot       = Math.abs(toPlane.dot(ringNorm));

                if (dot > 0.45) {
                    cp.userData.collected = true;
                    cp.material.color.setHex(0xffd700);
                    cp.material.emissive.setHex(0xffd700);
                    this.checksCollected++;

                    document.getElementById('info').textContent =
                        this.checksCollected === level.checkpointCount
                            ? '🏁 All checkpoints! Fly to FINISH!'
                            : `✅ Checkpoint ${this.checksCollected}/${level.checkpointCount}!`;
                }
            }
        });
    }

    checkFinish(planePos) {
        const level = this.getLevelConfig();
        if (this.checksCollected < level.checkpointCount) return false;
        if (!this.finishFlag) return false;

        if (planePos.distanceTo(this.finishFlag.position) < 3) {
            markLevelCompleted(level.id);
            this.endGame('LEVEL COMPLETE!', `${level.name} cleared!`, true);
            return true;
        }
        return false;
    }

    animateCheckpoints(dt) {
        this.checkpoints.forEach(cp => {
            if (!cp.userData.collected) {
                cp.userData.timer += dt;
                const s = 1 + Math.sin(cp.userData.timer * 2) * 0.08;
                cp.scale.set(s, s, s);
            }
        });
    }

    /* ======================================================
     *  HUD
     * ====================================================== */

    updateHUD(speed, altitude) {
        document.getElementById('speed').textContent  = Math.round(speed * 15);
        document.getElementById('alt').textContent    = altitude.toFixed(1);
        document.getElementById('checks').textContent = this.checksCollected;
    }

    _updateHUD() {
        const level = this.getLevelConfig();
        document.getElementById('time').textContent   = level ? level.timeLimit : 0;
        document.getElementById('checks').textContent = '0';
        document.getElementById('speed').textContent  = '0';
        document.getElementById('alt').textContent    = '0.0';
    }

    /* ======================================================
     *  END / RESET
     * ====================================================== */

    endGame(title, msg, win) {
        this.isFlying = false;
        if (this.gameTimer) clearInterval(this.gameTimer);

        const level    = this.getLevelConfig();
        const gameOver = document.getElementById('gameOver');
        gameOver.className = win ? 'win' : '';

        document.getElementById('gameTitle').textContent =
            win ? '🏁 ' + title : '💥 ' + title;
        document.getElementById('gameMsg').textContent        = msg;
        document.getElementById('finalChecks').textContent     =
            `${this.checksCollected}/${level.checkpointCount}`;
        document.getElementById('finalTime').textContent       = this.timeLeft;
        document.getElementById('finalLevel').textContent      = level.name;

        const nextBtn = document.getElementById('nextLevelBtn');
        if (nextBtn)
            nextBtn.style.display =
                (win && this.currentLevel < LEVELS.length - 1)
                    ? 'inline-block' : 'none';

        gameOver.style.display = 'block';

        // Red flash on crash
        if (!win) {
            const overlay = document.getElementById('crashOverlay');
            if (overlay) {
                overlay.style.display = 'block';
                setTimeout(() => (overlay.style.display = 'none'), 500);
            }
        }

        if (this.onGameEnd) this.onGameEnd(win);
    }

    resetGame() {
        this.isFlying = false;
        this.isPlaced = false;
        this.checksCollected = 0;
        this.timeLeft = 0;
        if (this.gameTimer) clearInterval(this.gameTimer);

        // Clean scene objects
        this.checkpoints.forEach(cp => {
            this.scene.remove(cp);
            cp.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        });
        this.checkpoints = [];
        if (this.finishFlag) this.finishFlag.visible = false;

        // UI
        document.getElementById('gameOver').style.display       = 'none';
        document.getElementById('spawnUI').style.display        = 'block';
        document.getElementById('stallWarning').style.display   = 'none';
        document.getElementById('levelIndicator').style.display = 'none';
        document.getElementById('info').textContent =
            '👇 Point at floor or use "Place in Air"';
        document.getElementById('time').style.color = '#fff';

        this._buildLevelSelector();
        this._updateHUD();

        if (this.onReset) this.onReset();
    }

    nextLevel() {
        if (this.currentLevel < LEVELS.length - 1) this.currentLevel++;
        this.resetGame();
    }
}
