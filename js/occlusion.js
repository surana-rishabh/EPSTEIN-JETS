// ============================================================
// Real-World Occlusion & Collision System
//
// Uses WebXR plane-detection to discover real-world surfaces.
// Creates "occluder" meshes that write ONLY to the depth buffer
// (colorWrite: false) so virtual objects behind them are hidden.
// Also provides collision queries against those surfaces.
// ============================================================
import * as THREE from 'three';

export class OcclusionSystem {
    constructor(scene, renderer) {
        this.scene    = scene;
        this.renderer = renderer;

        // Map: XRPlane → THREE.Mesh
        this.trackedPlanes = new Map();

        // Container rendered BEFORE virtual objects (renderOrder = -1)
        this.occluderGroup = new THREE.Group();
        this.occluderGroup.renderOrder = -1;
        scene.add(this.occluderGroup);

        // Depth-only material (invisible but blocks virtual objects)
        this.occluderMaterial = new THREE.MeshBasicMaterial({
            colorWrite: false,
            side: THREE.DoubleSide,
        });

        // Debug visualisation (toggle with toggleDebug())
        this.debugMode     = false;
        this.debugMaterial = new THREE.MeshBasicMaterial({
            color: 0x0088ff,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
            wireframe: true,
        });

        this.planeDetectionSupported = false;
        this.detectedPlaneCount      = 0;
    }

    /* --------------------------------------------------
     *  Called every frame from the render loop
     * -------------------------------------------------- */
    update(frame) {
        if (!frame) return;

        const refSpace = this.renderer.xr.getReferenceSpace();
        if (!refSpace) return;

        // `detectedPlanes` is a Set<XRPlane> provided by the UA
        if (frame.detectedPlanes === undefined) return;

        this.planeDetectionSupported = true;
        const currentPlanes = frame.detectedPlanes;
        this.detectedPlaneCount = currentPlanes.size;

        // ---- Remove stale planes ----
        for (const [xrPlane, mesh] of this.trackedPlanes) {
            if (!currentPlanes.has(xrPlane)) {
                this.occluderGroup.remove(mesh);
                mesh.geometry.dispose();
                this.trackedPlanes.delete(xrPlane);
            }
        }

        // ---- Add / update tracked planes ----
        for (const xrPlane of currentPlanes) {
            const pose = frame.getPose(xrPlane.planeSpace, refSpace);
            if (!pose) continue;

            if (this.trackedPlanes.has(xrPlane)) {
                // Update transform
                const mesh = this.trackedPlanes.get(xrPlane);
                mesh.matrix.fromArray(pose.transform.matrix);
                mesh.matrixWorldNeedsUpdate = true;

                // Rebuild geometry if polygon changed
                if (mesh.userData.lastChanged !== xrPlane.lastChangedTime) {
                    const newGeo = this._geometryFromPolygon(xrPlane.polygon);
                    if (newGeo) {
                        mesh.geometry.dispose();
                        mesh.geometry = newGeo;
                        mesh.userData.lastChanged = xrPlane.lastChangedTime;
                    }
                }
            } else {
                // New plane → create occluder mesh
                const geometry = this._geometryFromPolygon(xrPlane.polygon);
                if (!geometry) continue;

                const mat  = this.debugMode
                    ? this.debugMaterial.clone()
                    : this.occluderMaterial;
                const mesh = new THREE.Mesh(geometry, mat);

                mesh.matrixAutoUpdate        = false;
                mesh.matrix.fromArray(pose.transform.matrix);
                mesh.matrixWorldNeedsUpdate  = true;
                mesh.renderOrder             = -1;
                mesh.userData.lastChanged    = xrPlane.lastChangedTime;
                mesh.userData.orientation     = xrPlane.orientation; // 'horizontal' | 'vertical'

                this.occluderGroup.add(mesh);
                this.trackedPlanes.set(xrPlane, mesh);
            }
        }

        // HUD
        const el = document.getElementById('occlusionInfo');
        if (el) el.textContent = `🧱 Surfaces: ${this.detectedPlaneCount}`;
    }

    /* --------------------------------------------------
     *  Build a flat ShapeGeometry from an XRPlane polygon
     * -------------------------------------------------- */
    _geometryFromPolygon(polygon) {
        if (!polygon || polygon.length < 3) return null;

        // Vertices lie in the plane's local XZ space (Y ≈ 0)
        const shape = new THREE.Shape();
        shape.moveTo(polygon[0].x, polygon[0].z);
        for (let i = 1; i < polygon.length; i++) {
            shape.lineTo(polygon[i].x, polygon[i].z);
        }
        shape.closePath();

        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2); // XY → XZ
        return geo;
    }

    /* --------------------------------------------------
     *  Collision detection against occluder surfaces
     * -------------------------------------------------- */

    /**
     * Cast short rays from each collision point in 6 directions.
     * @param {THREE.Vector3[]} points – key points around the aircraft
     * @returns {{ point, normal, distance } | null}
     */
    checkCollision(points) {
        if (this.trackedPlanes.size === 0) return null;

        // Gather occluder meshes with up-to-date world matrices
        const meshes = [];
        this.occluderGroup.traverse((child) => {
            if (child.isMesh) {
                child.updateWorldMatrix(true, false);
                meshes.push(child);
            }
        });
        if (meshes.length === 0) return null;

        const raycaster  = new THREE.Raycaster();
        raycaster.near   = 0;
        raycaster.far    = 0.25;          // 25 cm detection radius

        const dirs = [
            new THREE.Vector3( 0, -1,  0),
            new THREE.Vector3( 0,  1,  0),
            new THREE.Vector3( 1,  0,  0),
            new THREE.Vector3(-1,  0,  0),
            new THREE.Vector3( 0,  0,  1),
            new THREE.Vector3( 0,  0, -1),
        ];

        for (const pt of points) {
            for (const dir of dirs) {
                raycaster.set(pt, dir);
                const hits = raycaster.intersectObjects(meshes, false);
                if (hits.length > 0 && hits[0].distance < 0.15) {
                    return {
                        point:    hits[0].point.clone(),
                        normal:   hits[0].face
                            ? hits[0].face.normal.clone()
                            : dir.clone().negate(),
                        distance: hits[0].distance,
                    };
                }
            }
        }

        return null;
    }

    /* --------------------------------------------------
     *  Utils
     * -------------------------------------------------- */

    toggleDebug() {
        this.debugMode = !this.debugMode;
        this.occluderGroup.traverse((child) => {
            if (child.isMesh) {
                child.material.dispose();
                child.material = this.debugMode
                    ? this.debugMaterial.clone()
                    : this.occluderMaterial;
            }
        });
    }

    getPlaneCount() { return this.detectedPlaneCount; }

    dispose() {
        this.occluderGroup.traverse((child) => {
            if (child.isMesh) {
                child.geometry.dispose();
                child.material.dispose();
            }
        });
        this.scene.remove(this.occluderGroup);
        this.trackedPlanes.clear();
    }
}
