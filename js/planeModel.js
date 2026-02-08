// ============================================================
// Plane Model – loads plane.glb via GLTFLoader with auto-scale
// Falls back to a procedural model if the GLB is missing.
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class PlaneModel {
    constructor(scene) {
        this.scene      = scene;
        this.group       = new THREE.Group();
        this.propeller   = null;
        this.modelLoaded = false;
        this.boundingBox = new THREE.Box3();

        this._crashParticles = null;

        this.group.visible   = false;
        this.group.renderOrder = 0;
        scene.add(this.group);
    }

    /* -------------------------------------------------- */
    /*  Loading                                           */
    /* -------------------------------------------------- */

    async load() {
        return new Promise((resolve) => {
            const loader = new GLTFLoader();
            loader.load(
                'models/plane.glb',
                (gltf) => {
                    const model = gltf.scene;

                    // Auto-scale so longest axis ≈ 1 m
                    const box  = new THREE.Box3().setFromObject(model);
                    const size = new THREE.Vector3();
                    box.getSize(size);
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const scale  = 1.0 / maxDim;
                    model.scale.setScalar(scale);

                    // Centre the model
                    box.setFromObject(model);
                    const center = new THREE.Vector3();
                    box.getCenter(center);
                    model.position.sub(center);

                    // Shadows
                    model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow    = true;
                            child.receiveShadow = true;
                        }
                    });

                    this.group.add(model);
                    this.modelLoaded = true;

                    // Try to locate propeller in the model hierarchy
                    model.traverse((child) => {
                        if (child.name && child.name.toLowerCase().includes('prop')) {
                            this.propeller = child;
                        }
                    });

                    console.log('✅ plane.glb loaded');
                    resolve(true);
                },
                undefined,
                (err) => {
                    console.warn('⚠️ plane.glb not found – using procedural model.', err?.message || '');
                    this._createProceduralModel();
                    resolve(false);
                }
            );
        });
    }

    /* -------------------------------------------------- */
    /*  Procedural fallback                               */
    /* -------------------------------------------------- */

    _createProceduralModel() {
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0xcc2222, metalness: 0.6, roughness: 0.3,
        });
        const wingMat = new THREE.MeshStandardMaterial({
            color: 0xeeeeee, metalness: 0.3, roughness: 0.4,
        });

        // Fuselage
        const bodyGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.9, 12);
        bodyGeo.rotateX(Math.PI / 2);
        this.group.add(new THREE.Mesh(bodyGeo, bodyMat));

        // Nose cone
        const noseGeo = new THREE.ConeGeometry(0.08, 0.25, 12);
        noseGeo.rotateX(-Math.PI / 2);
        const nose = new THREE.Mesh(noseGeo, bodyMat);
        nose.position.z = -0.57;
        this.group.add(nose);

        // Wings
        const wingGeo = new THREE.BoxGeometry(1.5, 0.04, 0.3);
        const wings = new THREE.Mesh(wingGeo, wingMat);
        wings.position.set(0, -0.02, -0.1);
        this.group.add(wings);

        // Tail horizontal
        const tailGeo = new THREE.BoxGeometry(0.5, 0.03, 0.15);
        const tail = new THREE.Mesh(tailGeo, wingMat);
        tail.position.set(0, 0.02, 0.38);
        this.group.add(tail);

        // Tail vertical
        const tailVGeo = new THREE.BoxGeometry(0.03, 0.25, 0.18);
        const tailV = new THREE.Mesh(tailVGeo, wingMat);
        tailV.position.set(0, 0.14, 0.35);
        this.group.add(tailV);

        // Propeller
        const propGeo = new THREE.BoxGeometry(0.6, 0.04, 0.03);
        const propMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
        this.propeller = new THREE.Mesh(propGeo, propMat);
        this.propeller.position.z = -0.7;
        this.group.add(this.propeller);

        // Cockpit dome
        const cockpitGeo = new THREE.SphereGeometry(0.08, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        const cockpitMat = new THREE.MeshStandardMaterial({
            color: 0x88ccff, transparent: true, opacity: 0.5,
            metalness: 0.8, roughness: 0.1,
        });
        const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
        cockpit.position.set(0, 0.1, -0.15);
        this.group.add(cockpit);
    }

    /* -------------------------------------------------- */
    /*  Transform helpers                                 */
    /* -------------------------------------------------- */

    updateTransform(pos, quat) {
        this.group.position.copy(pos);
        this.group.quaternion.copy(quat);
        this.boundingBox.setFromObject(this.group);
    }

    spinPropeller(speed, dt) {
        if (this.propeller) this.propeller.rotation.z += speed * dt * 3;
    }

    show() { this.group.visible = true;  }
    hide() { this.group.visible = false; }

    getBoundingBox() {
        this.boundingBox.setFromObject(this.group);
        return this.boundingBox;
    }

    /**
     * Return 6 key points around the aircraft for collision testing.
     */
    getCollisionPoints() {
        const pos     = this.group.position.clone();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion);
        const up      = new THREE.Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
        const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(this.group.quaternion);

        return [
            pos.clone().add(forward.clone().multiplyScalar( 0.5)),  // nose
            pos.clone().add(forward.clone().multiplyScalar(-0.4)),  // tail
            pos.clone().add(right.clone().multiplyScalar( 0.6)),    // right wingtip
            pos.clone().add(right.clone().multiplyScalar(-0.6)),    // left wingtip
            pos.clone().add(up.clone().multiplyScalar( 0.15)),      // top
            pos.clone().add(up.clone().multiplyScalar(-0.1)),       // bottom
        ];
    }

    /* -------------------------------------------------- */
    /*  Crash particle effect                             */
    /* -------------------------------------------------- */

    createCrashEffect(position) {
        const count    = 60;
        const geometry = new THREE.BufferGeometry();
        const posArr   = new Float32Array(count * 3);
        const velocities = [];

        for (let i = 0; i < count; i++) {
            posArr[i * 3]     = position.x;
            posArr[i * 3 + 1] = position.y;
            posArr[i * 3 + 2] = position.z;
            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * 5,
                 Math.random() * 4,
                (Math.random() - 0.5) * 5
            ));
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        const material = new THREE.PointsMaterial({
            color: 0xff4400, size: 0.08, transparent: true, opacity: 1,
        });
        const particles = new THREE.Points(geometry, material);
        this.scene.add(particles);

        this._crashParticles = { particles, velocities, life: 1.0 };
    }

    updateCrashEffect(dt) {
        if (!this._crashParticles) return;
        const { particles, velocities } = this._crashParticles;
        this._crashParticles.life -= dt * 1.5;

        if (this._crashParticles.life <= 0) {
            this.scene.remove(particles);
            particles.geometry.dispose();
            particles.material.dispose();
            this._crashParticles = null;
            return;
        }

        const arr = particles.geometry.attributes.position.array;
        for (let i = 0; i < velocities.length; i++) {
            velocities[i].y -= 9.81 * dt;
            arr[i * 3]     += velocities[i].x * dt;
            arr[i * 3 + 1] += velocities[i].y * dt;
            arr[i * 3 + 2] += velocities[i].z * dt;
        }
        particles.geometry.attributes.position.needsUpdate = true;
        particles.material.opacity = this._crashParticles.life;
    }
}
