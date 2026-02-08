// ============================================================
// app.js – Main entry point for AR Flight Sim
//
// Initialises Three.js, WebXR, and wires all subsystems:
//   • PhysicsEngine   – realistic aerodynamic forces
//   • Controls        – touch joysticks + buttons
//   • GameManager     – levels, checkpoints, scoring
//   • OcclusionSystem – real-world surface occlusion & collision
//   • PlaneModel      – GLB loader with procedural fallback
// ============================================================
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

import { PhysicsEngine }   from './physics.js';
import { Controls }         from './controls.js';
import { GameManager }      from './game.js';
import { OcclusionSystem }  from './occlusion.js';
import { PlaneModel }       from './planeModel.js';

// ---- Core Three.js ----
let camera, scene, renderer;
let reticle;
let hitTestSource          = null;
let hitTestSourceRequested = false;

// ---- Subsystems ----
let physics, controls, game, occlusion, planeModel;

// ---- Plane state ----
const planePos  = new THREE.Vector3();
const planeQuat = new THREE.Quaternion();

// ---- Boot ----
init();

async function init() {
    // === Scene ===
    scene = new THREE.Scene();

    // === Camera ===
    camera = new THREE.PerspectiveCamera(
        70, window.innerWidth / window.innerHeight, 0.01, 200
    );

    // === Lighting ===
    scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 3));
    const dir = new THREE.DirectionalLight(0xffffff, 2.5);
    dir.position.set(5, 10, 5);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0x404040, 1));

    // === Renderer ===
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    // === AR Button ===
    //  • hit-test       → floor detection reticle
    //  • plane-detection → real-world occlusion & collision
    //  • dom-overlay     → HTML HUD in AR
    const arBtn = ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: [
            'dom-overlay',
            'plane-detection',
            'depth-sensing',
        ],
        domOverlay: { root: document.body },
    });
    document.body.appendChild(arBtn);

    // === Reticle (floor placement) ===
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // === Subsystems ===
    physics    = new PhysicsEngine();
    controls   = new Controls();
    game       = new GameManager(scene);
    occlusion  = new OcclusionSystem(scene, renderer);
    planeModel = new PlaneModel(scene);

    // Load GLB (falls back to procedural)
    await planeModel.load();

    // === Wire controls ===
    controls.setup({ onReset: () => game.resetGame() });

    // === Placement buttons ===
    document.getElementById('placeOnFloorBtn').addEventListener('click', () => {
        if (reticle.visible) {
            placePlane(false);
        } else {
            document.getElementById('info').textContent =
                '❌ No floor detected! Use "Place in Air"';
        }
    });
    document.getElementById('placeInAirBtn').addEventListener('click', () => {
        placePlane(true);
    });

    // === Callbacks ===
    game.onGameEnd = (win) => {
        controls.resetSticks();
        if (!win) planeModel.createCrashEffect(planePos.clone());
    };

    game.onReset = () => {
        planeModel.hide();
        physics.reset();
        controls.resetSticks();
        hitTestSourceRequested = false;
        reticle.visible = false;
    };

    // === Resize ===
    window.addEventListener('resize', onResize);

    // === Render loop ===
    renderer.setAnimationLoop(render);
}

/* ============================================================
 *  Place the airplane in the world
 * ============================================================ */
function placePlane(inAir) {
    const level = game.getLevelConfig();
    physics.setWind(level.windSpeed, level.windDirection, level.turbulence);

    if (inAir) {
        const camPos = camera.getWorldPosition(new THREE.Vector3());
        const camDir = new THREE.Vector3(0, 0, -3).applyQuaternion(camera.quaternion);
        planePos.copy(camPos).add(camDir);
        planePos.y = Math.max(planePos.y, 1.5);
        planeQuat.copy(camera.quaternion);
    } else {
        planePos.setFromMatrixPosition(reticle.matrix);
        planePos.y += 0.6;
        planeQuat.identity();
    }

    // Initial forward velocity
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
    physics.setInitialVelocity(fwd, 5);

    planeModel.updateTransform(planePos, planeQuat);
    planeModel.show();

    game.startLevel();
    document.getElementById('info').textContent = '✈️ Fly through the checkpoints!';
}

/* ============================================================
 *  Physics tick
 * ============================================================ */
function updatePhysics(dt) {
    if (!game.isFlying) return;

    const result = physics.update(
        dt, controls, planePos, planeQuat, controls.isBoosting
    );

    // --- Ground collision ---
    if (planePos.y < 0.15) {
        planePos.y = 0.15;
        game.endGame('CRASHED!', 'Hit the ground!', false);
        planeModel.createCrashEffect(planePos.clone());
        return;
    }

    // --- Ceiling clamp ---
    if (planePos.y > 50) {
        planePos.y = 50;
        physics.velocity.y = Math.min(physics.velocity.y, 0);
    }

    // --- Update model ---
    planeModel.updateTransform(planePos, planeQuat);
    planeModel.spinPropeller(result.speed, dt);

    // --- Stall warning ---
    document.getElementById('stallWarning').style.display =
        result.isStalling ? 'block' : 'none';

    // === Real-world collision (occlusion surfaces) ===
    const collisionPts = planeModel.getCollisionPoints();
    const hit = occlusion.checkCollision(collisionPts);
    if (hit) {
        game.endGame('CRASHED!', 'Hit a real-world object!', false);
        planeModel.createCrashEffect(hit.point || planePos.clone());
        return;
    }

    // --- Gameplay checks ---
    game.checkCheckpoints(planePos);
    game.checkFinish(planePos);

    // --- HUD ---
    game.updateHUD(result.speed, result.altitude);
}

/* ============================================================
 *  Render loop (called by WebXR animation frame)
 * ============================================================ */
function render(timestamp, frame) {
    const dt = 0.016; // ~60 fps target

    // ---- Hit-test for floor detection (before placement) ----
    if (frame && !game.isPlaced) {
        if (!hitTestSourceRequested) {
            const session = renderer.xr.getSession();
            if (session) {
                session.requestReferenceSpace('viewer').then((ref) => {
                    session.requestHitTestSource({ space: ref }).then((src) => {
                        hitTestSource = src;
                        document.getElementById('info').textContent =
                            '✅ AR Ready! Point at floor';
                    }).catch(() => {
                        document.getElementById('info').textContent =
                            '⚠️ Hit-test unavailable. Use "Place in Air"';
                    });
                });
                hitTestSourceRequested = true;

                session.addEventListener('end', () => {
                    hitTestSourceRequested = false;
                    hitTestSource = null;
                });
            }
        }

        if (hitTestSource) {
            const results = frame.getHitTestResults(hitTestSource);
            if (results.length > 0) {
                const pose = results[0].getPose(renderer.xr.getReferenceSpace());
                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
                document.getElementById('info').textContent =
                    '✅ Floor found! Tap PLACE ON FLOOR';
            } else {
                reticle.visible = false;
            }
        }
    }

    // ---- Occlusion system (real-world plane tracking) ----
    occlusion.update(frame);

    // ---- Physics & game logic ----
    updatePhysics(dt);

    // ---- Checkpoint animation ----
    game.animateCheckpoints(dt);

    // ---- Crash particles ----
    planeModel.updateCrashEffect(dt);

    // ---- Draw ----
    renderer.render(scene, camera);
}

/* ============================================================
 *  Resize handler
 * ============================================================ */
function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
