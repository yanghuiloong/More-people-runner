import { _decorator, Component, Node, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CameraController')
export class CameraController extends Component {
    @property(Node)
    target: Node | null = null;

    private _offset: Vec3 = new Vec3();

    start() {
        if (this.target) {
            Vec3.subtract(this._offset, this.node.position, this.target.position);
        }
    }

    lateUpdate(deltaTime: number) {
        if (this.target) {
            const targetPos = this.target.position;
            this.node.setPosition(
                targetPos.x + this._offset.x,
                targetPos.y + this._offset.y,
                targetPos.z + this._offset.z
            );
        }
    }
}


