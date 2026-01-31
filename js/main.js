import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ================================================
   EPSTEIN JETS - Racing Game Engine
   Works on Phone & Laptop (AR removed for compatibility)
   ================================================ */

// ==================== GLOBAL STATE ====================
let camera, scene, renderer, controls;
let groundPlane, skyDome;

// Game modes
const GAME_MODES = {
    QUICK_RACE: 'quick',
    TIME_ATTACK: 'time',
    CHECKPOINT_RACE: 'checkpoint',
    FREE_FLIGHT: 'free'
};

// Player & Aircraft
let player = null;
let selectedPlane = 'plane1';
let currentGameMode = GAME_MODES.QUICK_RACE;

// Game Objects
let checkpoints = [];
let finishLine = null;
let explosionPool = [];
let environmentObjects = [];

// Game State
let isPlaced = false;
let isFlying = false;
let isPaused = false;
let gameStartTime = 0;
let gameTimer = null;
let bestLapTime = Infinity;
let topSpeed = 0;
let score = 0;

// Checkpoints & Progress
let checkpointsCollected = 0;
let totalCheckpoints = 10;
let lastCheckpointTime = 0;

// Animation
let lastTime = 0;

// Physics & Settings
const PHYSICS = {
    gravity: 9.8,
    airResistance: 0.985,
    groundHeight: 0.3,
    crashSpeed: 18,
    crashVelocity: 10
};

const SETTINGS = {
    quality: 'medium',
    shadows: true,
    particles: true,
    sensitivity: 1.0,
    invertY: false,
    vibration: true
};

// Plane Stats
const PLANE_STATS = {
    plane1: { name: 'FALCON', speed: 1.0, handling: 1.1, boost: 1.0 },
    plane2: { name: 'RAPTOR', speed: 1.2, handling: 0.85, boost: 1.15 },
    plane3: { name: 'PHOENIX', speed: 0.85, handling: 1.3, boost: 0.9 },
    plane4: { name: 'SPECTRE', speed: 1.3, handling: 0.75, boost: 1.25 },
    plane5: { name: 'THUNDER', speed: 1.1, handling: 1.05, boost: 1.05 }
};

// Touch & Controls
let touches = new Map();
let leftJoystick = { x: 0, y: 0, active: false, identifier: null };
let rightJoystick = { x: 0, y: 0, active: false, identifier: null };
let keys = {};

// ==================== INITIALIZATION ====================
init();

function init() {
    setupScene();
    setupRenderer();
    setupLighting();
    createEnvironment();
    setupUI();
    setupControls();

    // Start render loop
    requestAnimationFrame(render);
    window.addEventListener('resize', onResize);

    // Show loading, then menu
    setTimeout(() => {
        document.getElementById('loadingScreen').style.display = 'none';
        document.getElementById('mainMenu').style.display = 'flex';
        showInfo('Welcome to EPSTEIN JETS!');
    }, 2000);
}

function setupScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1042, 50, 200);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 15, 30);
    camera.lookAt(0, 0, 0);
}

function setupRenderer() {
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = SETTINGS.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.setClearColor(0x1a1042);
    document.body.appendChild(renderer.domElement);

    // Orbit controls for menu/spectate
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 5;
    controls.maxDistance = 100;
}

function setupLighting() {
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x2a2a4a, 2.5);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffd4a3, 3);
    sunLight.position.set(15, 25, 15);
    sunLight.castShadow = true;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 120;
    sunLight.shadow.camera.left = -50;
    sunLight.shadow.camera.right = 50;
    sunLight.shadow.camera.top = 50;
    sunLight.shadow.camera.bottom = -50;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    const accentLight1 = new THREE.PointLight(0x00d4ff, 2, 50);
    accentLight1.position.set(10, 5, 10);
    scene.add(accentLight1);

    const accentLight2 = new THREE.PointLight(0xff3366, 2, 50);
    accentLight2.position.set(-10, 5, -10);
    scene.add(accentLight2);

    const ambientLight = new THREE.AmbientLight(0x404055, 1.8);
    scene.add(ambientLight);
}

function createEnvironment() {
    // Ground with grid
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        roughness: 0.9,
        metalness: 0.1
    });
    groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // Grid overlay
    const gridHelper = new THREE.GridHelper(500, 100, 0x00d4ff, 0x1a1a4a);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Sky gradient dome
    const skyGeo = new THREE.SphereGeometry(400, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
        uniforms: {
            topColor: { value: new THREE.Color(0x0a0a2e) },
            bottomColor: { value: new THREE.Color(0x1a1042) },
            offset: { value: 20 },
            exponent: { value: 0.6 }
        },
        vertexShader: `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;
            varying vec3 vWorldPosition;
            void main() {
                float h = normalize(vWorldPosition + offset).y;
                gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
            }
        `,
        side: THREE.BackSide
    });
    skyDome = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyDome);

    // Floating structures for visual interest
    for (let i = 0; i < 20; i++) {
        const size = 2 + Math.random() * 4;
        const geo = new THREE.BoxGeometry(size, size * 2, size);
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 0.7, 0.3),
            emissive: new THREE.Color().setHSL(0.55, 0.9, 0.1),
            metalness: 0.8,
            roughness: 0.2
        });
        const block = new THREE.Mesh(geo, mat);
        block.position.set(
            (Math.random() - 0.5) * 200,
            size + Math.random() * 10,
            (Math.random() - 0.5) * 200
        );
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
        this.planeModel = null;
        this.propeller = null;
        this.trail = null;
        this.exhaustParticles = [];

        this.position = new THREE.Vector3(0, 5, 0);
        this.velocity = new THREE.Vector3();
        this.quaternion = new THREE.Quaternion();
        this.speed = 0;
        this.targetSpeed = 0;
        this.pitch = 0;
        this.roll = 0;
        this.yaw = 0;

        this.isBoosting = false;
        this.crashed = false;
        this.health = 100;
        this.distanceTraveled = 0;

        this.setupPlane();
        this.createTrail();
        this.createExhaust();
    }

    setupPlane() {
        const loader = new GLTFLoader();
        const modelPath = `assets/${this.id}.glb`;

        loader.load(
            modelPath,
            (gltf) => {
                this.planeModel = gltf.scene;
                this.planeModel.scale.set(1, 1, 1);

                while (this.plane.children.length > 0) {
                    this.plane.remove(this.plane.children[0]);
                }
                this.plane.add(this.planeModel);

                this.planeModel.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            child.material.metalness = 0.7;
                            child.material.roughness = 0.3;
                        }
                    }
                    if (child.name && child.name.toLowerCase().includes('prop')) {
                        this.propeller = child;
                    }
                });

                showInfo(`${this.stats.name} loaded!`);
            },
            undefined,
            (error) => {
                console.error('Error loading plane:', error);
                this.createFallbackPlane();
            }
        );

        this.createFallbackPlane();
        this.plane.visible = false;
        scene.add(this.plane);
    }

    createFallbackPlane() {
        const color = 0xff3366;

        const bodyGeo = new THREE.ConeGeometry(0.3, 2, 8);
        const bodyMat = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.8,
            roughness: 0.2,
            emissive: color,
            emissiveIntensity: 0.2
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.rotation.x = Math.PI / 2;
        body.castShadow = true;
        this.plane.add(body);

        const wingGeo = new THREE.BoxGeometry(3, 0.1, 0.6);
        const wingMat = new THREE.MeshStandardMaterial({
            color: 0x00d4ff,
            metalness: 0.6,
            roughness: 0.4
        });
        const wings = new THREE.Mesh(wingGeo, wingMat);
        wings.position.z = 0.2;
        wings.castShadow = true;
        this.plane.add(wings);

        const cockpitGeo = new THREE.SphereGeometry(0.25, 16, 16);
        const cockpitMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.7,
            emissive: 0x00ffff,
            emissiveIntensity: 0.5
        });
        const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
        cockpit.position.set(0, 0.15, -0.5);
        this.plane.add(cockpit);

        if (!this.propeller) {
            const propGeo = new THREE.BoxGeometry(1.4, 0.1, 0.1);
            const propMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9 });
            this.propeller = new THREE.Mesh(propGeo, propMat);
            this.propeller.position.z = -1.1;
            this.plane.add(this.propeller);
        }

        const engineGlow = new THREE.PointLight(0xff6600, 2, 3);
        engineGlow.position.set(0, 0, 1);
        this.plane.add(engineGlow);
    }

    createTrail() {
        const trailGeo = new THREE.BufferGeometry();
        const trailPositions = new Float32Array(60 * 3);
        trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));

        const trailMat = new THREE.LineBasicMaterial({
            color: 0x00d4ff,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });

        this.trail = new THREE.Line(trailGeo, trailMat);
        scene.add(this.trail);
    }

    createExhaust() {
        const particleCount = 20;
        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 8, 8),
                new THREE.MeshBasicMaterial({
                    color: 0xffaa00,
                    transparent: true,
                    opacity: 0.8,
                    blending: THREE.AdditiveBlending
                })
            );
            particle.userData = { life: 0, velocity: new THREE.Vector3() };
            this.exhaustParticles.push(particle);
            scene.add(particle);
        }
    }

    updatePhysics(dt) {
        if (this.crashed || !isFlying) return;

        const turnSpeed = 2.2 * dt * this.stats.handling * SETTINGS.sensitivity;
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch * turnSpeed);
        const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw * turnSpeed);
        const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.roll * turnSpeed);

        this.quaternion.multiply(pitchQ).multiply(yawQ).multiply(rollQ).normalize();

        const baseSpeed = 12 * this.stats.speed;
        const boostSpeed = baseSpeed * 1.8 * this.stats.boost;
        const maxSpeed = this.isBoosting ? boostSpeed : baseSpeed;

        this.targetSpeed = Math.max(0, Math.min(maxSpeed, this.targetSpeed));
        this.speed += (this.targetSpeed - this.speed) * dt * 5;

        this.distanceTraveled += this.speed * dt;
        topSpeed = Math.max(topSpeed, this.speed);

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
        this.velocity.copy(forward).multiplyScalar(this.speed);
        this.velocity.y -= PHYSICS.gravity * dt * 0.4;
        this.velocity.multiplyScalar(PHYSICS.airResistance);

        this.position.add(this.velocity.clone().multiplyScalar(dt));

        if (this.position.y < PHYSICS.groundHeight) {
            if (this.speed > PHYSICS.crashSpeed || Math.abs(this.velocity.y) > PHYSICS.crashVelocity) {
                this.crash();
                return;
            } else {
                this.position.y = PHYSICS.groundHeight;
                this.velocity.y = Math.abs(this.velocity.y) * 0.3;
            }
        }

        this.plane.position.copy(this.position);
        this.plane.quaternion.copy(this.quaternion);

        if (this.propeller) {
            this.propeller.rotation.z += this.speed * dt * 5;
        }

        this.updateTrail();
        this.updateExhaust(dt);
    }

    updateTrail() {
        if (!this.trail) return;

        const positions = this.trail.geometry.attributes.position.array;

        for (let i = positions.length - 3; i >= 3; i -= 3) {
            positions[i] = positions[i - 3];
            positions[i + 1] = positions[i - 2];
            positions[i + 2] = positions[i - 1];
        }

        const enginePos = this.position.clone();
        const backward = new THREE.Vector3(0, 0, 0.8).applyQuaternion(this.quaternion);
        enginePos.add(backward);

        positions[0] = enginePos.x;
        positions[1] = enginePos.y;
        positions[2] = enginePos.z;

        this.trail.geometry.attributes.position.needsUpdate = true;

        if (this.isBoosting) {
            this.trail.material.color.setHex(0xff6600);
            this.trail.material.opacity = 0.9;
        } else {
            this.trail.material.color.setHex(0x00d4ff);
            this.trail.material.opacity = 0.6;
        }
    }

    updateExhaust(dt) {
        this.exhaustParticles.forEach(particle => {
            particle.userData.life -= dt * 2;

            if (particle.userData.life <= 0 && this.isBoosting) {
                const enginePos = this.position.clone();
                const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
                enginePos.add(backward);

                particle.position.copy(enginePos);
                particle.userData.life = 1.0;
                particle.userData.velocity.set(
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2,
                    Math.random() * 3
                );
                particle.material.opacity = 0.8;
            }

            particle.position.add(particle.userData.velocity.clone().multiplyScalar(dt));
            particle.material.opacity = particle.userData.life * 0.8;

            const hue = 0.1 - particle.userData.life * 0.1;
            particle.material.color.setHSL(Math.max(0, hue), 1, 0.5);
        });
    }

    crash() {
        if (this.crashed) return;
        this.crashed = true;
        this.velocity.set(0, 0, 0);
        this.speed = 0;

        this.createExplosion();
        this.plane.visible = false;

        if (SETTINGS.vibration && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
        }

        setTimeout(() => {
            endGame('CRASHED', false);
        }, 1000);
    }

    createExplosion() {
        const particleCount = 40;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = this.position.x;
            positions[i * 3 + 1] = this.position.y;
            positions[i * 3 + 2] = this.position.z;

            colors[i * 3] = 1;
            colors[i * 3 + 1] = Math.random() * 0.5;
            colors[i * 3 + 2] = 0;

            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * 12,
                Math.random() * 10,
                (Math.random() - 0.5) * 12
            ));
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.25,
            vertexColors: true,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending
        });

        const explosion = new THREE.Points(geometry, material);
        explosion.userData = { velocities, life: 1.5, maxLife: 1.5 };
        scene.add(explosion);
        explosionPool.push(explosion);
    }

    setControls(pitch, roll, yaw, throttle, boost) {
        const invertMultiplier = SETTINGS.invertY ? -1 : 1;
        this.pitch = pitch * invertMultiplier;
        this.roll = roll;
        this.yaw = yaw;
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

    switch (currentGameMode) {
        case GAME_MODES.QUICK_RACE:
        case GAME_MODES.CHECKPOINT_RACE:
            createCheckpoints(totalCheckpoints);
            createFinishLine();
            break;
        case GAME_MODES.TIME_ATTACK:
            createRaceTrack();
            break;
        case GAME_MODES.FREE_FLIGHT:
            createExplorationObjects();
            break;
    }
}

function clearGameObjects() {
    checkpoints.forEach(cp => scene.remove(cp));
    checkpoints = [];

    if (finishLine) {
        scene.remove(finishLine);
        finishLine = null;
    }
}

function createCheckpoints(count) {
    const radius = 15;
    totalCheckpoints = count;

    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const height = 5 + Math.sin(i * 0.6) * 3;

        const checkpoint = createCheckpointRing(i + 1);
        checkpoint.position.set(
            Math.cos(angle) * radius,
            height,
            Math.sin(angle) * radius
        );

        const nextAngle = ((i + 1) / count) * Math.PI * 2;
        checkpoint.lookAt(
            Math.cos(nextAngle) * radius,
            height,
            Math.sin(nextAngle) * radius
        );

        checkpoint.userData = { index: i, collected: false, timer: 0 };

        scene.add(checkpoint);
        checkpoints.push(checkpoint);
    }
}

function createCheckpointRing(number) {
    const group = new THREE.Group();

    const ringGeo = new THREE.TorusGeometry(1.5, 0.18, 16, 32);
    const ringMat = new THREE.MeshStandardMaterial({
        color: 0x00ff88,
        emissive: 0x00ff88,
        emissiveIntensity: 0.8,
        metalness: 0.5,
        roughness: 0.3,
        transparent: true,
        opacity: 0.9
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.castShadow = true;
    group.add(ring);

    const glowGeo = new THREE.TorusGeometry(1.3, 0.12, 16, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 140px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(number.toString(), 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    const numberMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide
    });
    const numberPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), numberMat);
    numberPlane.position.z = 0.2;
    group.add(numberPlane);

    const light = new THREE.PointLight(0x00ff88, 2, 8);
    group.add(light);

    return group;
}

function createFinishLine() {
    finishLine = new THREE.Group();

    for (let i = -1; i <= 1; i += 2) {
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 4, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.8, roughness: 0.2 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(i * 2, 2, 0);
        pole.castShadow = true;
        finishLine.add(pole);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const checkSize = 64;
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) {
            ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#000000';
            ctx.fillRect(x * checkSize, y * checkSize, checkSize, checkSize);
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    const bannerMat = new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        emissive: 0xffffff,
        emissiveIntensity: 0.2
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), bannerMat);
    banner.position.y = 3;
    banner.castShadow = true;
    finishLine.add(banner);

    const finishLight = new THREE.PointLight(0xffcc00, 3, 12);
    finishLight.position.y = 3;
    finishLine.add(finishLight);

    finishLine.position.set(0, 0, 0);
    finishLine.visible = false;
    scene.add(finishLine);
}

function createRaceTrack() {
    const gateCount = 8;
    const radius = 20;

    for (let i = 0; i < gateCount; i++) {
        const angle = (i / gateCount) * Math.PI * 2;
        const gate = createCheckpointRing(i + 1);
        gate.position.set(Math.cos(angle) * radius, 5, Math.sin(angle) * radius);
        gate.lookAt(0, 5, 0);
        gate.userData = { index: i, collected: false, timer: 0 };
        scene.add(gate);
        checkpoints.push(gate);
    }

    totalCheckpoints = gateCount;
}

function createExplorationObjects() {
    for (let i = 0; i < 15; i++) {
        const ring = createCheckpointRing(i + 1);
        ring.position.set(
            (Math.random() - 0.5) * 60,
            Math.random() * 25 + 3,
            (Math.random() - 0.5) * 60
        );
        ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        ring.userData = { collected: false, timer: 0 };
        scene.add(ring);
        checkpoints.push(ring);
    }
    totalCheckpoints = 15;
}

// ==================== GAME LOGIC ====================
function startGame() {
    isFlying = true;
    isPaused = false;
    gameStartTime = Date.now();
    checkpointsCollected = 0;
    topSpeed = 0;
    score = 0;

    createGameObjects();

    if (finishLine) finishLine.visible = false;

    document.getElementById('gameHUD').style.display = 'block';
    document.getElementById('gameControls').style.display = 'block';

    const modeIcons = {
        [GAME_MODES.QUICK_RACE]: '⚡',
        [GAME_MODES.TIME_ATTACK]: '⏱️',
        [GAME_MODES.CHECKPOINT_RACE]: '🎯',
        [GAME_MODES.FREE_FLIGHT]: '🌅'
    };
    const modeNames = {
        [GAME_MODES.QUICK_RACE]: 'QUICK RACE',
        [GAME_MODES.TIME_ATTACK]: 'TIME ATTACK',
        [GAME_MODES.CHECKPOINT_RACE]: 'CHECKPOINT RACE',
        [GAME_MODES.FREE_FLIGHT]: 'FREE FLIGHT'
    };
    document.getElementById('modeIcon').textContent = modeIcons[currentGameMode];
    document.getElementById('modeText').textContent = modeNames[currentGameMode];

    if (currentGameMode !== GAME_MODES.FREE_FLIGHT) {
        document.getElementById('checkpointDisplay').style.display = 'block';
        document.getElementById('checkpointsTotal').textContent = totalCheckpoints;
    } else {
        document.getElementById('checkpointDisplay').style.display = 'none';
    }

    gameTimer = setInterval(updateGameTimer, 100);

    showInfo('Race started! Fly through checkpoints!');
}

function updateGameTimer() {
    if (isPaused) return;

    const elapsed = (Date.now() - gameStartTime) / 1000;
    const minutes = Math.floor(elapsed / 60);
    const seconds = (elapsed % 60).toFixed(2);
    document.getElementById('gameTimer').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(5, '0')}`;
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
    updateExplosions(dt);
    updateFollowCamera();
}

function updateFollowCamera() {
    if (!player || !isFlying) return;

    const offset = new THREE.Vector3(0, 4, 12);
    offset.applyQuaternion(player.quaternion);

    const targetPos = player.position.clone().add(offset);
    camera.position.lerp(targetPos, 0.08);

    const lookTarget = player.position.clone();
    lookTarget.y += 1;
    camera.lookAt(lookTarget);
}

function checkCheckpoints() {
    if (!player || player.crashed) return;

    checkpoints.forEach((checkpoint, index) => {
        if (checkpoint.userData.collected) {
            checkpoint.children[0].material.opacity = Math.max(0, checkpoint.children[0].material.opacity - 0.01);
            return;
        }

        const dist = player.position.distanceTo(checkpoint.position);

        if (dist < 2.5) {
            collectCheckpoint(checkpoint, index);
        }
    });

    if (currentGameMode !== GAME_MODES.FREE_FLIGHT && checkpointsCollected === totalCheckpoints && finishLine && finishLine.visible) {
        const distToFinish = player.position.distanceTo(finishLine.position);
        if (distToFinish < 4) {
            endGame('VICTORY', true);
        }
    }
}

function collectCheckpoint(checkpoint, index) {
    checkpoint.userData.collected = true;
    checkpoint.children[0].material.color.setHex(0xffd700);
    checkpoint.children[0].material.emissive.setHex(0xffd700);

    checkpointsCollected++;

    const now = Date.now();
    const timeSinceLastScore = lastCheckpointTime ? (now - lastCheckpointTime) / 1000 : 0;
    const timeBonus = timeSinceLastScore > 0 ? Math.max(0, 100 - timeSinceLastScore * 10) : 100;
    score += Math.round(100 + timeBonus);
    lastCheckpointTime = now;

    if (SETTINGS.vibration && navigator.vibrate) {
        navigator.vibrate(50);
    }

    showCheckpointAlert();

    if (checkpointsCollected === totalCheckpoints && finishLine) {
        finishLine.visible = true;
        showInfo('All checkpoints collected! Head to the finish line!');

        finishLine.scale.set(0, 0, 0);
        const animateFinish = () => {
            finishLine.scale.x = Math.min(finishLine.scale.x + 0.05, 1);
            finishLine.scale.y = Math.min(finishLine.scale.y + 0.05, 1);
            finishLine.scale.z = Math.min(finishLine.scale.z + 0.05, 1);
            if (finishLine.scale.x < 1) requestAnimationFrame(animateFinish);
        };
        animateFinish();
    } else {
        showInfo(`Checkpoint ${checkpointsCollected}/${totalCheckpoints} collected!`);
    }
}

function showCheckpointAlert() {
    const alert = document.getElementById('checkpointAlert');
    alert.classList.add('show');
    setTimeout(() => alert.classList.remove('show'), 600);
}

function updateExplosions(dt) {
    explosionPool = explosionPool.filter(explosion => {
        explosion.userData.life -= dt;

        if (explosion.userData.life <= 0) {
            scene.remove(explosion);
            return false;
        }

        const positions = explosion.geometry.attributes.position.array;
        const velocities = explosion.userData.velocities;

        for (let i = 0; i < velocities.length; i++) {
            velocities[i].y -= PHYSICS.gravity * dt;
            positions[i * 3] += velocities[i].x * dt;
            positions[i * 3 + 1] += velocities[i].y * dt;
            positions[i * 3 + 2] += velocities[i].z * dt;
        }

        explosion.geometry.attributes.position.needsUpdate = true;
        explosion.material.opacity = explosion.userData.life / explosion.userData.maxLife;

        return true;
    });
}

function updateHUD() {
    if (!player) return;

    const speedKmh = Math.round(player.speed * 25);
    document.getElementById('speedValue').textContent = speedKmh;
    document.getElementById('speedBar').style.width = `${Math.min(100, (speedKmh / 300) * 100)}%`;

    document.getElementById('altValue').textContent = player.position.y.toFixed(1);

    if (currentGameMode !== GAME_MODES.FREE_FLIGHT) {
        document.getElementById('checkpointsCurrent').textContent = checkpointsCollected;
        const progress = (checkpointsCollected / totalCheckpoints) * 100;
        document.getElementById('checkpointProgress').style.width = `${progress}%`;
    }

    const boostIndicator = document.getElementById('boostIndicator');
    if (player.isBoosting) {
        boostIndicator.classList.add('active');
    } else {
        boostIndicator.classList.remove('active');
    }
}

function endGame(result, isWin) {
    isFlying = false;
    if (gameTimer) clearInterval(gameTimer);

    const finalTime = ((Date.now() - gameStartTime) / 1000).toFixed(2);

    document.getElementById('gameHUD').style.display = 'none';
    document.getElementById('gameControls').style.display = 'none';

    const resultsScreen = document.getElementById('resultsScreen');
    document.getElementById('resultsTitle').textContent = result;
    document.getElementById('resultsRank').textContent = isWin ? '1ST' : '---';
    document.getElementById('finalTime').textContent = finalTime + 's';
    document.getElementById('finalCheckpoints').textContent = `${checkpointsCollected}/${totalCheckpoints}`;
    document.getElementById('finalSpeed').textContent = Math.round(topSpeed * 25) + ' km/h';
    document.getElementById('finalScore').textContent = score;

    resultsScreen.style.display = 'flex';

    if (SETTINGS.vibration && navigator.vibrate) {
        navigator.vibrate(isWin ? [100, 50, 100, 50, 200] : [500]);
    }
}

function resetGame() {
    isFlying = false;
    isPaused = false;
    isPlaced = false;

    if (player) {
        player.destroy();
        player = null;
    }

    clearGameObjects();

    explosionPool.forEach(exp => scene.remove(exp));
    explosionPool = [];

    checkpointsCollected = 0;
    gameStartTime = 0;
    topSpeed = 0;
    score = 0;

    if (gameTimer) clearInterval(gameTimer);

    document.getElementById('gameHUD').style.display = 'none';
    document.getElementById('gameControls').style.display = 'none';
    document.getElementById('resultsScreen').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';

    camera.position.set(0, 15, 30);
    camera.lookAt(0, 0, 0);
}

// ==================== UI SETUP ====================
function setupUI() {
    document.getElementById('quickPlayBtn').addEventListener('click', () => {
        currentGameMode = GAME_MODES.QUICK_RACE;
        totalCheckpoints = 10;
        showPlaneSelection();
    });

    document.getElementById('timeAttackBtn').addEventListener('click', () => {
        currentGameMode = GAME_MODES.TIME_ATTACK;
        totalCheckpoints = 8;
        showPlaneSelection();
    });

    document.getElementById('checkpointRaceBtn').addEventListener('click', () => {
        currentGameMode = GAME_MODES.CHECKPOINT_RACE;
        totalCheckpoints = 15;
        showPlaneSelection();
    });

    document.getElementById('freeFlightBtn').addEventListener('click', () => {
        currentGameMode = GAME_MODES.FREE_FLIGHT;
        showPlaneSelection();
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
        document.getElementById('settingsPanel').style.display = 'flex';
    });

    document.getElementById('closeSettings').addEventListener('click', () => {
        document.getElementById('settingsPanel').style.display = 'none';
    });

    document.getElementById('leaderboardBtn').addEventListener('click', () => {
        showInfo('Leaderboard coming soon!');
    });

    document.getElementById('helpBtn').addEventListener('click', () => {
        showInfo('Use joysticks to control. Left: throttle/pitch, Right: yaw/roll. Collect checkpoints!');
    });

    document.querySelectorAll('.select-plane-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const card = e.target.closest('.plane-card');
            selectedPlane = card.dataset.plane;
            placePlane();
        });
    });

    document.getElementById('backFromPlanes').addEventListener('click', () => {
        document.getElementById('planeSelection').style.display = 'none';
        document.getElementById('mainMenu').style.display = 'flex';
    });

    // Hide AR placement screen buttons as we no longer need AR
    const arPlacement = document.getElementById('arPlacement');
    if (arPlacement) arPlacement.style.display = 'none';

    document.getElementById('pauseBtn').addEventListener('click', togglePause);
    document.getElementById('resumeBtn').addEventListener('click', togglePause);
    document.getElementById('restartBtn').addEventListener('click', () => {
        resetGame();
        showPlaneSelection();
    });
    document.getElementById('quitBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('mainMenu').style.display = 'flex';
    });

    document.getElementById('playAgainBtn').addEventListener('click', () => {
        resetGame();
        showPlaneSelection();
    });

    document.getElementById('menuBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('mainMenu').style.display = 'flex';
    });

    document.getElementById('qualitySelect').addEventListener('change', (e) => {
        SETTINGS.quality = e.target.value;
        applyQualitySettings();
    });

    document.getElementById('shadowsToggle').addEventListener('change', (e) => {
        SETTINGS.shadows = e.target.checked;
        renderer.shadowMap.enabled = SETTINGS.shadows;
    });

    document.getElementById('particlesToggle').addEventListener('change', (e) => {
        SETTINGS.particles = e.target.checked;
    });

    document.getElementById('sensitivitySlider').addEventListener('input', (e) => {
        SETTINGS.sensitivity = parseFloat(e.target.value);
    });

    document.getElementById('invertToggle').addEventListener('change', (e) => {
        SETTINGS.invertY = e.target.checked;
    });

    document.getElementById('vibrationToggle').addEventListener('change', (e) => {
        SETTINGS.vibration = e.target.checked;
    });
}

function showPlaneSelection() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('planeSelection').style.display = 'flex';
}

function placePlane() {
    player = new Player(selectedPlane);

    player.position.set(0, 5, 0);
    player.quaternion.identity();

    player.plane.position.copy(player.position);
    player.plane.quaternion.copy(player.quaternion);
    player.plane.visible = true;
    player.speed = 6;
    player.targetSpeed = 10;

    isPlaced = true;

    document.getElementById('planeSelection').style.display = 'none';

    startGame();
}

function togglePause() {
    isPaused = !isPaused;

    if (isPaused) {
        document.getElementById('pauseMenu').style.display = 'flex';
        const elapsed = ((Date.now() - gameStartTime) / 1000).toFixed(2);
        document.getElementById('pauseTime').textContent = elapsed + 's';
        document.getElementById('pauseCheckpoints').textContent = `${checkpointsCollected}/${totalCheckpoints}`;
    } else {
        document.getElementById('pauseMenu').style.display = 'none';
    }
}

function applyQualitySettings() {
    const quality = SETTINGS.quality;

    if (quality === 'low') {
        renderer.setPixelRatio(1);
        renderer.shadowMap.enabled = false;
    } else if (quality === 'medium') {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.shadowMap.enabled = true;
    } else {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
    }
}

function showInfo(message) {
    const info = document.getElementById('infoDisplay');
    document.getElementById('infoText').textContent = message;
    info.classList.add('show');
    setTimeout(() => info.classList.remove('show'), 3000);
}

// ==================== CONTROLS ====================
function setupControls() {
    setupTouchControls();
    setupKeyboardControls();
    setupBoostButton();
}

function setupTouchControls() {
    const leftJoy = document.getElementById('leftJoystick');
    const rightJoy = document.getElementById('rightJoystick');
    const leftStick = document.getElementById('leftStick');
    const rightStick = document.getElementById('rightStick');

    document.addEventListener('touchstart', (e) => {
        Array.from(e.changedTouches).forEach(touch => {
            const x = touch.clientX;
            const y = touch.clientY;

            const leftRect = leftJoy.getBoundingClientRect();
            const rightRect = rightJoy.getBoundingClientRect();

            if (x >= leftRect.left && x <= leftRect.right && y >= leftRect.top && y <= leftRect.bottom) {
                leftJoystick.identifier = touch.identifier;
                leftJoystick.active = true;
                touches.set(touch.identifier, 'left');
            } else if (x >= rightRect.left && x <= rightRect.right && y >= rightRect.top && y <= rightRect.bottom) {
                rightJoystick.identifier = touch.identifier;
                rightJoystick.active = true;
                touches.set(touch.identifier, 'right');
            }
        });
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        e.preventDefault();
        Array.from(e.changedTouches).forEach(touch => {
            const side = touches.get(touch.identifier);
            if (!side) return;

            const joystick = side === 'left' ? leftJoy : rightJoy;
            const stick = side === 'left' ? leftStick : rightStick;
            const data = side === 'left' ? leftJoystick : rightJoystick;

            const rect = joystick.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            let dx = touch.clientX - centerX;
            let dy = touch.clientY - centerY;

            const distance = Math.sqrt(dx * dx + dy * dy);
            const maxDistance = rect.width / 2 - 35;

            if (distance > maxDistance) {
                const angle = Math.atan2(dy, dx);
                dx = Math.cos(angle) * maxDistance;
                dy = Math.sin(angle) * maxDistance;
            }

            stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

            data.x = dx / maxDistance;
            data.y = dy / maxDistance;
        });
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        Array.from(e.changedTouches).forEach(touch => {
            const side = touches.get(touch.identifier);
            if (!side) return;

            const stick = side === 'left' ? leftStick : rightStick;
            const data = side === 'left' ? leftJoystick : rightJoystick;

            stick.style.transform = 'translate(-50%, -50%)';
            data.x = 0;
            data.y = 0;
            data.active = false;
            data.identifier = null;

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

        if (e.key === 'Escape' && isFlying) {
            togglePause();
        }
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    setInterval(() => {
        if (!isFlying || isPaused) return;

        if (keys['w'] || keys['arrowup']) {
            leftJoystick.y = -1;
        } else if (keys['s'] || keys['arrowdown']) {
            leftJoystick.y = 1;
        } else {
            if (!leftJoystick.active) leftJoystick.y = 0;
        }

        if (keys['a'] || keys['arrowleft']) {
            rightJoystick.x = -1;
        } else if (keys['d'] || keys['arrowright']) {
            rightJoystick.x = 1;
        } else {
            if (!rightJoystick.active) rightJoystick.x = 0;
        }

        if (keys['q']) {
            rightJoystick.y = -1;
        } else if (keys['e']) {
            rightJoystick.y = 1;
        } else {
            if (!rightJoystick.active) rightJoystick.y = 0;
        }

        if (player && (keys[' '] || keys['shift'])) {
            player.isBoosting = true;
            document.getElementById('boostBtn').classList.add('active');
        } else if (player) {
            if (!document.getElementById('boostBtn').classList.contains('touching')) {
                player.isBoosting = false;
                document.getElementById('boostBtn').classList.remove('active');
            }
        }
    }, 16);
}

function setupBoostButton() {
    const boostBtn = document.getElementById('boostBtn');

    boostBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (player) {
            player.isBoosting = true;
            boostBtn.classList.add('active', 'touching');
        }
    });

    boostBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (player) {
            player.isBoosting = false;
            boostBtn.classList.remove('active', 'touching');
        }
    });

    boostBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (player) {
            player.isBoosting = true;
            boostBtn.classList.add('active', 'touching');
        }
    });

    boostBtn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        if (player) {
            player.isBoosting = false;
            boostBtn.classList.remove('active', 'touching');
        }
    });
}

// ==================== ANIMATION LOOP ====================
function render(timestamp) {
    requestAnimationFrame(render);

    const dt = Math.min(0.05, (timestamp - lastTime) / 1000) || 0.016;
    lastTime = timestamp;

    updateGameLogic(dt);

    checkpoints.forEach(cp => {
        if (!cp.userData.collected) {
            cp.userData.timer += dt;
            const scale = 1 + Math.sin(cp.userData.timer * 4) * 0.12;
            cp.scale.set(scale, scale, scale);
            cp.rotation.y += dt * 0.8;
        }
    });

    environmentObjects.forEach(obj => {
        obj.rotation.y += dt * 0.1;
    });

    if (finishLine && finishLine.visible) {
        finishLine.rotation.y += dt * 0.5;
        const light = finishLine.children[finishLine.children.length - 1];
        if (light.isPointLight) {
            light.intensity = 3 + Math.sin(Date.now() * 0.005) * 1;
        }
    }

    if (!isFlying) {
        controls.update();
    }

    renderer.render(scene, camera);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

if (isMobile()) {
    SETTINGS.quality = 'medium';
    document.getElementById('qualitySelect').value = 'medium';
    applyQualitySettings();
}

console.log('%c🛩️ EPSTEIN JETS - Racing Game', 'font-size: 20px; font-weight: bold; color: #00d4ff;');
console.log('%cNow works on Phone & Laptop!', 'font-size: 12px; color: #ff3366;');
console.log('%cControls: WASD/Arrows + Q/E + Space(Boost)', 'font-size: 11px; color: #00ff88;');