import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

/* ================================================
   EPSTEIN JETS - XR Racing Game Engine v3.0
   Hybrid AR/3D Mode with Full Feature Set
   ================================================ */

// ==================== CONFIGURATION ====================
const CONFIG = {
    physics: {
        gravity: 9.8,
        airResistance: 0.985,
        groundHeight: 0.3,
        crashSpeed: 18,
        maxSpeed: 12,
        boostSpeed: 22,
        turnSpeed: 2.5
    },
    scaling: {
        referenceDistance: 3,
        baseScale: 0.4,
        minScale: 0.2,
        maxScale: 1.2
    },
    game: {
        racingCheckpoints: 10,
        obstacleCheckpoints: 12,
        boostDuration: 100,
        boostRechargeRate: 0.3
    }
};

// ==================== GLOBAL STATE ====================
let camera, scene, renderer, controls;
let reticle, groundPlane, gridHelper;
let isARMode = false;
let isXRSupported = false;
let hitTestSource = null;
let hitTestSourceRequested = false;
let xrSession = null;
let localReferenceSpace = null;

// Game Objects
let plane, planeModel, propeller;
let checkpoints = [];
let obstacles = [];
let powerups = [];
let finishLine = null;
let trails = [];

// Player State
const planePos = new THREE.Vector3(0, 2, 0);
const planeQuat = new THREE.Quaternion();
const planeVel = new THREE.Vector3();
let speed = 0;
let targetSpeed = 8;
let pitch = 0, roll = 0, yaw = 0;

// Game State
let currentMode = null;
let isPlaced = false;
let isFlying = false;
let isPaused = false;
let checkpointsCollected = 0;
let totalCheckpoints = 10;
let gameStartTime = 0;
let gameTimer = null;
let topSpeed = 0;
let isBoosting = false;
let boostMeter = 100;
let hasShield = false;
let shieldTimer = 0;

// Controls
let leftJoy = { x: 0, y: 0 };
let rightJoy = { x: 0, y: 0 };
let keys = {};
let touches = new Map();

// Settings
let settings = {
    sensitivity: 1.0,
    invertY: false,
    quality: 'medium',
    showMinimap: true,
    sfx: true
};

// ==================== INITIALIZATION ====================
init();

async function init() {
    updateLoadingProgress(10, 'Setting up scene...');
    setupScene();

    updateLoadingProgress(20, 'Configuring renderer...');
    await setupRenderer();

    updateLoadingProgress(40, 'Adding lights...');
    setupLighting();

    updateLoadingProgress(50, 'Creating ground...');
    createGroundPlane();

    updateLoadingProgress(60, 'Loading aircraft...');
    await loadPlaneModel();

    updateLoadingProgress(80, 'Setting up controls...');
    setupUI();
    setupControls();

    updateLoadingProgress(100, 'Ready!');

    setTimeout(() => {
        document.getElementById('loadingScreen').classList.remove('active');
        document.getElementById('mainMenu').classList.add('active');
    }, 500);

    renderer.setAnimationLoop(render);
    window.addEventListener('resize', onResize);
}

function updateLoadingProgress(percent, text) {
    const bar = document.getElementById('loadingProgress');
    const label = document.getElementById('loadingText');
    if (bar) bar.style.width = percent + '%';
    if (label) label.textContent = text;
}

// ==================== SCENE SETUP ====================
function setupScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0e27, 0.015);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 500);
    camera.position.set(0, 5, 10);

    // AR Reticle
    const reticleGeo = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9
    });
    reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
}

async function setupRenderer() {
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    document.getElementById('canvasContainer').appendChild(renderer.domElement);

    // Check XR Support
    if (navigator.xr) {
        try {
            isXRSupported = await navigator.xr.isSessionSupported('immersive-ar');
        } catch (e) {
            isXRSupported = false;
        }
    }

    // Enable XR if supported
    if (isXRSupported) {
        renderer.xr.enabled = true;

        // Create hidden AR button for programmatic use
        const arButton = ARButton.createButton(renderer, {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay', 'light-estimation'],
            domOverlay: { root: document.body }
        });
        arButton.id = 'ARButton';
        arButton.style.display = 'none';
        document.body.appendChild(arButton);

        // AR session event handlers
        renderer.xr.addEventListener('sessionstart', () => {
            isARMode = true;
            xrSession = renderer.xr.getSession();

            // Hide ground plane in AR mode
            if (groundPlane) groundPlane.visible = false;
            if (gridHelper) gridHelper.visible = false;

            // Remove fog in AR
            scene.fog = null;
            scene.background = null;

            console.log('AR session started');
        });

        renderer.xr.addEventListener('sessionend', () => {
            isARMode = false;
            xrSession = null;
            hitTestSource = null;
            hitTestSourceRequested = false;

            // Show ground plane when exiting AR
            if (groundPlane) groundPlane.visible = true;
            if (gridHelper) gridHelper.visible = true;

            // Restore fog
            scene.fog = new THREE.FogExp2(0x0a0e27, 0.015);

            console.log('AR session ended');
        });
    }

    // Setup mode indicator
    const indicator = document.getElementById('modeIndicator');
    if (indicator) {
        if (isXRSupported) {
            indicator.innerHTML = '<span class="mode-icon">📱</span><span class="mode-label">AR MODE</span>';
            indicator.classList.add('ar-mode');
        } else {
            indicator.innerHTML = '<span class="mode-icon">🖥️</span><span class="mode-label">3D MODE</span>';
        }
    }

    // Setup orbit controls for 3D mode fallback
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 3;
    controls.maxDistance = 50;
    controls.enabled = false;
}

function setupLighting() {
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 1.5);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2);
    sunLight.position.set(10, 20, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 30;
    sunLight.shadow.camera.bottom = -30;
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x404040, 1);
    scene.add(ambientLight);

    // Accent lights
    const accent1 = new THREE.PointLight(0x00d4ff, 1, 40);
    accent1.position.set(10, 5, 10);
    scene.add(accent1);

    const accent2 = new THREE.PointLight(0xff3366, 1, 40);
    accent2.position.set(-10, 5, -10);
    scene.add(accent2);
}

function createGroundPlane() {
    // Visual ground
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        metalness: 0.3,
        roughness: 0.8,
        transparent: true,
        opacity: 0.9
    });
    groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // Grid
    gridHelper = new THREE.GridHelper(100, 50, 0x00d4ff, 0x1a1a3e);
    gridHelper.position.y = 0.01;
    gridHelper.material.opacity = 0.4;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);
}

// ==================== PLANE CREATION ====================
function loadPlaneModel() {
    return new Promise((resolve) => {
        plane = new THREE.Group();

        const loader = new GLTFLoader();
        loader.load(
            'assets/plane.glb',
            (gltf) => {
                planeModel = gltf.scene;
                planeModel.scale.set(0.5, 0.5, 0.5);

                while (plane.children.length > 0) {
                    plane.remove(plane.children[0]);
                }
                plane.add(planeModel);

                planeModel.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                    if (child.name && child.name.toLowerCase().includes('prop')) {
                        propeller = child;
                    }
                });

                console.log('Plane model loaded');
                resolve();
            },
            undefined,
            (error) => {
                console.warn('Loading fallback plane:', error);
                createFallbackPlane();
                resolve();
            }
        );

        createFallbackPlane();
        plane.visible = false;
        scene.add(plane);
    });
}

function createFallbackPlane() {
    // Fuselage
    const bodyGeo = new THREE.ConeGeometry(0.25, 1.8, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xff3366,
        metalness: 0.8,
        roughness: 0.2,
        emissive: 0xff3366,
        emissiveIntensity: 0.1
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    plane.add(body);

    // Wings
    const wingGeo = new THREE.BoxGeometry(2.5, 0.08, 0.5);
    const wingMat = new THREE.MeshStandardMaterial({
        color: 0x00d4ff,
        metalness: 0.6,
        roughness: 0.4
    });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.position.z = 0.2;
    wings.castShadow = true;
    plane.add(wings);

    // Tail
    const tailGeo = new THREE.BoxGeometry(0.08, 0.5, 0.4);
    const tail = new THREE.Mesh(tailGeo, wingMat);
    tail.position.set(0, 0.25, 0.7);
    tail.castShadow = true;
    plane.add(tail);

    // Cockpit
    const cockpitGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const cockpitMat = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.6,
        emissive: 0x00ffff,
        emissiveIntensity: 0.3
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 0.15, -0.5);
    cockpit.scale.set(1, 0.7, 1);
    plane.add(cockpit);

    // Propeller
    if (!propeller) {
        const propGeo = new THREE.BoxGeometry(1.2, 0.08, 0.08);
        const propMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9 });
        propeller = new THREE.Mesh(propGeo, propMat);
        propeller.position.z = -0.95;
        plane.add(propeller);
    }

    // Engine glow
    const engineLight = new THREE.PointLight(0xff6600, 1.5, 3);
    engineLight.position.set(0, 0, 0.9);
    plane.add(engineLight);
}

// ==================== GAME OBJECTS ====================
function createGameObjects() {
    clearGameObjects();

    if (currentMode === 'racing') {
        createRacingTrack();
    } else if (currentMode === 'obstacles') {
        createObstacleCourse();
    }
}

function clearGameObjects() {
    checkpoints.forEach(cp => scene.remove(cp));
    checkpoints = [];

    obstacles.forEach(obs => scene.remove(obs));
    obstacles = [];

    powerups.forEach(pu => scene.remove(pu));
    powerups = [];

    if (finishLine) {
        scene.remove(finishLine);
        finishLine = null;
    }
}

function createCheckpointRing(number, color = 0x00ff88) {
    const group = new THREE.Group();

    const ringGeo = new THREE.TorusGeometry(1.2, 0.12, 16, 32);
    const ringMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.6,
        metalness: 0.5,
        roughness: 0.3,
        transparent: true,
        opacity: 0.9
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.castShadow = true;
    group.add(ring);

    // Glow ring
    const glowGeo = new THREE.TorusGeometry(1.0, 0.08, 16, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending
    });
    group.add(new THREE.Mesh(glowGeo, glowMat));

    // Number
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 80px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(number.toString(), 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const numMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
    const numPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), numMat);
    numPlane.position.z = 0.15;
    group.add(numPlane);

    const light = new THREE.PointLight(color, 1.5, 6);
    group.add(light);

    return group;
}

function createRacingTrack() {
    totalCheckpoints = CONFIG.game.racingCheckpoints;
    const radius = 15;

    for (let i = 0; i < totalCheckpoints; i++) {
        const angle = (i / totalCheckpoints) * Math.PI * 2;
        const height = 2 + Math.sin(i * 0.8) * 1.5;

        const checkpoint = createCheckpointRing(i + 1);
        checkpoint.position.set(
            Math.cos(angle) * radius,
            height,
            Math.sin(angle) * radius
        );

        const nextAngle = ((i + 1) / totalCheckpoints) * Math.PI * 2;
        checkpoint.lookAt(Math.cos(nextAngle) * radius, height, Math.sin(nextAngle) * radius);

        checkpoint.userData = { index: i, collected: false, timer: 0 };

        scene.add(checkpoint);
        checkpoints.push(checkpoint);

        // Add boost pickup every 3rd checkpoint
        if (i % 3 === 1) {
            const boost = createPowerup('boost');
            boost.position.set(
                Math.cos(angle + 0.15) * (radius - 2),
                height + 0.5,
                Math.sin(angle + 0.15) * (radius - 2)
            );
            scene.add(boost);
            powerups.push(boost);
        }
    }

    // Finish line
    createFinishLine();
    finishLine.position.set(radius, 0, 0);
    finishLine.visible = false;
}

function createObstacleCourse() {
    totalCheckpoints = CONFIG.game.obstacleCheckpoints;

    for (let i = 0; i < totalCheckpoints; i++) {
        const distance = 6 + i * 4;
        const lateralOffset = (Math.random() - 0.5) * 10;
        const height = 1.5 + Math.random() * 2.5;

        const checkpoint = createCheckpointRing(i + 1);
        checkpoint.position.set(lateralOffset, height, -distance);
        checkpoint.lookAt(lateralOffset, height, -(distance + 5));
        checkpoint.userData = { index: i, collected: false, timer: 0 };
        scene.add(checkpoint);
        checkpoints.push(checkpoint);

        // Add obstacles
        if (i > 0 && i < totalCheckpoints - 1) {
            const obsType = i % 5;
            let obstacle;

            switch (obsType) {
                case 0: obstacle = createSpinningBarrier(); break;
                case 1: obstacle = createMovingWall(); break;
                case 2: obstacle = createTunnelRings(); break;
                case 3: obstacle = createBumpers(); break;
                default: obstacle = createBasicObstacle();
            }

            obstacle.position.set(
                lateralOffset + (Math.random() - 0.5) * 5,
                height,
                -distance + 2
            );
            obstacle.userData = { type: 'obstacle', animTimer: 0 };
            scene.add(obstacle);
            obstacles.push(obstacle);
        }

        // Shield pickup
        if (i % 4 === 2) {
            const shield = createPowerup('shield');
            shield.position.set(lateralOffset + 2, height + 1, -distance);
            scene.add(shield);
            powerups.push(shield);
        }
    }

    createFinishLine();
    finishLine.position.set(0, 0, -(6 + totalCheckpoints * 4));
    finishLine.visible = false;
}

function createBasicObstacle() {
    const types = ['cube', 'sphere', 'torus'];
    const type = types[Math.floor(Math.random() * types.length)];

    let geometry;
    switch (type) {
        case 'cube': geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2); break;
        case 'sphere': geometry = new THREE.SphereGeometry(0.7, 16, 16); break;
        case 'torus': geometry = new THREE.TorusGeometry(0.6, 0.25, 16, 32); break;
    }

    const material = new THREE.MeshStandardMaterial({
        color: 0xff3366,
        emissive: 0xff3366,
        emissiveIntensity: 0.25,
        metalness: 0.6,
        roughness: 0.4,
        transparent: true,
        opacity: 0.85
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
}

function createSpinningBarrier() {
    const group = new THREE.Group();
    const barGeo = new THREE.BoxGeometry(4, 0.2, 0.2);
    const barMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff6600, emissiveIntensity: 0.3 });

    for (let i = 0; i < 2; i++) {
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.rotation.z = (i * Math.PI) / 2;
        bar.castShadow = true;
        group.add(bar);
    }

    group.userData.spinSpeed = 1.5;
    return group;
}

function createMovingWall() {
    const group = new THREE.Group();
    const wallGeo = new THREE.BoxGeometry(3, 2, 0.3);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6600ff, emissive: 0x6600ff, emissiveIntensity: 0.2 });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.castShadow = true;
    group.add(wall);
    group.userData.moveRange = 4;
    group.userData.moveSpeed = 1;
    return group;
}

function createTunnelRings() {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
        const ringGeo = new THREE.TorusGeometry(1.5, 0.1, 16, 32);
        const ringMat = new THREE.MeshStandardMaterial({ color: 0x00ffaa, emissive: 0x00ffaa, emissiveIntensity: 0.3 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.z = i * 1.5;
        ring.castShadow = true;
        group.add(ring);
    }
    return group;
}

function createBumpers() {
    const group = new THREE.Group();
    for (let i = 0; i < 4; i++) {
        const sphereGeo = new THREE.SphereGeometry(0.5, 16, 16);
        const sphereMat = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.4 });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.set((i % 2) * 2 - 1, Math.floor(i / 2) * 1.5, 0);
        sphere.castShadow = true;
        group.add(sphere);
    }
    return group;
}

function createPowerup(type) {
    const group = new THREE.Group();

    const color = type === 'boost' ? 0xffcc00 : 0x00ffff;
    const icon = type === 'boost' ? '⚡' : '🛡️';

    const sphereGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.8
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    group.add(sphere);

    const light = new THREE.PointLight(color, 1, 4);
    group.add(light);

    group.userData = { type: type, collected: false, timer: 0 };
    return group;
}

function createFinishLine() {
    finishLine = new THREE.Group();

    for (let side of [-1, 1]) {
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 4, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.8 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(side * 2, 2, 0);
        pole.castShadow = true;
        finishLine.add(pole);
    }

    // Checkered banner
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const size = 32;
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) {
            ctx.fillStyle = (x + y) % 2 === 0 ? '#fff' : '#000';
            ctx.fillRect(x * size, y * size, size, size);
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    const bannerMat = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), bannerMat);
    banner.position.y = 3;
    finishLine.add(banner);

    const finishLight = new THREE.PointLight(0xffcc00, 2, 12);
    finishLight.position.y = 3.5;
    finishLine.add(finishLight);

    scene.add(finishLine);
}

// ==================== GAME LOGIC ====================
function startGame() {
    isFlying = true;
    isPaused = false;
    checkpointsCollected = 0;
    gameStartTime = Date.now();
    topSpeed = 0;
    boostMeter = 100;
    hasShield = false;

    createGameObjects();

    document.getElementById('gameHUD').classList.add('active');
    document.getElementById('controls').classList.add('active');
    document.getElementById('checksTotal').textContent = totalCheckpoints;

    const modeNames = { 'racing': 'RACING MODE', 'obstacles': 'OBSTACLE COURSE' };
    document.getElementById('modeBadge').textContent = modeNames[currentMode];

    gameTimer = setInterval(updateTimer, 100);
    showNotification('GO!');

    // Disable orbit controls during gameplay
    if (controls) controls.enabled = false;
}

function updateTimer() {
    if (isPaused) return;
    const elapsed = (Date.now() - gameStartTime) / 1000;
    const minutes = Math.floor(elapsed / 60);
    const seconds = (elapsed % 60).toFixed(1);
    document.getElementById('timer').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(4, '0')}`;
}

function updatePhysics(dt) {
    if (!isFlying || isPaused) return;

    const sens = settings.sensitivity;
    const invY = settings.invertY ? -1 : 1;

    pitch = -leftJoy.y * 0.8 * sens * invY;
    const throttle = 0.7 + (leftJoy.y < 0 ? -leftJoy.y * 0.3 : 0);
    yaw = rightJoy.x * 0.6 * sens;
    roll = rightJoy.x * 0.4 * sens;

    const turnSpeed = CONFIG.physics.turnSpeed * dt;
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch * turnSpeed);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * turnSpeed);
    const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -roll * turnSpeed);

    planeQuat.multiply(pitchQ).multiply(yawQ).multiply(rollQ).normalize();

    const maxSpeed = isBoosting ? CONFIG.physics.boostSpeed : CONFIG.physics.maxSpeed;
    targetSpeed = throttle * maxSpeed;
    speed += (targetSpeed - speed) * dt * 4;
    topSpeed = Math.max(topSpeed, speed);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
    planeVel.copy(forward).multiplyScalar(speed);
    planeVel.y -= CONFIG.physics.gravity * dt * 0.35;
    planeVel.multiplyScalar(CONFIG.physics.airResistance);

    planePos.add(planeVel.clone().multiplyScalar(dt));

    // Ground collision
    if (planePos.y < CONFIG.physics.groundHeight) {
        if (speed > CONFIG.physics.crashSpeed || Math.abs(planeVel.y) > 10) {
            if (!hasShield) { crash(); return; }
            hasShield = false;
        }
        planePos.y = CONFIG.physics.groundHeight;
        planeVel.y = Math.abs(planeVel.y) * 0.2;
    }

    // Warning indicator
    const warning = document.getElementById('warningIndicator');
    if (planePos.y < 1.5) {
        warning.classList.add('active');
    } else {
        warning.classList.remove('active');
    }

    plane.position.copy(planePos);
    plane.quaternion.copy(planeQuat);

    // Dynamic scaling (occlusion principle)
    updatePlaneScale();

    if (propeller) propeller.rotation.z += speed * dt * 5;

    // Boost management
    if (isBoosting && boostMeter > 0) {
        boostMeter = Math.max(0, boostMeter - dt * 40);
        if (boostMeter <= 0) isBoosting = false;
    } else if (!isBoosting) {
        boostMeter = Math.min(100, boostMeter + dt * CONFIG.game.boostRechargeRate * 20);
    }

    // Shield timer
    if (hasShield) {
        shieldTimer -= dt;
        if (shieldTimer <= 0) hasShield = false;
    }

    checkProgress();
    updateHUD();
}

function updatePlaneScale() {
    const cameraPos = camera.getWorldPosition(new THREE.Vector3());
    const distance = cameraPos.distanceTo(planePos);

    const { referenceDistance, baseScale, minScale, maxScale } = CONFIG.scaling;
    const scale = Math.max(minScale, Math.min(maxScale,
        baseScale * (referenceDistance / Math.max(distance, 0.5))
    ));

    plane.scale.setScalar(scale);
}

function checkProgress() {
    // Checkpoints
    checkpoints.forEach((cp) => {
        if (cp.userData.collected) return;

        const dist = planePos.distanceTo(cp.position);
        if (dist < 1.8) {
            const toPlane = new THREE.Vector3().subVectors(planePos, cp.position).normalize();
            const ringNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(cp.quaternion);
            const dot = Math.abs(toPlane.dot(ringNormal));

            if (dot > 0.35 && dist < 1.5) {
                collectCheckpoint(cp);
            }
        }
    });

    // Powerups
    powerups.forEach((pu) => {
        if (pu.userData.collected) return;
        const dist = planePos.distanceTo(pu.position);
        if (dist < 1.2) {
            collectPowerup(pu);
        }
    });

    // Obstacles
    obstacles.forEach(obs => {
        const dist = planePos.distanceTo(obs.position);
        if (dist < 1.3 && !hasShield) {
            crash();
        }
    });

    // Finish line
    if (checkpointsCollected === totalCheckpoints && finishLine && finishLine.visible) {
        const distToFinish = planePos.distanceTo(finishLine.position);
        if (distToFinish < 3) finishRace();
    }
}

function collectCheckpoint(cp) {
    cp.userData.collected = true;
    cp.children[0].material.color.setHex(0xffd700);
    cp.children[0].material.emissive.setHex(0xffd700);

    checkpointsCollected++;
    showNotification(`Checkpoint ${checkpointsCollected}/${totalCheckpoints}`);

    if (navigator.vibrate) navigator.vibrate(50);

    if (checkpointsCollected === totalCheckpoints && finishLine) {
        finishLine.visible = true;
        showNotification('FINISH LINE UNLOCKED!');
    }
}

function collectPowerup(pu) {
    pu.userData.collected = true;
    pu.visible = false;

    if (pu.userData.type === 'boost') {
        boostMeter = Math.min(100, boostMeter + 50);
        showNotification('BOOST +50%');
    } else if (pu.userData.type === 'shield') {
        hasShield = true;
        shieldTimer = 10;
        showNotification('SHIELD ACTIVE!');
    }

    if (navigator.vibrate) navigator.vibrate([30, 30, 30]);
}

function crash() {
    isFlying = false;
    planeVel.set(0, 0, 0);
    speed = 0;

    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    showNotification('CRASHED!');

    setTimeout(() => endGame(false), 1500);
}

function finishRace() {
    isFlying = false;
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    showNotification('FINISH!');
    setTimeout(() => endGame(true), 1000);
}

function endGame(victory) {
    if (gameTimer) clearInterval(gameTimer);

    document.getElementById('gameHUD').classList.remove('active');
    document.getElementById('controls').classList.remove('active');

    const elapsed = ((Date.now() - gameStartTime) / 1000).toFixed(1);
    document.getElementById('resultsTitle').textContent = victory ? 'VICTORY!' : 'GAME OVER';
    document.getElementById('resultsBadge').textContent = victory ? '🏆' : '💥';
    document.getElementById('finalTime').textContent = elapsed + 's';
    document.getElementById('finalChecks').textContent = `${checkpointsCollected}/${totalCheckpoints}`;
    document.getElementById('finalSpeed').textContent = Math.round(topSpeed * 25) + ' km/h';

    document.getElementById('resultsScreen').classList.add('active');
}

function resetGame() {
    isFlying = false;
    isPaused = false;
    isPlaced = false;

    if (plane) plane.visible = false;
    clearGameObjects();

    checkpointsCollected = 0;
    topSpeed = 0;
    speed = 0;
    boostMeter = 100;

    if (gameTimer) clearInterval(gameTimer);

    ['gameHUD', 'controls', 'pauseMenu', 'resultsScreen'].forEach(id => {
        document.getElementById(id).classList.remove('active');
    });

    if (controls) controls.enabled = true;
}

function updateHUD() {
    document.getElementById('speedValue').textContent = Math.round(speed * 25);
    document.getElementById('altValue').textContent = planePos.y.toFixed(1);
    document.getElementById('checksCurrent').textContent = checkpointsCollected;

    const speedFill = document.getElementById('speedFill');
    if (speedFill) speedFill.style.width = `${(speed / CONFIG.physics.boostSpeed) * 100}%`;

    const boostFill = document.getElementById('boostFill');
    if (boostFill) boostFill.style.width = `${boostMeter}%`;
}

function showNotification(message) {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.classList.add('show');
    setTimeout(() => notif.classList.remove('show'), 800);
}

function updateStatus(message, status) {
    const el = document.getElementById('arStatus');
    el.textContent = message;
    el.className = 'status-text';
    if (status) el.classList.add(status);
}

// ==================== UI SETUP ====================
function setupUI() {
    document.querySelectorAll('.mode-card').forEach(card => {
        card.addEventListener('click', () => {
            currentMode = card.dataset.mode;
            document.getElementById('mainMenu').classList.remove('active');
            document.getElementById('placementScreen').classList.add('active');
            initPlacement();
        });
    });

    document.getElementById('backBtn').addEventListener('click', () => {
        document.getElementById('placementScreen').classList.remove('active');
        document.getElementById('mainMenu').classList.add('active');
        resetGame();
    });

    document.getElementById('placeBtn').addEventListener('click', placePlane);
    document.getElementById('pauseBtn').addEventListener('click', togglePause);
    document.getElementById('resumeBtn').addEventListener('click', togglePause);

    document.getElementById('restartBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('pauseMenu').classList.remove('active');
        document.getElementById('placementScreen').classList.add('active');
        initPlacement();
    });

    document.getElementById('quitBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('pauseMenu').classList.remove('active');
        document.getElementById('mainMenu').classList.add('active');
    });

    document.getElementById('playAgainBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('resultsScreen').classList.remove('active');
        document.getElementById('placementScreen').classList.add('active');
        initPlacement();
    });

    document.getElementById('mainMenuBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('resultsScreen').classList.remove('active');
        document.getElementById('mainMenu').classList.add('active');
    });

    document.getElementById('helpBtn').addEventListener('click', () => {
        document.getElementById('helpOverlay').classList.add('active');
    });

    document.getElementById('closeHelp').addEventListener('click', () => {
        document.getElementById('helpOverlay').classList.remove('active');
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
        document.getElementById('settingsOverlay').classList.add('active');
    });

    document.getElementById('closeSettings').addEventListener('click', () => {
        document.getElementById('settingsOverlay').classList.remove('active');
    });

    // Settings handlers
    const sensSlider = document.getElementById('sensitivitySlider');
    if (sensSlider) {
        sensSlider.addEventListener('input', (e) => {
            settings.sensitivity = parseFloat(e.target.value);
            document.getElementById('sensitivityValue').textContent = settings.sensitivity.toFixed(1);
        });
    }
}

function togglePause() {
    isPaused = !isPaused;

    if (isPaused) {
        const elapsed = ((Date.now() - gameStartTime) / 1000).toFixed(1);
        document.getElementById('pauseTime').textContent = elapsed + 's';
        document.getElementById('pauseChecks').textContent = `${checkpointsCollected}/${totalCheckpoints}`;
        document.getElementById('pauseSpeed').textContent = Math.round(topSpeed * 25) + ' km/h';
        document.getElementById('pauseMenu').classList.add('active');
    } else {
        document.getElementById('pauseMenu').classList.remove('active');
    }
}

function initPlacement() {
    plane.visible = false;
    planePos.set(0, 2, -5);

    updateStatus('Position ready! Tap LAUNCH AIRCRAFT', 'ready');
    document.getElementById('placeBtn').disabled = false;

    // Enable orbit controls for positioning in 3D mode
    if (controls && !isARMode) {
        controls.enabled = true;
        camera.position.set(0, 5, 10);
        controls.target.set(0, 1, 0);
    }
}

function placePlane() {
    if (!plane) return;

    planePos.set(0, 2, -3);
    plane.position.copy(planePos);
    planeQuat.identity();
    plane.quaternion.copy(planeQuat);
    plane.visible = true;

    speed = 6;
    targetSpeed = 10;
    isPlaced = true;

    document.getElementById('placementScreen').classList.remove('active');
    startGame();
}

// ==================== CONTROLS ====================
function setupControls() {
    setupTouchControls();
    setupKeyboardControls();
    setupBoost();
}

function setupTouchControls() {
    const leftJoyEl = document.getElementById('leftJoystick');
    const rightJoyEl = document.getElementById('rightJoystick');
    const leftStick = document.getElementById('leftStick');
    const rightStick = document.getElementById('rightStick');

    document.addEventListener('touchstart', (e) => {
        Array.from(e.changedTouches).forEach(touch => {
            const leftRect = leftJoyEl.getBoundingClientRect();
            const rightRect = rightJoyEl.getBoundingClientRect();

            if (touch.clientX >= leftRect.left && touch.clientX <= leftRect.right &&
                touch.clientY >= leftRect.top && touch.clientY <= leftRect.bottom) {
                touches.set(touch.identifier, 'left');
            } else if (touch.clientX >= rightRect.left && touch.clientX <= rightRect.right &&
                touch.clientY >= rightRect.top && touch.clientY <= rightRect.bottom) {
                touches.set(touch.identifier, 'right');
            }
        });
    });

    document.addEventListener('touchmove', (e) => {
        e.preventDefault();
        Array.from(e.changedTouches).forEach(touch => {
            const side = touches.get(touch.identifier);
            if (!side) return;

            const joyEl = side === 'left' ? leftJoyEl : rightJoyEl;
            const stick = side === 'left' ? leftStick : rightStick;
            const joy = side === 'left' ? leftJoy : rightJoy;

            const rect = joyEl.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            let dx = touch.clientX - centerX;
            let dy = touch.clientY - centerY;

            const distance = Math.sqrt(dx * dx + dy * dy);
            const maxDist = rect.width / 2 - 35;

            if (distance > maxDist) {
                const angle = Math.atan2(dy, dx);
                dx = Math.cos(angle) * maxDist;
                dy = Math.sin(angle) * maxDist;
            }

            stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            joy.x = dx / maxDist;
            joy.y = dy / maxDist;
        });
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        Array.from(e.changedTouches).forEach(touch => {
            const side = touches.get(touch.identifier);
            if (!side) return;

            const stick = side === 'left' ? leftStick : rightStick;
            const joy = side === 'left' ? leftJoy : rightJoy;

            stick.style.transform = 'translate(-50%, -50%)';
            joy.x = 0;
            joy.y = 0;
            touches.delete(touch.identifier);
        });
    });
}

function setupKeyboardControls() {
    window.addEventListener('keydown', (e) => {
        keys[e.key.toLowerCase()] = true;
        if (['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
            e.preventDefault();
        }
        if (e.key === 'Escape' && isFlying) togglePause();
    });

    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    setInterval(() => {
        if (!isFlying || isPaused) return;

        if (keys['w'] || keys['arrowup']) leftJoy.y = -1;
        else if (keys['s'] || keys['arrowdown']) leftJoy.y = 1;
        else if (!touches.has('left')) leftJoy.y = 0;

        if (keys['a'] || keys['arrowleft']) rightJoy.x = -1;
        else if (keys['d'] || keys['arrowright']) rightJoy.x = 1;
        else if (!touches.has('right')) rightJoy.x = 0;

        if (keys[' '] || keys['shift']) {
            if (boostMeter > 0) {
                isBoosting = true;
                document.getElementById('boostBtn').classList.add('active');
            }
        } else if (!document.getElementById('boostBtn').classList.contains('touching')) {
            isBoosting = false;
            document.getElementById('boostBtn').classList.remove('active');
        }
    }, 16);
}

function setupBoost() {
    const boostBtn = document.getElementById('boostBtn');

    const startBoost = (e) => {
        e.preventDefault();
        if (boostMeter > 0) {
            isBoosting = true;
            boostBtn.classList.add('active', 'touching');
        }
    };

    const stopBoost = (e) => {
        e.preventDefault();
        isBoosting = false;
        boostBtn.classList.remove('active', 'touching');
    };

    boostBtn.addEventListener('touchstart', startBoost);
    boostBtn.addEventListener('touchend', stopBoost);
    boostBtn.addEventListener('mousedown', startBoost);
    boostBtn.addEventListener('mouseup', stopBoost);
}

// ==================== RENDER LOOP ====================
function render(timestamp, frame) {
    const dt = Math.min(0.05, 0.016);

    if (controls && controls.enabled) controls.update();

    updatePhysics(dt);

    // Animate checkpoints
    checkpoints.forEach(cp => {
        if (!cp.userData.collected) {
            cp.userData.timer += dt;
            const scale = 1 + Math.sin(cp.userData.timer * 4) * 0.1;
            cp.scale.set(scale, scale, scale);
            cp.rotation.y += dt * 0.7;
        }
    });

    // Animate obstacles
    obstacles.forEach(obs => {
        obs.userData.animTimer = (obs.userData.animTimer || 0) + dt;

        if (obs.userData.spinSpeed) {
            obs.rotation.z += dt * obs.userData.spinSpeed;
        }
        if (obs.userData.moveRange) {
            const offset = Math.sin(obs.userData.animTimer * obs.userData.moveSpeed) * obs.userData.moveRange;
            obs.position.x = obs.userData.baseX || obs.position.x;
            if (!obs.userData.baseX) obs.userData.baseX = obs.position.x;
            obs.position.x = obs.userData.baseX + offset;
        }

        obs.rotation.x += dt * 0.4;
        obs.rotation.y += dt * 0.3;
    });

    // Animate powerups
    powerups.forEach(pu => {
        if (!pu.userData.collected) {
            pu.userData.timer += dt;
            pu.rotation.y += dt * 2;
            pu.position.y += Math.sin(pu.userData.timer * 3) * 0.005;
        }
    });

    // Animate finish line
    if (finishLine && finishLine.visible) {
        finishLine.children[2].rotation.y += dt * 0.3;
    }

    renderer.render(scene, camera);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==================== CONSOLE LOG ====================
console.log('%c✈️ EPSTEIN JETS XR', 'font-size: 24px; font-weight: bold; color: #00d4ff;');
console.log('%cXR Racing Game v3.0', 'font-size: 14px; color: #ff3366;');
console.log('%cHybrid AR/3D Mode | Full Features', 'font-size: 12px; color: #00ff88;');