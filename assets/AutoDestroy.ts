import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;

/**
 * Helper component: auto-destroy after a delay.
 * Uses update() instead of scheduleOnce() to avoid timer issues
 * when the parent node is destroyed.
 */
@ccclass('AutoDestroy')
export class AutoDestroy extends Component {
    public lifetime: number = 1.0;
    private _elapsed: number = 0;

    update(dt: number) {
        this._elapsed += dt;
        if (this._elapsed >= this.lifetime) {
            this.node.destroy();
        }
    }
}
