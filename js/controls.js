// ============================================================
// Touch Joystick & Button Controls
// Left stick  → throttle (Y) + yaw (X)
// Right stick → pitch (Y) + roll (X)
// ============================================================

export class Controls {
    constructor() {
        this.throttle   = 0.3;
        this.pitch      = 0;
        this.roll       = 0;
        this.yaw        = 0;
        this.isBoosting = false;

        this._leftTouchId  = null;
        this._rightTouchId = null;
        this._onReset      = null;
    }

    /**
     * Wire up DOM controls.
     * @param {Object} callbacks  – { onReset }
     */
    setup(callbacks = {}) {
        this._onReset = callbacks.onReset || null;

        const leftJoy    = document.getElementById('leftJoy');
        const rightJoy   = document.getElementById('rightJoy');
        const leftStick  = document.getElementById('leftStick');
        const rightStick = document.getElementById('rightStick');

        const self = this;

        /* ---------- touch handlers ---------- */
        function handleTouchStart(e) {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                if (e.currentTarget === leftJoy && self._leftTouchId === null) {
                    self._leftTouchId = touch.identifier;
                    self._updateJoystick(leftJoy, leftStick, touch, true);
                } else if (e.currentTarget === rightJoy && self._rightTouchId === null) {
                    self._rightTouchId = touch.identifier;
                    self._updateJoystick(rightJoy, rightStick, touch, false);
                }
            }
        }

        function handleTouchMove(e) {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                if (touch.identifier === self._leftTouchId) {
                    self._updateJoystick(leftJoy, leftStick, touch, true);
                } else if (touch.identifier === self._rightTouchId) {
                    self._updateJoystick(rightJoy, rightStick, touch, false);
                }
            }
        }

        function handleTouchEnd(e) {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                if (touch.identifier === self._leftTouchId) {
                    self._leftTouchId = null;
                    leftStick.style.transform = 'translate(-50%, -50%)';
                    self.throttle = 0.3;
                    self.yaw = 0;
                } else if (touch.identifier === self._rightTouchId) {
                    self._rightTouchId = null;
                    rightStick.style.transform = 'translate(-50%, -50%)';
                    self.pitch = 0;
                    self.roll = 0;
                }
            }
        }

        const opts = { passive: false };
        leftJoy.addEventListener('touchstart',  handleTouchStart, opts);
        leftJoy.addEventListener('touchmove',   handleTouchMove,  opts);
        leftJoy.addEventListener('touchend',     handleTouchEnd,   opts);
        rightJoy.addEventListener('touchstart',  handleTouchStart, opts);
        rightJoy.addEventListener('touchmove',   handleTouchMove,  opts);
        rightJoy.addEventListener('touchend',     handleTouchEnd,   opts);

        /* ---------- boost ---------- */
        const boostBtn = document.getElementById('boostBtn');
        boostBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.isBoosting = true;
            boostBtn.classList.add('active');
        }, opts);
        boostBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.isBoosting = false;
            boostBtn.classList.remove('active');
        }, opts);

        /* ---------- reset ---------- */
        document.getElementById('resetBtn').addEventListener('click', () => {
            if (this._onReset) this._onReset();
        });
    }

    /* ---------- internal ---------- */

    _updateJoystick(zone, stick, touch, isLeft) {
        const rect    = zone.getBoundingClientRect();
        const centerX = rect.width  / 2;
        const centerY = rect.height / 2;

        const x    = touch.clientX - rect.left - centerX;
        const y    = touch.clientY - rect.top  - centerY;
        const dist = Math.sqrt(x * x + y * y);
        const max  = 40;
        const cDist = Math.min(dist, max);
        const angle = Math.atan2(y, x);

        const cx = Math.cos(angle) * cDist;
        const cy = Math.sin(angle) * cDist;

        stick.style.transform =
            `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;

        const nx =  cx / max;
        const ny = -cy / max;

        if (isLeft) {
            this.throttle = Math.max(0.1, Math.min(1, (ny + 1) / 2));
            this.yaw      = -nx * 1.5;
        } else {
            this.pitch = ny * 1.2;
            this.roll  = nx * 1.2;
        }
    }

    resetSticks() {
        this.throttle   = 0.3;
        this.pitch      = 0;
        this.roll       = 0;
        this.yaw        = 0;
        this.isBoosting = false;
        document.getElementById('leftStick').style.transform  = 'translate(-50%, -50%)';
        document.getElementById('rightStick').style.transform = 'translate(-50%, -50%)';
        document.getElementById('boostBtn').classList.remove('active');
    }
}
