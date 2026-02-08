// ============================================================
// Realistic Airplane Physics Engine
// Aerodynamic forces: lift, drag, thrust, gravity, wind
// ============================================================
import * as THREE from 'three';

export class PhysicsEngine {
    constructor() {
        // --- Aircraft parameters (tuned for AR scale) ---
        this.mass          = 1.0;     // kg
        this.gravity       = 9.81;    // m/s²
        this.wingArea      = 0.5;     // m²
        this.airDensity    = 1.225;   // kg/m³
        this.maxThrust     = 14;      // N
        this.boostThrust   = 28;      // N

        // Aerodynamic coefficients
        this.liftCoefficient    = 1.0;   // base Cl
        this.dragCoefficient    = 0.04;  // parasitic Cd₀
        this.inducedDragFactor  = 0.08;  // k for induced drag

        // Stability
        this.lateralDamping = 0.95;  // side-slip dissipation per frame

        // --- Runtime state ---
        this.velocity        = new THREE.Vector3();
        this.angularVelocity = new THREE.Vector3();
        this.isStalling      = false;

        // Wind
        this.wind       = new THREE.Vector3();
        this.turbulence = 0;
        this._turbTime  = Math.random() * 1000;
    }

    /* ---- Configuration ---- */

    setWind(speed, direction, turbulence) {
        const dir = new THREE.Vector3(...direction);
        if (dir.lengthSq() > 0) dir.normalize();
        this.wind.copy(dir).multiplyScalar(speed);
        this.turbulence = turbulence;
    }

    setInitialVelocity(direction, speed) {
        this.velocity.copy(direction).normalize().multiplyScalar(speed);
    }

    reset() {
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.isStalling = false;
    }

    /* ---- Main update ---- */

    update(dt, controls, position, quaternion, isBoosting) {
        dt = Math.min(dt, 0.035); // clamp to prevent explosion on lag

        // ========== 1. ROTATION (responsive direct-quaternion control) ==========
        const turnRate = 2.8 * dt;

        const pitchQ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), controls.pitch * turnRate
        );
        const yawQ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), controls.yaw * turnRate
        );
        const rollQ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), -controls.roll * turnRate
        );
        quaternion.multiply(pitchQ).multiply(yawQ).multiply(rollQ).normalize();

        // Body axes (recalculated after rotation)
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
        const up      = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

        // ========== 2. AERODYNAMIC FORCES ==========
        const speed           = this.velocity.length();
        const dynamicPressure = 0.5 * this.airDensity * speed * speed;

        // --- Thrust ---
        const thrustMag = controls.throttle * (isBoosting ? this.boostThrust : this.maxThrust);
        const thrust    = forward.clone().multiplyScalar(thrustMag);

        // --- Gravity ---
        const gravityForce = new THREE.Vector3(0, -this.mass * this.gravity, 0);

        // --- Lift (perpendicular to wings = body "up") ---
        //   At speed ~5.7 m/s with Cl=1.0, lift ≈ weight  (stall below ~3 m/s)
        const liftMag   = dynamicPressure * this.wingArea * this.liftCoefficient;
        const liftForce = up.clone().multiplyScalar(liftMag);

        // --- Drag (opposes velocity) ---
        const cd      = this.dragCoefficient +
                         this.inducedDragFactor * this.liftCoefficient * this.liftCoefficient;
        const dragMag = dynamicPressure * this.wingArea * cd;
        const dragDir = this.velocity.lengthSq() > 0.001
            ? this.velocity.clone().normalize().negate()
            : new THREE.Vector3();
        const dragForce = dragDir.multiplyScalar(dragMag);

        // --- Total force → acceleration ---
        const totalForce = new THREE.Vector3()
            .add(thrust)
            .add(gravityForce)
            .add(liftForce)
            .add(dragForce);

        const acceleration = totalForce.divideScalar(this.mass);
        this.velocity.add(acceleration.multiplyScalar(dt));

        // ========== 3. WIND & TURBULENCE ==========
        if (this.wind.lengthSq() > 0) {
            this.velocity.add(this.wind.clone().multiplyScalar(dt * 0.5));
        }
        if (this.turbulence > 0) {
            this._turbTime += dt;
            const t = this._turbTime;
            const turb = new THREE.Vector3(
                Math.sin(t * 3.1 + 1.7) * this.turbulence,
                Math.sin(t * 2.3 + 4.2) * this.turbulence * 0.5,
                Math.cos(t * 2.7 + 0.3) * this.turbulence
            );
            this.velocity.add(turb.multiplyScalar(dt));
        }

        // ========== 4. AERODYNAMIC ALIGNMENT ==========
        // Side-force dissipation: velocity drifts toward forward direction
        const forwardSpeed = this.velocity.dot(forward);
        const forwardVel   = forward.clone().multiplyScalar(forwardSpeed);
        const sideVel      = this.velocity.clone().sub(forwardVel);
        sideVel.multiplyScalar(this.lateralDamping);
        this.velocity.copy(forwardVel.add(sideVel));

        // Speed clamp
        const maxSpeed = isBoosting ? 22 : 14;
        if (this.velocity.length() > maxSpeed) {
            this.velocity.normalize().multiplyScalar(maxSpeed);
        }

        // ========== 5. POSITION UPDATE ==========
        position.add(this.velocity.clone().multiplyScalar(dt));

        // ========== 6. STALL DETECTION ==========
        this.isStalling = speed < 2.5 && position.y > 0.5;

        return {
            speed:      this.velocity.length(),
            isStalling: this.isStalling,
            altitude:   position.y,
        };
    }
}
