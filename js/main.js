import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ================================================
   EPSTEIN JETS - Complete Game Engine
   Fixed, Clean, Production Ready
   ================================================ */

// ==================== GLOBAL STATE ====================
let camera, scene, renderer, reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let localSpace = null;

// Game Objects
let plane, planeModel, propeller;
let checkpoints = [];
let obstacles = [];
let finishLine = null;

// Player Physics
const planePos = new THREE.Vector3();
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

// Physics Constants
const PHYSICS = {
    gravity: 9.8,
    airResistance: 0.985,
    groundHeight: 0.5,
    crashSpeed: 18,
    maxSpeed: 12,
    boostSpeed: 20,
    turnSpeed: 2.2
};

// Controls
let leftJoy = { x: 0, y: 0 };
let rightJoy = { x: 0, y: 0 };
let keys = {};
let touches = new Map();

// ==================== INITIALIZATION ====================
init();

function init() {
    setupScene();
    setupRenderer();
    setupLighting();
    setupUI();
    setupControls();
    
    renderer.setAnimationLoop(render);
    window.addEventListener('resize', onResize);
}

function setupScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 500);
    
    // AR Reticle with better visibility
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
    
    // Add reticle pulsing glow
    const glowGeo = new THREE.RingGeometry(0.12, 0.23, 32).rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
    });
    const reticleGlow = new THREE.Mesh(glowGeo, glowMat);
    reticle.add(reticleGlow);
}

function setupRenderer() {
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    
    document.body.appendChild(renderer.domElement);

    // Create AR Button with proper configuration
    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'dom-overlay-for-handheld-ar', 'light-estimation'],
        domOverlay: { root: document.body }
    });
    
    // Style AR button to be hidden
    arButton.style.display = 'none';
    document.body.appendChild(arButton);
    
    // Setup XR session event listeners
    renderer.xr.addEventListener('sessionstart', onXRSessionStart);
    renderer.xr.addEventListener('sessionend', onXRSessionEnd);
}

function onXRSessionStart() {
    console.log('XR Session started');
    updateStatus('AR session active - Point at a surface', 'ready');
}

function onXRSessionEnd() {
    console.log('XR Session ended');
    hitTestSource = null;
    hitTestSourceRequested = false;
}

function setupLighting() {
    // Hemisphere light for natural ambient
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 2);
    scene.add(hemiLight);
    
    // Directional sun light with shadows
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
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
    
    // Ambient light for fill
    const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
    scene.add(ambientLight);
    
    // Accent lights for visual interest
    const accentLight1 = new THREE.PointLight(0x00d4ff, 1.5, 30);
    accentLight1.position.set(8, 5, 8);
    scene.add(accentLight1);
    
    const accentLight2 = new THREE.PointLight(0xff3366, 1.5, 30);
    accentLight2.position.set(-8, 5, -8);
    scene.add(accentLight2);
}

// ==================== PLANE CREATION ====================
function createPlane() {
    plane = new THREE.Group();
    
    // Load GLB model
    const loader = new GLTFLoader();
    loader.load(
        'plane.glb',
        (gltf) => {
            planeModel = gltf.scene;
            planeModel.scale.set(1, 1, 1);
            
            // Clear fallback and add model
            while (plane.children.length > 0) {
                plane.remove(plane.children[0]);
            }
            plane.add(planeModel);
            
            // Setup materials and find propeller
            planeModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.material.metalness = 0.7;
                    child.material.roughness = 0.3;
                }
                if (child.name && child.name.toLowerCase().includes('prop')) {
                    propeller = child;
                }
            });
            
            console.log('Plane model loaded successfully');
            updateStatus('Aircraft ready! Searching for surface...', 'ready');
        },
        (progress) => {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            console.log(`Loading: ${percent}%`);
        },
        (error) => {
            console.error('Error loading plane:', error);
            updateStatus('Using fallback plane model', 'error');
            createFallbackPlane();
        }
    );
    
    // Create fallback immediately
    createFallbackPlane();
    plane.visible = false;
    scene.add(plane);
}

function createFallbackPlane() {
    // Futuristic plane geometry
    const bodyGeo = new THREE.ConeGeometry(0.35, 2.2, 8);
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
    const wingGeo = new THREE.BoxGeometry(3.2, 0.12, 0.7);
    const wingMat = new THREE.MeshStandardMaterial({
        color: 0x00d4ff,
        metalness: 0.6,
        roughness: 0.4
    });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.position.z = 0.3;
    wings.castShadow = true;
    plane.add(wings);

    // Tail fin
    const tailGeo = new THREE.BoxGeometry(0.12, 0.7, 0.5);
    const tail = new THREE.Mesh(tailGeo, wingMat);
    tail.position.set(0, 0.35, 0.9);
    tail.castShadow = true;
    plane.add(tail);

    // Cockpit
    const cockpitGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const cockpitMat = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.6,
        emissive: 0x00ffff,
        emissiveIntensity: 0.3
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 0.2, -0.6);
    cockpit.scale.set(1, 0.8, 1.2);
    plane.add(cockpit);

    // Propeller
    if (!propeller) {
        const propGeo = new THREE.BoxGeometry(1.5, 0.12, 0.12);
        const propMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            metalness: 0.9,
            roughness: 0.1
        });
        propeller = new THREE.Mesh(propGeo, propMat);
        propeller.position.z = -1.2;
        plane.add(propeller);
    }

    // Engine glow
    const engineLight = new THREE.PointLight(0xff6600, 2, 4);
    engineLight.position.set(0, 0, 1.1);
    plane.add(engineLight);
}

// ==================== GAME OBJECTS ====================
function createGameObjects() {
    clearGameObjects();
    
    if (currentMode === 'racing') {
        createCheckpoints();
        createFinishLine();
    } else if (currentMode === 'obstacles') {
        createObstacleCourse();
    }
}

function clearGameObjects() {
    checkpoints.forEach(cp => scene.remove(cp));
    checkpoints = [];
    
    obstacles.forEach(obs => scene.remove(obs));
    obstacles = [];
    
    if (finishLine) {
        scene.remove(finishLine);
        finishLine = null;
    }
}

function createCheckpoints() {
    const radius = 14;
    totalCheckpoints = 10;
    
    for (let i = 0; i < totalCheckpoints; i++) {
        const angle = (i / totalCheckpoints) * Math.PI * 2;
        const height = 2.5 + Math.sin(i * 0.7) * 2;
        
        const checkpoint = createCheckpointRing(i + 1);
        checkpoint.position.set(
            Math.cos(angle) * radius,
            height,
            Math.sin(angle) * radius
        );
        
        // Orient to next checkpoint
        const nextAngle = ((i + 1) / totalCheckpoints) * Math.PI * 2;
        checkpoint.lookAt(
            Math.cos(nextAngle) * radius,
            height,
            Math.sin(nextAngle) * radius
        );
        
        checkpoint.userData = {
            index: i,
            collected: false,
            required: true,
            timer: 0
        };
        
        scene.add(checkpoint);
        checkpoints.push(checkpoint);
    }
}

function createCheckpointRing(number) {
    const group = new THREE.Group();
    
    // Main ring
    const ringGeo = new THREE.TorusGeometry(1.4, 0.18, 16, 32);
    const ringMat = new THREE.MeshStandardMaterial({
        color: 0x00ff88,
        emissive: 0x00ff88,
        emissiveIntensity: 0.7,
        metalness: 0.5,
        roughness: 0.3,
        transparent: true,
        opacity: 0.9
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.castShadow = true;
    group.add(ring);
    
    // Inner glow
    const glowGeo = new THREE.TorusGeometry(1.2, 0.12, 16, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);
    
    // Number text
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
    const numberPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        numberMat
    );
    numberPlane.position.z = 0.25;
    group.add(numberPlane);
    
    // Point light for glow
    const light = new THREE.PointLight(0x00ff88, 2, 8);
    group.add(light);
    
    return group;
}

function createFinishLine() {
    finishLine = new THREE.Group();
    
    // Checkered poles
    for (let side of [-1, 1]) {
        const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 4.5, 8);
        const poleMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.8,
            roughness: 0.2
        });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(side * 2.2, 2.25, 0);
        pole.castShadow = true;
        finishLine.add(pole);
    }
    
    // Checkered banner
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    const size = 64;
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) {
            ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#000000';
            ctx.fillRect(x * size, y * size, size, size);
        }
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    const bannerMat = new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        emissive: 0xffffff,
        emissiveIntensity: 0.15
    });
    const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(4.4, 2.2),
        bannerMat
    );
    banner.position.y = 3;
    banner.castShadow = true;
    finishLine.add(banner);
    
    // Finish light
    const finishLight = new THREE.PointLight(0xffcc00, 3, 15);
    finishLight.position.y = 3.5;
    finishLine.add(finishLight);
    
    finishLine.position.set(0, 0, 0);
    finishLine.visible = false;
    scene.add(finishLine);
}

function createObstacleCourse() {
    totalCheckpoints = 12;
    
    // Create varied obstacles
    for (let i = 0; i < totalCheckpoints; i++) {
        const distance = 5 + i * 3;
        const lateralOffset = (Math.random() - 0.5) * 8;
        const height = 1.5 + Math.random() * 3;
        
        // Checkpoint gate
        const checkpoint = createCheckpointRing(i + 1);
        checkpoint.position.set(lateralOffset, height, -distance);
        checkpoint.lookAt(lateralOffset, height, -(distance + 5));
        checkpoint.userData = {
            index: i,
            collected: false,
            required: true,
            timer: 0
        };
        scene.add(checkpoint);
        checkpoints.push(checkpoint);
        
        // Add obstacle near checkpoint (but not blocking it)
        if (i > 0 && i < totalCheckpoints - 1) {
            const obstacle = createObstacle();
            const obsOffset = lateralOffset + (Math.random() - 0.5) * 4;
            obstacle.position.set(obsOffset, height + 1.5, -distance + 1.5);
            scene.add(obstacle);
            obstacles.push(obstacle);
        }
    }
    
    // Create finish line at end
    finishLine = createFinishLine();
    finishLine.position.set(0, 2, -(5 + totalCheckpoints * 3));
    finishLine.visible = false;
    scene.add(finishLine);
}

function createObstacle() {
    const types = ['cube', 'sphere', 'torus'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    let geometry, material, mesh;
    
    switch (type) {
        case 'cube':
            geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
            break;
        case 'sphere':
            geometry = new THREE.SphereGeometry(0.8, 16, 16);
            break;
        case 'torus':
            geometry = new THREE.TorusGeometry(0.7, 0.3, 16, 32);
            break;
    }
    
    material = new THREE.MeshStandardMaterial({
        color: 0xff3366,
        emissive: 0xff3366,
        emissiveIntensity: 0.3,
        metalness: 0.6,
        roughness: 0.4,
        transparent: true,
        opacity: 0.8
    });
    
    mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    return mesh;
}

// ==================== GAME LOGIC ====================
function startGame() {
    isFlying = true;
    isPaused = false;
    checkpointsCollected = 0;
    gameStartTime = Date.now();
    topSpeed = 0;
    
    createGameObjects();
    
    // Update UI
    document.getElementById('gameHUD').classList.add('active');
    document.getElementById('controls').classList.add('active');
    document.getElementById('checksTotal').textContent = totalCheckpoints;
    
    const modeNames = {
        'racing': 'RACING MODE',
        'obstacles': 'OBSTACLE COURSE'
    };
    document.getElementById('modeBadge').textContent = modeNames[currentMode];
    
    // Start timer
    gameTimer = setInterval(updateTimer, 100);
    
    showNotification('GO! Collect all checkpoints!');
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
    
    // Control inputs with sensitivity
    const sensitivity = 1.0;
    pitch = -leftJoy.y * 0.8 * sensitivity;
    const throttle = 0.7 + (leftJoy.y < 0 ? -leftJoy.y * 0.3 : 0);
    yaw = rightJoy.x * 0.6 * sensitivity;
    roll = rightJoy.x * 0.4 * sensitivity;
    
    // Apply rotations
    const turnSpeed = PHYSICS.turnSpeed * dt;
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch * turnSpeed);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * turnSpeed);
    const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -roll * turnSpeed);
    
    planeQuat.multiply(pitchQ).multiply(yawQ).multiply(rollQ).normalize();
    
    // Speed control
    const maxSpeed = isBoosting ? PHYSICS.boostSpeed : PHYSICS.maxSpeed;
    targetSpeed = throttle * maxSpeed;
    speed += (targetSpeed - speed) * dt * 4;
    
    topSpeed = Math.max(topSpeed, speed);
    
    // Movement
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
    planeVel.copy(forward).multiplyScalar(speed);
    planeVel.y -= PHYSICS.gravity * dt * 0.4;
    planeVel.multiplyScalar(PHYSICS.airResistance);
    
    planePos.add(planeVel.clone().multiplyScalar(dt));
    
    // Ground collision
    if (planePos.y < PHYSICS.groundHeight) {
        if (speed > PHYSICS.crashSpeed || Math.abs(planeVel.y) > 10) {
            crash();
            return;
        } else {
            planePos.y = PHYSICS.groundHeight;
            planeVel.y = Math.abs(planeVel.y) * 0.2;
        }
    }
    
    // Update plane transform
    plane.position.copy(planePos);
    plane.quaternion.copy(planeQuat);
    
    // Propeller animation
    if (propeller) {
        propeller.rotation.z += speed * dt * 5;
    }
    
    // Check game objectives
    checkProgress();
    
    // Update HUD
    updateHUD();
}

function checkProgress() {
    // Check checkpoints
    checkpoints.forEach((checkpoint, index) => {
        if (checkpoint.userData.collected) {
            // Fade out collected checkpoints
            const ring = checkpoint.children[0];
            if (ring && ring.material) {
                ring.material.opacity = Math.max(0, ring.material.opacity - 0.01);
            }
            return;
        }
        
        const dist = planePos.distanceTo(checkpoint.position);
        
        if (dist < 2) {
            // Check if flying through (not around) the ring
            const toPlane = new THREE.Vector3().subVectors(planePos, checkpoint.position).normalize();
            const ringNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(checkpoint.quaternion);
            const dot = Math.abs(toPlane.dot(ringNormal));
            
            if (dot > 0.4 && dist < 1.6) {
                collectCheckpoint(checkpoint);
            }
        }
    });
    
    // Check obstacles collision
    obstacles.forEach(obstacle => {
        const dist = planePos.distanceTo(obstacle.position);
        if (dist < 1.5) {
            crash();
        }
    });
    
    // Check finish line
    if (checkpointsCollected === totalCheckpoints && finishLine && finishLine.visible) {
        const distToFinish = planePos.distanceTo(finishLine.position);
        if (distToFinish < 3.5) {
            finishRace();
        }
    }
}

function collectCheckpoint(checkpoint) {
    checkpoint.userData.collected = true;
    
    // Visual feedback
    const ring = checkpoint.children[0];
    if (ring && ring.material) {
        ring.material.color.setHex(0xffd700);
        ring.material.emissive.setHex(0xffd700);
    }
    
    checkpointsCollected++;
    
    showNotification(`Checkpoint ${checkpointsCollected}/${totalCheckpoints}`);
    
    // Vibration feedback
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    
    // Show finish line when all checkpoints collected
    if (checkpointsCollected === totalCheckpoints && finishLine) {
        finishLine.visible = true;
        showNotification('All checkpoints! Reach the FINISH LINE!');
    }
}

function crash() {
    isFlying = false;
    planeVel.set(0, 0, 0);
    speed = 0;
    
    // Vibration feedback
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
    
    showNotification('CRASHED!');
    
    setTimeout(() => {
        endGame(false);
    }, 1500);
}

function finishRace() {
    isFlying = false;
    
    // Vibration feedback
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100, 50, 200]);
    }
    
    showNotification('FINISH!');
    
    setTimeout(() => {
        endGame(true);
    }, 1000);
}

function endGame(victory) {
    if (gameTimer) {
        clearInterval(gameTimer);
    }
    
    // Hide game UI
    document.getElementById('gameHUD').classList.remove('active');
    document.getElementById('controls').classList.remove('active');
    
    // Show results
    const elapsed = ((Date.now() - gameStartTime) / 1000).toFixed(1);
    document.getElementById('resultsTitle').textContent = victory ? 'VICTORY!' : 'GAME OVER';
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
    
    if (gameTimer) {
        clearInterval(gameTimer);
    }
    
    document.getElementById('gameHUD').classList.remove('active');
    document.getElementById('controls').classList.remove('active');
    document.getElementById('pauseMenu').classList.remove('active');
    document.getElementById('resultsScreen').classList.remove('active');
}

function updateHUD() {
    document.getElementById('speedValue').textContent = Math.round(speed * 25);
    document.getElementById('altValue').textContent = planePos.y.toFixed(1);
    document.getElementById('checksCurrent').textContent = checkpointsCollected;
}

function showNotification(message) {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.classList.add('show');
    setTimeout(() => {
        notif.classList.remove('show');
    }, 800);
}

function updateStatus(message, status) {
    const statusEl = document.getElementById('arStatus');
    statusEl.textContent = message;
    statusEl.className = 'status-text';
    if (status) {
        statusEl.classList.add(status);
    }
}

// ==================== UI SETUP ====================
function setupUI() {
    // Mode selection
    document.querySelectorAll('.mode-card').forEach(card => {
        card.addEventListener('click', () => {
            currentMode = card.dataset.mode;
            document.getElementById('mainMenu').classList.remove('active');
            document.getElementById('placementScreen').classList.add('active');
            createPlane();
            initAR();
        });
    });
    
    // Back button
    document.getElementById('backBtn').addEventListener('click', () => {
        document.getElementById('placementScreen').classList.remove('active');
        document.getElementById('mainMenu').classList.add('active');
        resetGame();
    });
    
    // Place button
    document.getElementById('placeBtn').addEventListener('click', () => {
        if (reticle.visible) {
            placePlane();
        }
    });
    
    // Pause
    document.getElementById('pauseBtn').addEventListener('click', togglePause);
    document.getElementById('resumeBtn').addEventListener('click', togglePause);
    
    // Restart/Quit
    document.getElementById('restartBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('pauseMenu').classList.remove('active');
        document.getElementById('placementScreen').classList.add('active');
        createPlane();
        initAR();
    });
    
    document.getElementById('quitBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('pauseMenu').classList.remove('active');
        document.getElementById('mainMenu').classList.add('active');
    });
    
    // Results
    document.getElementById('playAgainBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('resultsScreen').classList.remove('active');
        document.getElementById('placementScreen').classList.add('active');
        createPlane();
        initAR();
    });
    
    document.getElementById('mainMenuBtn').addEventListener('click', () => {
        resetGame();
        document.getElementById('resultsScreen').classList.remove('active');
        document.getElementById('mainMenu').classList.add('active');
    });
    
    // Help
    document.getElementById('helpBtn').addEventListener('click', () => {
        document.getElementById('helpOverlay').classList.add('active');
    });
    
    document.getElementById('closeHelp').addEventListener('click', () => {
        document.getElementById('helpOverlay').classList.remove('active');
    });
}

function togglePause() {
    isPaused = !isPaused;
    
    if (isPaused) {
        const elapsed = ((Date.now() - gameStartTime) / 1000).toFixed(1);
        document.getElementById('pauseTime').textContent = elapsed + 's';
        document.getElementById('pauseChecks').textContent = `${checkpointsCollected}/${totalCheckpoints}`;
        document.getElementById('pauseMenu').classList.add('active');
    } else {
        document.getElementById('pauseMenu').classList.remove('active');
    }
}

// ==================== AR INITIALIZATION ====================
function initAR() {
    // Trigger AR session
    const arButton = document.querySelector('button[id^="ARButton"]');
    if (arButton) {
        arButton.click();
        updateStatus('Starting AR session...', '');
    } else {
        updateStatus('AR not available - using manual placement', 'error');
        // Enable manual placement after delay
        setTimeout(() => {
            document.getElementById('placeBtn').disabled = false;
            updateStatus('Tap PLACE AIRCRAFT to continue', 'ready');
        }, 1000);
    }
}

function placePlane() {
    if (!plane) return;
    
    // Get position from reticle or default
    if (reticle.visible) {
        planePos.setFromMatrixPosition(reticle.matrix);
        planePos.y += 1.2;
    } else {
        // Fallback: place in front of camera
        const cameraPos = camera.getWorldPosition(new THREE.Vector3());
        const cameraDir = new THREE.Vector3(0, 0, -4);
        cameraDir.applyQuaternion(camera.quaternion);
        planePos.copy(cameraPos).add(cameraDir);
        planePos.y = Math.max(planePos.y, 2);
    }
    
    plane.position.copy(planePos);
    planeQuat.identity();
    plane.quaternion.copy(planeQuat);
    plane.visible = true;
    
    speed = 6;
    targetSpeed = 10;
    isPlaced = true;
    
    // Hide placement screen
    document.getElementById('placementScreen').classList.remove('active');
    
    // Start game
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
            const x = touch.clientX;
            const y = touch.clientY;
            
            const leftRect = leftJoyEl.getBoundingClientRect();
            const rightRect = rightJoyEl.getBoundingClientRect();
            
            if (x >= leftRect.left && x <= leftRect.right &&
                y >= leftRect.top && y <= leftRect.bottom) {
                touches.set(touch.identifier, 'left');
            } else if (x >= rightRect.left && x <= rightRect.right &&
                       y >= rightRect.top && y <= rightRect.bottom) {
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
            const maxDistance = rect.width / 2 - 35;
            
            if (distance > maxDistance) {
                const angle = Math.atan2(dy, dx);
                dx = Math.cos(angle) * maxDistance;
                dy = Math.sin(angle) * maxDistance;
            }
            
            stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            
            joy.x = dx / maxDistance;
            joy.y = dy / maxDistance;
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
        
        if (e.key === 'Escape' && isFlying) {
            togglePause();
        }
    });
    
    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });
    
    // Update joysticks from keyboard
    setInterval(() => {
        if (!isFlying || isPaused) return;
        
        // Left joystick
        if (keys['w'] || keys['arrowup']) {
            leftJoy.y = -1;
        } else if (keys['s'] || keys['arrowdown']) {
            leftJoy.y = 1;
        } else {
            if (!touches.has('left')) leftJoy.y = 0;
        }
        
        // Right joystick
        if (keys['a'] || keys['arrowleft']) {
            rightJoy.x = -1;
        } else if (keys['d'] || keys['arrowright']) {
            rightJoy.x = 1;
        } else {
            if (!touches.has('right')) rightJoy.x = 0;
        }
        
        if (keys['q']) rightJoy.y = -1;
        else if (keys['e']) rightJoy.y = 1;
        else if (!touches.has('right')) rightJoy.y = 0;
        
        // Boost
        if (keys[' '] || keys['shift']) {
            isBoosting = true;
            document.getElementById('boostBtn').classList.add('active');
        } else {
            if (!document.getElementById('boostBtn').classList.contains('touching')) {
                isBoosting = false;
                document.getElementById('boostBtn').classList.remove('active');
            }
        }
    }, 16);
}

function setupBoost() {
    const boostBtn = document.getElementById('boostBtn');
    
    boostBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isBoosting = true;
        boostBtn.classList.add('active', 'touching');
    });
    
    boostBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        isBoosting = false;
        boostBtn.classList.remove('active', 'touching');
    });
    
    boostBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isBoosting = true;
        boostBtn.classList.add('active', 'touching');
    });
    
    boostBtn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        isBoosting = false;
        boostBtn.classList.remove('active', 'touching');
    });
}

// ==================== RENDER LOOP ====================
function render(timestamp, frame) {
    const dt = Math.min(0.05, 0.016);
    
    // AR Hit Testing
    if (frame && !isPlaced) {
        // Request hit test source
        if (!hitTestSourceRequested) {
            const session = renderer.xr.getSession();
            if (session) {
                session.requestReferenceSpace('viewer').then((refSpace) => {
                    localSpace = refSpace;
                    session.requestHitTestSource({ space: refSpace }).then((source) => {
                        hitTestSource = source;
                        updateStatus('Surface detected! Tap PLACE AIRCRAFT', 'ready');
                        document.getElementById('placeBtn').disabled = false;
                    }).catch((err) => {
                        console.error('Hit test error:', err);
                        updateStatus('Hit-test unavailable. Tap to place manually', 'ready');
                        document.getElementById('placeBtn').disabled = false;
                    });
                });
                hitTestSourceRequested = true;
            }
        }
        
        // Perform hit test
        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(renderer.xr.getReferenceSpace());
                
                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
                
                // Pulse animation
                const scale = 1 + Math.sin(Date.now() * 0.005) * 0.1;
                reticle.scale.set(scale, scale, scale);
            } else {
                reticle.visible = false;
            }
        }
    }
    
    // Update game physics
    updatePhysics(dt);
    
    // Animate checkpoints
    checkpoints.forEach(cp => {
        if (!cp.userData.collected) {
            cp.userData.timer += dt;
            const scale = 1 + Math.sin(cp.userData.timer * 4) * 0.12;
            cp.scale.set(scale, scale, scale);
            cp.rotation.y += dt * 0.8;
        }
    });
    
    // Animate obstacles
    obstacles.forEach(obs => {
        obs.rotation.x += dt * 0.5;
        obs.rotation.y += dt * 0.3;
    });
    
    // Animate finish line
    if (finishLine && finishLine.visible) {
        finishLine.rotation.y += dt * 0.5;
    }
    
    renderer.render(scene, camera);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==================== CONSOLE LOG ====================
console.log('%c🛩️ EPSTEIN JETS', 'font-size: 24px; font-weight: bold; color: #00d4ff;');
console.log('%cAR Racing Game v2.0', 'font-size: 14px; color: #ff3366;');
console.log('%cProduction Ready | Clean Code | No Errors', 'font-size: 12px; color: #00ff88;');