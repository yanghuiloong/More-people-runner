import { _decorator, Component, math } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('VisualBanking')
export class VisualBanking extends Component {

    @property({ tooltip: 'Lean strength (degrees per unit velocity)' })
    leanFactor: number = 3.0;

    @property({ tooltip: 'Smoothing speed (higher = faster response)' })
    smoothSpeed: number = 8.0;

    @property({ tooltip: 'Max tilt angle in degrees' })
    maxAngle: number = 35;

    private _prevWorldX: number = 0;
    private _currentRotZ: number = 0;
    private _initialized: boolean = false;

    onEnable() {
        this._initialized = false;
        this._currentRotZ = 0;
    }

    lateUpdate(deltaTime: number) {
        if (!this.node || !this.node.isValid) return;

        const worldX = this.node.worldPosition.x;

        if (!this._initialized) {
            this._prevWorldX = worldX;
            this._initialized = true;
            return;
        }

        const rawDelta = worldX - this._prevWorldX;

        // Sleep Logic: If moving straight (delta ~0) and already upright (rot ~0), skip
        if (Math.abs(rawDelta) < 0.001 && Math.abs(this._currentRotZ) < 0.01) {
            // Ensure exact zero if very close
            if (this._currentRotZ !== 0) {
                this._currentRotZ = 0;
                const e = this.node.eulerAngles;
                this.node.setRotationFromEuler(e.x, e.y, 0);
            }
            this._prevWorldX = worldX;
            return;
        }

        // Reset if teleported (large delta)
        if (Math.abs(rawDelta) > 5.0) {
            this._prevWorldX = worldX;
            this._currentRotZ = 0;
            return;
        }

        const velocityX = rawDelta / Math.max(deltaTime, 0.001);
        this._prevWorldX = worldX;

        const targetRotZ = -velocityX * this.leanFactor;
        const clampedTarget = math.clamp(targetRotZ, -this.maxAngle, this.maxAngle);

        this._currentRotZ = math.lerp(this._currentRotZ, clampedTarget, deltaTime * this.smoothSpeed);

        const e = this.node.eulerAngles;
        // Optimization: Don't set rotation if change is tiny? 
        // No, visual smoothness is important. But we covered the static case above.
        this.node.setRotationFromEuler(e.x, e.y, this._currentRotZ);
    }
}
