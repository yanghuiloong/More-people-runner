import { _decorator, Component, Node, BoxCollider, ITriggerEvent, Label, Vec3, Color, MeshRenderer } from 'cc';
import { TrackManager } from './TrackManager';
import { AudioManager } from './AudioManager';
const { ccclass, property } = _decorator;

@ccclass('GateController')
export class GateController extends Component {
    @property
    public mathType: string = 'x'; // 运算类型（'+' 或 'x'）

    @property
    public value: number = 2; // 运算数值

    @property(Label)
    public gateLabel: Label | null = null; // 门上的 3D 文字标签

    private collider: BoxCollider | null = null;
    /** 防止同帧多个 Clone 重复触发 */
    private _triggered: boolean = false;

    // Moving Gate Properties
    public isMoving: boolean = false;
    public moveSpeed: number = 2.5;     // Speed (2.5 ~ 3.0)
    public moveAmplitude: number = 3.5; // Reduced from 5.0 to 3.5 to prevent clipping

    private _startPos: Vec3 = new Vec3(); // Should always be (0, 0, z) for moving gates
    private _time: number = 0;

    start() {
        // 保存初始位置用于移动计算
        this._startPos.set(this.node.position);

        // 获取当前节点上的 BoxCollider 组件
        this.collider = this.getComponent(BoxCollider);

        if (this.collider) {
            // 监听触发器进入事件
            this.collider.on('onTriggerEnter', this.onTrigger, this);
        } else {
            console.error('GateController: 未找到 BoxCollider 组件');
        }

        // 自动更新门上的文字显示
        this.updateVisuals();
    }

    update(deltaTime: number) {
        if (this.isMoving) {
            this._time += deltaTime;

            // Ping-Pong Movement (Sin Wave)
            const offsetX = Math.sin(this._time * this.moveSpeed) * this.moveAmplitude;
            const newPos = new Vec3(this._startPos.x + offsetX, this._startPos.y, this._startPos.z);

            this.node.setPosition(newPos);

            // Sync Label Position (if it's not a child of this node)
            if (this.gateLabel && this.gateLabel.node.parent !== this.node) {
                // Raise label higher (y + 2.0) as requested
                const labelPos = new Vec3(newPos.x, newPos.y + 2.0, newPos.z);
                this.gateLabel.node.setPosition(labelPos);
            }
        } else {
            // Even if static, enforce label height if needed (or do once in start)
            if (this.gateLabel && this.gateLabel.node.parent !== this.node) {
                // Static gates might need syncing if they were moved by something else, or just initial set
                // But let's assume static gates are fine unless we want to force them high too.
                // User said "all moving gates numbers low... make higher".
                // Let's force it for consistency if we can.
            }
        }
    }

    private updateVisuals() {
        if (this.gateLabel) {
            if (this.mathType === '?') {
                this.gateLabel.string = '?';
            } else {
                const symbol = this.mathType === '/' ? '÷' : this.mathType;
                this.gateLabel.string = symbol + this.value;
            }
            // Ensure label is visible and above gate
            // Note: If label is Child, changing Y is local offset.
            // If label is Sibling (as implied by sync logic), logic above handles it.
            // Let's assume Prefab structure has Label as Child. If so, setting Local Y is enough.
            if (this.gateLabel.node.parent === this.node) {
                this.gateLabel.node.setPosition(0, 2.5, 0); // Force local height (2.5 relative to center)
            }
        }
    }

    /**
     * 触发器进入回调
     * 【关键】只有队伍前端的 Clone（z ≤ 玩家 z）或 Player 本体才能触发
     * 防止队伍尾部经过已路过的门时误触
     */
    /**
     * 根据当前 FlowState 解析问号门的结果
     * 1. RECOVERY: 40% x2, 50% +50, 10% -5
     * 2. CHALLENGE: 15% x3, 35% +25, 35% -30, 15% /2
     * 3. GRINDER: 5% x5 (Jackpot), 45% -100, 50% /2
     */
    private resolveMysteryValue(state: string) {
        const r = Math.random();
        if (state === 'RECOVERY') {
            if (r < 0.40) { this.mathType = 'x'; this.value = 2; }
            else if (r < 0.90) { this.mathType = '+'; this.value = 50; }
            else { this.mathType = '-'; this.value = 5; }
        } else if (state === 'CHALLENGE') {
            if (r < 0.15) { this.mathType = 'x'; this.value = 3; }
            else if (r < 0.50) { this.mathType = '+'; this.value = 25; }
            else if (r < 0.85) { this.mathType = '-'; this.value = 30; }
            else { this.mathType = '/'; this.value = 2; }
        } else { // GRINDER
            if (r < 0.05) { this.mathType = 'x'; this.value = 5; }
            else if (r < 0.50) { this.mathType = '-'; this.value = 100; }
            else { this.mathType = '/'; this.value = 2; }
        }
    }

    private onTrigger(event: ITriggerEvent) {
        // 防止同帧多次触发
        if (this._triggered) return;

        const otherNode = event.otherCollider.node;

        // 沿父级链查找 CrowdManager（Player 直接有，Clone 在 parent 上）
        let crowdManager: any = null;
        let playerNode: Node | null = null;
        let checkNode: Node | null = otherNode;
        for (let i = 0; i < 3 && checkNode; i++) {
            const cm = checkNode.getComponent('CrowdManager');
            if (cm) {
                crowdManager = cm;
                playerNode = checkNode;
                break;
            }
            checkNode = checkNode.parent;
        }

        if (!crowdManager || !playerNode) return;

        // 【前端检测】Clone 必须在 Player 前方（z ≤ playerZ）才能触发门
        if (otherNode.name !== 'Player' && playerNode) {
            const cloneWorldZ = playerNode.position.z + otherNode.position.z;
            const playerZ = playerNode.position.z;
            if (cloneWorldZ > playerZ + 1.0) {
                return;
            }
        }

        // 标记已触发，防止重复
        this._triggered = true;

        // MYSTERY GATE LOGIC
        if (this.mathType === '?') {
            const tm = TrackManager.instance;
            if (tm) {
                const state = tm.getFlowState();
                this.resolveMysteryValue(state);

                // Use the NEW values after resolution
                const currentType = this.mathType as string;
                const currentValue = this.value;

                // Play Sound (Use standard gate sounds based on resolved result)
                const am = AudioManager.instance;
                if (am) {
                    am.playGateSound(currentType);
                }
            }
        } else {
            // Normal Gate Sound
            const am = AudioManager.instance;
            if (am) am.playGateSound(this.mathType);
        }

        // 立即执行数学运算 (使用请求的 applyGateEffect)
        if (crowdManager.applyGateEffect) {
            crowdManager.applyGateEffect(this.mathType, this.value);
        } else {
            crowdManager.applyMath(this.mathType, this.value);
        }

        // 禁用碰撞器
        event.selfCollider.enabled = false;

        // === VISUAL FEEDBACK: FLOATING TEXT ===
        if (this.gateLabel) {
            this.gateLabel.string = (this.mathType === '/' ? '÷' : this.mathType) + this.value;
            const isGood = (this.mathType === '+' || this.mathType === 'x');
            this.gateLabel.color = isGood ? new Color(0, 255, 0) : new Color(255, 0, 0);

            // Special Scaling for x5 Jackpot
            if (this.mathType === 'x' && this.value === 5) {
                this.gateLabel.node.setScale(1.5, 1.5, 1.5);
            }

            // Hiding MeshRenderer of the Gate Node
            const renderers = this.node.getComponentsInChildren(MeshRenderer);
            renderers.forEach(r => r.enabled = false);

            // Animate Label Floating Up
            const startY = this.gateLabel.node.position.y;
            let t = 0;
            this.schedule((dt) => {
                t += dt;
                if (this.gateLabel) {
                    const p = this.gateLabel.node.position;
                    this.gateLabel.node.setPosition(p.x, p.y + dt * 10.0, p.z);
                }
            }, 0, 40);
        }

        // Delayed destruction to allow "Float" to be seen
        this.scheduleOnce(() => {
            const gateRoot = this.node.parent;
            if (gateRoot) {
                gateRoot.active = false;
                gateRoot.destroy();
            } else {
                this.node.active = false;
                this.node.destroy();
            }
        }, 0.8);
    }

    /**
     * 动态设置门的数学逻辑
     * @param type 运算类型（'+' 或 'x'）
     * @param val 运算数值
     */
    public setMathLogic(type: string, val: number) {
        this.mathType = type;
        this.value = val;
        this.updateVisuals();
    }
}
