import { _decorator, Component, Node, input, Input, EventTouch, math, Vec3 } from 'cc';
import { VisualBanking } from './VisualBanking';
import { UIManager } from './UIManager';
import { ObstacleManager } from './ObstacleManager';
import { TrackManager } from './TrackManager';

const { ccclass, property } = _decorator;

@ccclass('PlayerController')
export class PlayerController extends Component {

    @property
    public moveSpeed: number = 20;

    // ========== Free Sliding Movement ==========
    private readonly ROAD_HALF_WIDTH: number = 7.0;
    private readonly SLIDE_SPEED: number = 12;
    private readonly DRAG_SENSITIVITY: number = 0.025;

    public _currentSpeedFactor: number = 1.0;

    private _targetX: number = 0;
    private _isMoving: boolean = true;

    // ========== Combat Lock ==========
    private _isCombatLocked: boolean = false;

    public setCombatLock(locked: boolean) {
        this._isCombatLocked = locked;
        if (locked) {
            // User Request: Creep Forward at 15% speed (0.15)
            this._currentSpeedFactor = 0.15;
        } else {
            this._currentSpeedFactor = 1.0;
        }
    }

    start() {
        this._isCombatLocked = false;
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this._targetX = 0;
        this.ensureVisualBanking();
    }

    private ensureVisualBanking() {
        // Add VisualBanking ONLY to the 3D model child, skip UI nodes (Label, etc.)
        for (let i = 0; i < this.node.children.length; i++) {
            const child = this.node.children[i];
            if (child.getComponent('cc.Label') || child.getComponent('cc.UITransform')) continue;
            if (!child.getComponent(VisualBanking)) {
                child.addComponent(VisualBanking);
            }
            return; // Only the first 3D model child
        }
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    }

    onTouchStart(event: EventTouch) {
        if (!this._isMoving || !UIManager.isPlaying || this._isCombatLocked) return;
    }

    onTouchMove(event: EventTouch) {
        if (!this._isMoving || !UIManager.isPlaying || this._isCombatLocked) return;
        const delta = event.getDelta();
        this._targetX += delta.x * this.DRAG_SENSITIVITY;
        this._targetX = math.clamp(this._targetX, -this.ROAD_HALF_WIDTH, this.ROAD_HALF_WIDTH);
    }

    update(deltaTime: number) {
        if (!this._isMoving || !UIManager.isPlaying) return;

        // Combat Lock: Force Speed 0.15 (15%) - Creep Forward
        if (this._isCombatLocked) {
            this._currentSpeedFactor = 0.15;
        }

        // Apply Dynamic Speed Boost
        const globalSpeedMult = TrackManager.instance ? TrackManager.instance.speedMultiplier : 1.0;
        const effectiveSpeed = this.moveSpeed * this._currentSpeedFactor * globalSpeedMult;
        const currentPos = this.node.position;

        // X Movement (Slide)
        let newX = currentPos.x;
        if (!this._isCombatLocked) {
            newX = math.lerp(currentPos.x, this._targetX, deltaTime * this.SLIDE_SPEED);
        }

        const newZ = currentPos.z - (effectiveSpeed * deltaTime);

        // Clamping logic
        let minX = -this.ROAD_HALF_WIDTH;
        let maxX = this.ROAD_HALF_WIDTH;

        const limit = ObstacleManager.getFenceForbiddenWidth(newZ);
        if (limit > 0) {
            if (currentPos.x < 0) maxX = -limit;
            else minX = limit;
        }

        newX = math.clamp(newX, minX, maxX);
        this._targetX = math.clamp(this._targetX, minX, maxX);

        this.node.setPosition(newX, currentPos.y, newZ);
    }

    public getPlayerX(): number {
        return this.node.position.x;
    }

    public stopMoving() {
        if (!this._isMoving) return;
        this._isMoving = false;
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        console.log('PlayerController: 角色已强制刹车');
    }
}
