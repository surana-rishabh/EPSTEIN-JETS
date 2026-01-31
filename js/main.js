import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ==================== GLOBAL STATE ====================
let camera, scene, renderer, controls, reticle;
let hitTestSource = null, hitTestSourceRequested = false;
let isARMode = false, isARSupported = false;

const GAME_MODES = { QUICK_RACE: 'quick', TIME_ATTACK: 'time', CHECKPOINT_RACE: 'checkpoint', FREE_FLIGHT: 'free' };

let player = null, selectedPlane = 'plane1', currentGameMode = GAME_MODES.QUICK_RACE;
let checkpoints = [], finishLine = null, explosionPool = [], environmentObjects = [];
let isPlaced = false, isFlying = false, isPaused = false;
let gameStartTime = 0, gameTimer = null, topSpeed = 0, score = 0;
let checkpointsCollected = 0, totalCheckpoints = 10, lastCheckpointTime = 0, lastTime = 0;

const PHYSICS = { gravity: 9.8, airResistance: 0.985, groundHeight: 0.3, crashSpeed: 18, crashVelocity: 10 };
const SETTINGS = { quality: 'medium', shadows: true, particles: true, sensitivity: 1.0, invertY: false, vibration: true };
const PLANE_STATS = {
    plane1: { name: 'FALCON', speed: 1.0, handling: 1.1, boost: 1.0 },
    plane2: { name: 'RAPTOR', speed: 1.2, handling: 0.85, boost: 1.15 },
    plane3: { name: 'PHOENIX', speed: 0.85, handling: 1.3, boost: 0.9 },
    plane4: { name: 'SPECTRE', speed: 1.3, handling: 0.75, boost: 1.25 },
    plane5: { name: 'THUNDER', speed: 1.1, handling: 1.05, boost: 1.05 }
};

let touches = new Map();
let leftJoystick = { x: 0, y: 0, active: false, identifier: null };
let rightJoystick = { x: 0, y: 0, active: false, identifier: null };
let keys = {};

// ==================== INITIALIZATION ====================
checkARSupport().then(() => init());

async function checkARSupport() {
    if (navigator.xr) {
        try {
            isARSupported = await navigator.xr.isSessionSupported('immersive-ar');
        } catch (e) { isARSupported = false; }
    }
    console.log('AR Support:', isARSupported);
}

function init() {
    setupScene();
    setupRenderer();
    setupLighting();
    if (!isARSupported) createEnvironment();
    setupUI();
    setupControls();

    if (isARSupported) {
        renderer.setAnimationLoop(render);
    } else {
        requestAnimationFrame(render);
    }
    window.addEventListener('resize', onResize);

    setTimeout(() => {
        document.getElementById('loadingScreen').style.display = 'none';
        document.getElementById('mainMenu').style.display = 'flex';
        showInfo(isARSupported ? 'AR Mode Available!' : '3D Mode - AR not supported');
    }, 2000);
}

function setupScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1042, 50, 200);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 500);
    camera.position.set(0, 15, 30);

    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x00d4ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
}

function setupRenderer() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = SETTINGS.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    document.body.appendChild(renderer.domElement);

    if (isARSupported) {
        renderer.xr.enabled = true;
        const arButton = ARButton.createButton(renderer, {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.body }
        });
        arButton.style.display = 'none';
        arButton.id = 'arButton';
        document.body.appendChild(arButton);
    } else {
        renderer.setClearColor(0x1a1042);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.maxPolarAngle = Math.PI / 2.1;
    }
}

function setupLighting() {
    scene.add(new THREE.HemisphereLight(0x87ceeb, 0x2a2a4a, 2.5));
    const sun = new THREE.DirectionalLight(0xffd4a3, 3);
    sun.position.set(15, 25, 15);
    sun.castShadow = true;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
    scene.add(new THREE.PointLight(0x00d4ff, 2, 50).translateX(10).translateY(5));
    scene.add(new THREE.PointLight(0xff3366, 2, 50).translateX(-10).translateY(5));
    scene.add(new THREE.AmbientLight(0x404055, 1.8));
}

function createEnvironment() {
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500),
        new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(500, 100, 0x00d4ff, 0x1a1a4a);
    grid.position.y = 0.01;
    scene.add(grid);

    const skyGeo = new THREE.SphereGeometry(400, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
        uniforms: { topColor: { value: new THREE.Color(0x0a0a2e) }, bottomColor: { value: new THREE.Color(0x1a1042) } },
        vertexShader: `varying vec3 vPos; void main() { vPos = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vPos; void main() { float h = normalize(vPos).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0),0.6),0.0)), 1.0); }`,
        side: THREE.BackSide
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    for (let i = 0; i < 15; i++) {
        const size = 2 + Math.random() * 4;
        const block = new THREE.Mesh(
            new THREE.BoxGeometry(size, size * 2, size),
            new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 0.7, 0.3), metalness: 0.8 })
        );
        block.position.set((Math.random() - 0.5) * 200, size + Math.random() * 10, (Math.random() - 0.5) * 200);
        block.castShadow = true;
        scene.add(block);
        environmentObjects.push(block);
    }
}

// ==================== PLAYER CLASS ====================
class Player {
    constructor(planeId) {
        this.id = planeId;
        this.stats = PLANE_STATS[planeId];
        this.plane = new THREE.Group();
        this.propeller = null;
        this.trail = null;
        this.exhaustParticles = [];
        this.position = new THREE.Vector3(0, 5, 0);
        this.velocity = new THREE.Vector3();
        this.quaternion = new THREE.Quaternion();
        this.speed = 0; this.targetSpeed = 0;
        this.pitch = 0; this.roll = 0; this.yaw = 0;
        this.isBoosting = false; this.crashed = false;

        this.setupPlane();
        this.createTrail();
        this.createExhaust();
    }

    setupPlane() {
        new GLTFLoader().load(`assets/${this.id}.glb`,
            (gltf) => {
                while (this.plane.children.length) this.plane.remove(this.plane.children[0]);
                this.plane.add(gltf.scene);
                gltf.scene.traverse(c => {
                    if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
                    if (c.name?.toLowerCase().includes('prop')) this.propeller = c;
                });
                showInfo(`${this.stats.name} loaded!`);
            },
            undefined,
            () => this.createFallbackPlane()
        );
        this.createFallbackPlane();
        this.plane.visible = false;
        scene.add(this.plane);
    }

    createFallbackPlane() {
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2, 8), new THREE.MeshStandardMaterial({ color: 0xff3366, metalness: 0.8, emissive: 0xff3366, emissiveIntensity: 0.2 }));
        body.rotation.x = Math.PI / 2;
        body.castShadow = true;
        this.plane.add(body);

        const wings = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x00d4ff, metalness: 0.6 }));
        wings.position.z = 0.2;
        this.plane.add(wings);

        if (!this.propeller) {
            this.propeller = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x222222 }));
            this.propeller.position.z = -1.1;
            this.plane.add(this.propeller);
        }
        this.plane.add(new THREE.PointLight(0xff6600, 2, 3).translateZ(1));
    }

    createTrail() {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
        this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
        scene.add(this.trail);
    }

    createExhaust() {
        for (let i = 0; i < 20; i++) {
            const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
            p.userData = { life: 0, velocity: new THREE.Vector3() };
            this.exhaustParticles.push(p);
            scene.add(p);
        }
    }

    updatePhysics(dt) {
        if (this.crashed || !isFlying) return;

        const turn = 2.2 * dt * this.stats.handling * SETTINGS.sensitivity;
        this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch * turn))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw * turn))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.roll * turn)).normalize();

        const maxSpeed = (this.isBoosting ? 21.6 : 12) * this.stats.speed * (this.isBoosting ? this.stats.boost : 1);
        this.targetSpeed = Math.max(0, Math.min(maxSpeed, this.targetSpeed));
        this.speed += (this.targetSpeed - this.speed) * dt * 5;
        topSpeed = Math.max(topSpeed, this.speed);

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
        this.velocity.copy(forward).multiplyScalar(this.speed);
        this.velocity.y -= PHYSICS.gravity * dt * 0.4;
        this.velocity.multiplyScalar(PHYSICS.airResistance);
        this.position.add(this.velocity.clone().multiplyScalar(dt));

        if (this.position.y < PHYSICS.groundHeight) {
            if (this.speed > PHYSICS.crashSpeed || Math.abs(this.velocity.y) > PHYSICS.crashVelocity) { this.crash(); return; }
            this.position.y = PHYSICS.groundHeight;
            this.velocity.y = Math.abs(this.velocity.y) * 0.3;
        }

        this.plane.position.copy(this.position);
        this.plane.quaternion.copy(this.quaternion);
        if (this.propeller) this.propeller.rotation.z += this.speed * dt * 5;
        this.updateTrail();
        this.updateExhaust(dt);
    }

    updateTrail() {
        if (!this.trail) return;
        const pos = this.trail.geometry.attributes.position.array;
        for (let i = pos.length - 3; i >= 3; i -= 3) { pos[i] = pos[i - 3]; pos[i + 1] = pos[i - 2]; pos[i + 2] = pos[i - 1]; }
        const ep = this.position.clone().add(new THREE.Vector3(0, 0, 0.8).applyQuaternion(this.quaternion));
        pos[0] = ep.x; pos[1] = ep.y; pos[2] = ep.z;
        this.trail.geometry.attributes.position.needsUpdate = true;
        this.trail.material.color.setHex(this.isBoosting ? 0xff6600 : 0x00d4ff);
        this.trail.material.opacity = this.isBoosting ? 0.9 : 0.6;
    }

    updateExhaust(dt) {
        this.exhaustParticles.forEach(p => {
            p.userData.life -= dt * 2;
            if (p.userData.life <= 0 && this.isBoosting) {
                p.position.copy(this.position).add(new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion));
                p.userData.life = 1.0;
                p.userData.velocity.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, Math.random() * 3);
                p.material.opacity = 0.8;
            }
            p.position.add(p.userData.velocity.clone().multiplyScalar(dt));
            p.material.opacity = p.userData.life * 0.8;
        });
    }

    crash() {
        if (this.crashed) return;
        this.crashed = true; this.velocity.set(0, 0, 0); this.speed = 0;
        this.plane.visible = false;
        if (SETTINGS.vibration && navigator.vibrate) navigator.vibrate([200, 100, 200]);
        setTimeout(() => endGame('CRASHED', false), 1000);
    }

    setControls(pitch, roll, yaw, throttle, boost) {
        this.pitch = pitch * (SETTINGS.invertY ? -1 : 1);
        this.roll = roll; this.yaw = yaw;
        this.targetSpeed = throttle * (boost ? 20 : 12) * this.stats.speed;
        this.isBoosting = boost;
    }

    destroy() {
        if (this.plane) scene.remove(this.plane);
        if (this.trail) scene.remove(this.trail);
        this.exhaustParticles.forEach(p => scene.remove(p));
    }
}

// ==================== GAME OBJECTS ====================
function createGameObjects() {
    clearGameObjects();
    if (currentGameMode === GAME_MODES.FREE_FLIGHT) { createExplorationObjects(); return; }
    createCheckpoints(totalCheckpoints);
    createFinishLine();
}

function clearGameObjects() {
    checkpoints.forEach(cp => scene.remove(cp)); checkpoints = [];
    if (finishLine) { scene.remove(finishLine); finishLine = null; }
}

function createCheckpoints(count) {
    const radius = 15;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const height = 5 + Math.sin(i * 0.6) * 3;
        const cp = createCheckpointRing(i + 1);
        cp.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
        const nextAngle = ((i + 1) / count) * Math.PI * 2;
        cp.lookAt(Math.cos(nextAngle) * radius, height, Math.sin(nextAngle) * radius);
        cp.userData = { index: i, collected: false, timer: 0 };
        scene.add(cp); checkpoints.push(cp);
    }
}

function createCheckpointRing(num) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.18, 16, 32), new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 }));
    ring.castShadow = true; g.add(ring);
    g.add(new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.12, 16, 32), new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending })));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#00ff88'; ctx.font = 'bold 140px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(num.toString(), 128, 128);
    const numPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, side: THREE.DoubleSide }));
    numPlane.position.z = 0.2; g.add(numPlane);
    g.add(new THREE.PointLight(0x00ff88, 2, 8));
    return g;
}

function createFinishLine() {
    finishLine = new THREE.Group();
    for (let i = -1; i <= 1; i += 2) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        pole.position.set(i * 2, 2, 0); finishLine.add(pole);
    }
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 === 0 ? '#fff' : '#000'; ctx.fillRect(x * 64, y * 64, 64, 64); }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide }));
    banner.position.y = 3; finishLine.add(banner);
    finishLine.add(new THREE.PointLight(0xffcc00, 3, 12).translateY(3));
    finishLine.visible = false; scene.add(finishLine);
}

function createExplorationObjects() {
    for (let i = 0; i < 15; i++) {
        const ring = createCheckpointRing(i + 1);
        ring.position.set((Math.random() - 0.5) * 60, Math.random() * 25 + 3, (Math.random() - 0.5) * 60);
        ring.userData = { collected: false, timer: 0 };
        scene.add(ring); checkpoints.push(ring);
    }
    totalCheckpoints = 15;
}

// ==================== GAME LOGIC ====================
function startGame() {
    isFlying = true; isPaused = false; gameStartTime = Date.now();
    checkpointsCollected = 0; topSpeed = 0; score = 0;
    createGameObjects();
    if (finishLine) finishLine.visible = false;

    document.getElementById('gameHUD').style.display = 'block';
    document.getElementById('gameControls').style.display = 'block';

    const icons = { quick: '⚡', time: '⏱️', checkpoint: '🎯', free: '🌅' };
    const names = { quick: 'QUICK RACE', time: 'TIME ATTACK', checkpoint: 'CHECKPOINT RACE', free: 'FREE FLIGHT' };
    document.getElementById('modeIcon').textContent = icons[currentGameMode];
    document.getElementById('modeText').textContent = names[currentGameMode];
    document.getElementById('checkpointDisplay').style.display = currentGameMode !== 'free' ? 'block' : 'none';
    document.getElementById('checkpointsTotal').textContent = totalCheckpoints;

    gameTimer = setInterval(() => {
        if (isPaused) return;
        const elapsed = (Date.now() - gameStartTime) / 1000;
        document.getElementById('gameTimer').textContent = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toFixed(2).padStart(5, '0')}`;
    }, 100);

    showInfo('Race started! Fly through checkpoints!');
}

function updateGameLogic(dt) {
    if (!isFlying || !player || isPaused) return;

    const pitch = -leftJoystick.y * 0.9;
    const throttle = 0.75 + (leftJoystick.y < 0 ? -leftJoystick.y * 0.25 : 0);
    const yaw = rightJoystick.x * 0.7;
    const roll = rightJoystick.x * 0.5 + rightJoystick.y * 0.3;

    player.setControls(pitch, roll, yaw, throttle, player.isBoosting);
    player.updatePhysics(dt);
    checkCheckpoints();
    updateHUD();
    if (!isARMode) updateFollowCamera();
}

function updateFollowCamera() {
    if (!player || !isFlying) return;
    const offset = new THREE.Vector3(0, 4, 12).applyQuaternion(player.quaternion);
    camera.position.lerp(player.position.clone().add(offset), 0.08);
    camera.lookAt(player.position.clone().translateY(1));
}

function checkCheckpoints() {
    if (!player || player.crashed) return;
    checkpoints.forEach((cp, i) => {
        if (cp.userData.collected) { cp.children[0].material.opacity = Math.max(0, cp.children[0].material.opacity - 0.01); return; }
        if (player.position.distanceTo(cp.position) < 2.5) collectCheckpoint(cp, i);
    });
    if (currentGameMode !== 'free' && checkpointsCollected === totalCheckpoints && finishLine?.visible && player.position.distanceTo(finishLine.position) < 4) endGame('VICTORY', true);
}

function collectCheckpoint(cp, i) {
    cp.userData.collected = true;
    cp.children[0].material.color.setHex(0xffd700);
    cp.children[0].material.emissive.setHex(0xffd700);
    checkpointsCollected++;
    const now = Date.now();
    const bonus = lastCheckpointTime ? Math.max(0, 100 - (now - lastCheckpointTime) / 100) : 100;
    score += Math.round(100 + bonus);
    lastCheckpointTime = now;
    if (SETTINGS.vibration && navigator.vibrate) navigator.vibrate(50);
    document.getElementById('checkpointAlert').classList.add('show');
    setTimeout(() => document.getElementById('checkpointAlert').classList.remove('show'), 600);

    if (checkpointsCollected === totalCheckpoints && finishLine) {
        finishLine.visible = true;
        showInfo('All checkpoints! Head to finish!');
    } else {
        showInfo(`Checkpoint ${checkpointsCollected}/${totalCheckpoints}`);
    }
}

function updateHUD() {
    if (!player) return;
    const spd = Math.round(player.speed * 25);
    document.getElementById('speedValue').textContent = spd;
    document.getElementById('speedBar').style.width = `${Math.min(100, spd / 3)}%`;
    document.getElementById('altValue').textContent = player.position.y.toFixed(1);
    if (currentGameMode !== 'free') {
        document.getElementById('checkpointsCurrent').textContent = checkpointsCollected;
        document.getElementById('checkpointProgress').style.width = `${(checkpointsCollected / totalCheckpoints) * 100}%`;
    }
    document.getElementById('boostIndicator').classList.toggle('active', player.isBoosting);
}

function endGame(result, isWin) {
    isFlying = false;
    if (gameTimer) clearInterval(gameTimer);
    document.getElementById('gameHUD').style.display = 'none';
    document.getElementById('gameControls').style.display = 'none';
    document.getElementById('resultsTitle').textContent = result;
    document.getElementById('resultsRank').textContent = isWin ? '1ST' : '---';
    document.getElementById('finalTime').textContent = ((Date.now() - gameStartTime) / 1000).toFixed(2) + 's';
    document.getElementById('finalCheckpoints').textContent = `${checkpointsCollected}/${totalCheckpoints}`;
    document.getElementById('finalSpeed').textContent = Math.round(topSpeed * 25) + ' km/h';
    document.getElementById('finalScore').textContent = score;
    document.getElementById('resultsScreen').style.display = 'flex';
}

function resetGame() {
    isFlying = false; isPaused = false; isPlaced = false;
    if (player) { player.destroy(); player = null; }
    clearGameObjects();
    explosionPool.forEach(e => scene.remove(e)); explosionPool = [];
    checkpointsCollected = 0; gameStartTime = 0; topSpeed = 0; score = 0;
    if (gameTimer) clearInterval(gameTimer);
    ['gameHUD', 'gameControls', 'resultsScreen', 'pauseMenu'].forEach(id => document.getElementById(id).style.display = 'none');
    camera.position.set(0, 15, 30); camera.lookAt(0, 0, 0);
}

// ==================== UI SETUP ====================
function setupUI() {
    document.getElementById('quickPlayBtn').onclick = () => { currentGameMode = 'quick'; totalCheckpoints = 10; showPlaneSelection(); };
    document.getElementById('timeAttackBtn').onclick = () => { currentGameMode = 'time'; totalCheckpoints = 8; showPlaneSelection(); };
    document.getElementById('checkpointRaceBtn').onclick = () => { currentGameMode = 'checkpoint'; totalCheckpoints = 15; showPlaneSelection(); };
    document.getElementById('freeFlightBtn').onclick = () => { currentGameMode = 'free'; showPlaneSelection(); };
    document.getElementById('settingsBtn').onclick = () => document.getElementById('settingsPanel').style.display = 'flex';
    document.getElementById('closeSettings').onclick = () => document.getElementById('settingsPanel').style.display = 'none';
    document.getElementById('leaderboardBtn').onclick = () => showInfo('Leaderboard coming soon!');
    document.getElementById('helpBtn').onclick = () => showInfo('Left joystick: throttle/pitch. Right: yaw/roll. Collect checkpoints!');

    document.querySelectorAll('.select-plane-btn').forEach(btn => {
        btn.onclick = (e) => {
            selectedPlane = e.target.closest('.plane-card').dataset.plane;
            if (isARSupported) showARPlacement();
            else placePlane(true);
        };
    });

    document.getElementById('backFromPlanes').onclick = () => { document.getElementById('planeSelection').style.display = 'none'; document.getElementById('mainMenu').style.display = 'flex'; };
    document.getElementById('placeOnFloorBtn').onclick = () => { if (reticle.visible) placePlane(false); else showInfo('No surface! Use "Place in Air"'); };
    document.getElementById('placeInAirBtn').onclick = () => placePlane(true);

    document.getElementById('pauseBtn').onclick = togglePause;
    document.getElementById('resumeBtn').onclick = togglePause;
    document.getElementById('restartBtn').onclick = () => { resetGame(); if (isARSupported) showARPlacement(); else showPlaneSelection(); };
    document.getElementById('quitBtn').onclick = () => { resetGame(); document.getElementById('mainMenu').style.display = 'flex'; };
    document.getElementById('playAgainBtn').onclick = () => { resetGame(); if (isARSupported) showARPlacement(); else showPlaneSelection(); };
    document.getElementById('menuBtn').onclick = () => { resetGame(); document.getElementById('mainMenu').style.display = 'flex'; };

    document.getElementById('qualitySelect').onchange = (e) => { SETTINGS.quality = e.target.value; applyQuality(); };
    document.getElementById('shadowsToggle').onchange = (e) => { SETTINGS.shadows = e.target.checked; renderer.shadowMap.enabled = SETTINGS.shadows; };
    document.getElementById('sensitivitySlider').oninput = (e) => SETTINGS.sensitivity = parseFloat(e.target.value);
    document.getElementById('invertToggle').onchange = (e) => SETTINGS.invertY = e.target.checked;
    document.getElementById('vibrationToggle').onchange = (e) => SETTINGS.vibration = e.target.checked;
}

function showPlaneSelection() { document.getElementById('mainMenu').style.display = 'none'; document.getElementById('planeSelection').style.display = 'flex'; }
function showARPlacement() { document.getElementById('planeSelection').style.display = 'none'; document.getElementById('arPlacement').style.display = 'flex'; isARMode = true; document.getElementById('arButton')?.click(); }

function placePlane(inAir) {
    player = new Player(selectedPlane);
    if (inAir) {
        if (isARMode) {
            const camPos = camera.getWorldPosition(new THREE.Vector3());
            const camDir = new THREE.Vector3(0, 0, -4).applyQuaternion(camera.quaternion);
            player.position.copy(camPos).add(camDir);
            player.position.y = Math.max(player.position.y, 2);
            player.quaternion.copy(camera.quaternion);
        } else {
            player.position.set(0, 5, 0);
            player.quaternion.identity();
        }
    } else {
        player.position.setFromMatrixPosition(reticle.matrix);
        player.position.y += 1.5;
        player.quaternion.identity();
    }
    player.plane.position.copy(player.position);
    player.plane.quaternion.copy(player.quaternion);
    player.plane.visible = true;
    player.speed = 6; player.targetSpeed = 10;
    isPlaced = true;
    document.getElementById('arPlacement').style.display = 'none';
    document.getElementById('planeSelection').style.display = 'none';
    startGame();
}

function togglePause() {
    isPaused = !isPaused;
    document.getElementById('pauseMenu').style.display = isPaused ? 'flex' : 'none';
    if (isPaused) {
        document.getElementById('pauseTime').textContent = ((Date.now() - gameStartTime) / 1000).toFixed(2) + 's';
        document.getElementById('pauseCheckpoints').textContent = `${checkpointsCollected}/${totalCheckpoints}`;
    }
}

function applyQuality() {
    if (SETTINGS.quality === 'low') { renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; }
    else if (SETTINGS.quality === 'medium') { renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.shadowMap.enabled = true; }
    else { renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.shadowMap.enabled = true; }
}

function showInfo(msg) {
    document.getElementById('infoText').textContent = msg;
    document.getElementById('infoDisplay').classList.add('show');
    setTimeout(() => document.getElementById('infoDisplay').classList.remove('show'), 3000);
}

// ==================== CONTROLS ====================
function setupControls() {
    const leftJoy = document.getElementById('leftJoystick'), rightJoy = document.getElementById('rightJoystick');
    const leftStick = document.getElementById('leftStick'), rightStick = document.getElementById('rightStick');

    document.addEventListener('touchstart', (e) => {
        Array.from(e.changedTouches).forEach(t => {
            const lr = leftJoy.getBoundingClientRect(), rr = rightJoy.getBoundingClientRect();
            if (t.clientX >= lr.left && t.clientX <= lr.right && t.clientY >= lr.top && t.clientY <= lr.bottom) {
                leftJoystick.identifier = t.identifier; leftJoystick.active = true; touches.set(t.identifier, 'left');
            } else if (t.clientX >= rr.left && t.clientX <= rr.right && t.clientY >= rr.top && t.clientY <= rr.bottom) {
                rightJoystick.identifier = t.identifier; rightJoystick.active = true; touches.set(t.identifier, 'right');
            }
        });
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        e.preventDefault();
        Array.from(e.changedTouches).forEach(t => {
            const side = touches.get(t.identifier); if (!side) return;
            const joy = side === 'left' ? leftJoy : rightJoy, stick = side === 'left' ? leftStick : rightStick, data = side === 'left' ? leftJoystick : rightJoystick;
            const rect = joy.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
            let dx = t.clientX - cx, dy = t.clientY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy), max = rect.width / 2 - 35;
            if (dist > max) { const a = Math.atan2(dy, dx); dx = Math.cos(a) * max; dy = Math.sin(a) * max; }
            stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            data.x = dx / max; data.y = dy / max;
        });
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        Array.from(e.changedTouches).forEach(t => {
            const side = touches.get(t.identifier); if (!side) return;
            const stick = side === 'left' ? leftStick : rightStick, data = side === 'left' ? leftJoystick : rightJoystick;
            stick.style.transform = 'translate(-50%, -50%)';
            data.x = 0; data.y = 0; data.active = false; data.identifier = null;
            touches.delete(t.identifier);
        });
    });

    window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; if (['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault(); if (e.key === 'Escape' && isFlying) togglePause(); });
    window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

    setInterval(() => {
        if (!isFlying || isPaused) return;
        if (keys['w'] || keys['arrowup']) leftJoystick.y = -1; else if (keys['s'] || keys['arrowdown']) leftJoystick.y = 1; else if (!leftJoystick.active) leftJoystick.y = 0;
        if (keys['a'] || keys['arrowleft']) rightJoystick.x = -1; else if (keys['d'] || keys['arrowright']) rightJoystick.x = 1; else if (!rightJoystick.active) rightJoystick.x = 0;
        if (keys['q']) rightJoystick.y = -1; else if (keys['e']) rightJoystick.y = 1; else if (!rightJoystick.active) rightJoystick.y = 0;
        if (player && (keys[' '] || keys['shift'])) { player.isBoosting = true; document.getElementById('boostBtn').classList.add('active'); }
        else if (player && !document.getElementById('boostBtn').classList.contains('touching')) { player.isBoosting = false; document.getElementById('boostBtn').classList.remove('active'); }
    }, 16);

    const boostBtn = document.getElementById('boostBtn');
    boostBtn.addEventListener('touchstart', (e) => { e.preventDefault(); if (player) { player.isBoosting = true; boostBtn.classList.add('active', 'touching'); } });
    boostBtn.addEventListener('touchend', (e) => { e.preventDefault(); if (player) { player.isBoosting = false; boostBtn.classList.remove('active', 'touching'); } });
    boostBtn.addEventListener('mousedown', (e) => { e.preventDefault(); if (player) { player.isBoosting = true; boostBtn.classList.add('active', 'touching'); } });
    boostBtn.addEventListener('mouseup', (e) => { e.preventDefault(); if (player) { player.isBoosting = false; boostBtn.classList.remove('active', 'touching'); } });
}

// ==================== ANIMATION LOOP ====================
function render(timestamp, frame) {
    if (!isARSupported) requestAnimationFrame(render);

    const dt = Math.min(0.05, (timestamp - lastTime) / 1000) || 0.016;
    lastTime = timestamp;

    // AR hit-test
    if (frame && isARMode && !isPlaced) {
        if (!hitTestSourceRequested) {
            const session = renderer.xr.getSession();
            if (session) {
                session.requestReferenceSpace('viewer').then(ref => {
                    session.requestHitTestSource({ space: ref }).then(src => {
                        hitTestSource = src;
                        document.getElementById('arStatus').textContent = 'Surface detected! Tap "Place on Surface"';
                    }).catch(() => document.getElementById('arStatus').textContent = 'No surface. Use "Place in Air"');
                });
                hitTestSourceRequested = true;
            }
        }
        if (hitTestSource) {
            const results = frame.getHitTestResults(hitTestSource);
            if (results.length > 0) {
                const pose = results[0].getPose(renderer.xr.getReferenceSpace());
                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
            } else reticle.visible = false;
        }
    }

    updateGameLogic(dt);

    checkpoints.forEach(cp => {
        if (!cp.userData.collected) {
            cp.userData.timer += dt;
            const s = 1 + Math.sin(cp.userData.timer * 4) * 0.12;
            cp.scale.set(s, s, s);
            cp.rotation.y += dt * 0.8;
        }
    });

    if (finishLine?.visible) finishLine.rotation.y += dt * 0.5;
    if (!isFlying && controls) controls.update();

    renderer.render(scene, camera);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) { SETTINGS.quality = 'medium'; applyQuality(); }

console.log('%c🛩️ EPSTEIN JETS', 'font-size: 20px; font-weight: bold; color: #00d4ff;');
console.log('%cAR + 3D Hybrid Mode', 'font-size: 12px; color: #ff3366;');