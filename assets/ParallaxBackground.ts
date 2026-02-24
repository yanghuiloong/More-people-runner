import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ParallaxBackground')
export class ParallaxBackground extends Component {
    @property({ type: Node, tooltip: '拖入你的主相机 (Main Camera)' })
    targetCamera: Node | null = null;

    @property({ tooltip: '跟随比例：1为完全同步，0为不跟随。通常0.9~0.95视差感最好' })
    parallaxRatio: number = 0.95;

    private _initialOffsetZ: number = 0;

    start() {
        if (!this.targetCamera) {
            console.error("【警告】请在编辑器中把 Main Camera 拖给 ParallaxBackground 脚本！");
            return;
        }
        // 记录游戏开始时，背景和相机在 Z 轴上的初始距离
        this._initialOffsetZ = this.node.position.z - this.targetCamera.position.z;
    }

    update(deltaTime: number) {
        if (!this.targetCamera) return;

        // 获取相机当前的 Z 位置
        const camZ = this.targetCamera.position.z;

        // 核心公式：新位置 = 相机位置 * 视差比率 + 初始距离差
        const newZ = camZ * this.parallaxRatio + this._initialOffsetZ;

        // 更新背景的 Z 轴位置，X和Y高度保持不变
        this.node.setPosition(this.node.position.x, this.node.position.y, newZ);
    }
}