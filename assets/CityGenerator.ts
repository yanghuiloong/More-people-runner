import { _decorator, Component, Node, Prefab, instantiate, Vec2, Vec3, math, MeshRenderer, Color } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CityGenerator')
export class CityGenerator extends Component {

    @property({ type: Node }) targetCamera: Node | null = null;
    @property({ type: Prefab }) buildingPrefab: Prefab | null = null;
    @property poolSize: number = 30;
    @property spawnY: number = -150;
    @property spawnRangeZ: number = 500;
    @property spawnRangeX: Vec2 = new Vec2(30, 200);
    @property buildingScaleRange: Vec2 = new Vec2(50, 200);
    @property buildingWidthRange: Vec2 = new Vec2(10, 40);
    @property cullDistance: number = 50;

    private _pool: Node[] = [];
    private _frontZ: number = 0;

    private static readonly PALETTE: Color[] = [
        new Color(140, 155, 175, 255),
        new Color(120, 135, 160, 255),
        new Color(160, 170, 185, 255),
        new Color(100, 115, 140, 255),
        new Color(150, 160, 180, 255),
        new Color(130, 145, 165, 255),
        new Color(170, 180, 195, 255),
        new Color(110, 125, 150, 255),
    ];

    start() {
        if (!this.targetCamera || !this.buildingPrefab) return;

        const camZ = this.targetCamera.position.z;
        this._frontZ = camZ - this.spawnRangeZ;

        for (let i = 0; i < this.poolSize; i++) {
            const building = instantiate(this.buildingPrefab);
            building.setParent(this.node);

            // Initialization: Create ONE material instance per building node
            const renderer = building.getComponent(MeshRenderer);
            if (renderer) {
                // This creates a unique instance and assigns it to sharedMaterial for this renderer
                renderer.getMaterialInstance(0);
            }

            this.randomizeBuilding(building, camZ - math.randomRange(0, this.spawnRangeZ));
            this._pool.push(building);
        }
    }

    update(deltaTime: number) {
        if (!this.targetCamera) return;
        const camZ = this.targetCamera.position.z;
        const behindThreshold = camZ + this.cullDistance;

        for (let i = 0; i < this._pool.length; i++) {
            const b = this._pool[i];
            if (b.position.z > behindThreshold) {
                this._frontZ -= math.randomRange(15, 35);
                this.randomizeBuilding(b, this._frontZ);
            }
        }
    }

    private randomizeBuilding(building: Node, z: number) {
        const xDist = math.randomRange(this.spawnRangeX.x, this.spawnRangeX.y);
        const x = math.random() < 0.5 ? -xDist : xDist;
        const scaleY = math.randomRange(this.buildingScaleRange.x, this.buildingScaleRange.y);
        const scaleXZ = math.randomRange(this.buildingWidthRange.x, this.buildingWidthRange.y);

        building.setPosition(x, this.spawnY, z);
        building.setScale(scaleXZ, scaleY, scaleXZ);

        // Per-instance material color with Fog/Cloud effect
        const renderer = building.getComponent(MeshRenderer);
        if (renderer) {
            // Use sharedMaterial. Since we called getMaterialInstance in start(), 
            // sharedMaterial NOW points to that unique instance for this renderer.
            // This avoids creating a NEW instance every time we randomize.
            const mat = renderer.sharedMaterial;
            if (mat) {
                // 1. Enable Transparency (Blend)
                const pass = mat.passes[0];
                if (pass) {
                    // CAUTION: blendState modification on shared material might affect others if not instanced?
                    // But we DID instance it in start(). So it's safe.
                    const target = pass.blendState.targets[0];
                    if (!target.blend) target.blend = true;
                }

                // 2. Dynamic Alpha based on Height (scaleY)
                // Taller buildings = More visible (High Alpha)
                // Shorter buildings = Buried in clouds (Low Alpha)
                // scaleY range is approx [50, 200] defined in properties
                const hRatio = math.clamp01((scaleY - 50) / 150);
                const alpha = math.lerp(40, 160, hRatio); // Alpha range 40..160

                // 3. Set Color (Pale Blue)
                const color = new Color(180, 210, 255, alpha);

                // Try both standard property names
                mat.setProperty('mainColor', color);
                // mat.setProperty('albedo', color); // Causes warning
            }
        }
    }
}
