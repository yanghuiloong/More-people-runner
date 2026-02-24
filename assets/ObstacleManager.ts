import { _decorator, Component, Node, Prefab, instantiate, math, director } from 'cc';
import { UIManager } from './UIManager';
import { TrackManager } from './TrackManager';
const { ccclass, property } = _decorator;

interface FenceSlot {
    node: Node;
    minZ: number;
    maxZ: number; // The exit point (less negative than minZ if facing forward? No, player moves -Z)
    // Coords: Player moves -Z. 
    // Spawn at -100. MinZ = -110, MaxZ = -90?
    // Fence length 20. Center -100.
    // Let's rely on standard Z.
    active: boolean;
    boostTriggered: boolean; // New flag
}

@ccclass('ObstacleManager')
export class ObstacleManager extends Component {

    private static _instance: ObstacleManager | null = null;
    public static get instance(): ObstacleManager | null { return ObstacleManager._instance; }

    @property({ type: Node }) targetCamera: Node | null = null;
    @property({ type: Prefab }) fencePrefab: Prefab | null = null;
    @property({ type: Prefab, tooltip: 'Gate prefab for + and x' })
    positiveGatePrefab: Prefab | null = null;
    @property({ type: Prefab, tooltip: 'Gate prefab for - and /' })
    negativeGatePrefab: Prefab | null = null;
    @property({ type: Prefab, tooltip: 'Mystery/Gold gate prefab' })
    goldGatePrefab: Prefab | null = null;
    @property({ tooltip: 'Z distance between spawn attempts' })
    spawnIntervalZ: number = 60;
    @property({ tooltip: 'Fence Z-axis length' })
    fenceLength: number = 20;
    @property({ tooltip: 'Fence X half-width (virtual wall thickness)' })
    fenceHalfWidth: number = 0.5;
    @property({ tooltip: 'How far ahead to spawn fences' })
    spawnAheadZ: number = 300;
    @property({ tooltip: 'Probability [0-1] of spawning a fence at each interval' })
    spawnChance: number = 0.5;
    @property({ tooltip: 'Distance behind camera to cull' })
    cullBehind: number = 30;
    @property poolSize: number = 15;

    private _pool: FenceSlot[] = [];
    private _gateNodes: Node[] = []; // Track spawned gate nodes for cleanup
    private _nextSpawnZ: number = 0;



    // ========== Gate Counting (First 10 Positive) ==========
    public static globalGateCount: number = 0;

    // ========== Public static API ==========

    /** Returns the fence half-width (for repulsion calculations) */
    public static get halfWidth(): number {
        return ObstacleManager._instance ? ObstacleManager._instance.fenceHalfWidth : 0.5;
    }

    /** Check if a given Z coordinate is inside any active fence's Z-range */
    public static isInsideFence(z: number): boolean {
        if (!ObstacleManager._instance) return false;
        const pool = ObstacleManager._instance._pool;
        for (let i = 0; i < pool.length; i++) {
            const f = pool[i];
            if (f.active && z >= f.minZ && z <= f.maxZ) return true;
        }
        return false;
    }

    /** Get fence Z-range at a given Z, returns null if not inside any fence */
    public static getFenceRange(z: number): { minZ: number; maxZ: number } | null {
        if (!ObstacleManager._instance) return null;
        const pool = ObstacleManager._instance._pool;
        for (let i = 0; i < pool.length; i++) {
            const f = pool[i];
            if (f.active && z >= f.minZ && z <= f.maxZ) return { minZ: f.minZ, maxZ: f.maxZ };
        }
        return null;
    }

    /** Check if a Z-axis range [rangeMin, rangeMax] overlaps ANY active fence.
     *  Uses the full physical extent of each fence (fenceLength/2 + safety margin). */
    public static isRangeOverlappingFence(rangeMin: number, rangeMax: number): boolean {
        if (!ObstacleManager._instance) return false;
        const pool = ObstacleManager._instance._pool;
        const margin = 6; // Large safety buffer to prevent spawning near fences
        for (let i = 0; i < pool.length; i++) {
            const f = pool[i];
            if (!f.active) continue;
            // Fence physical extent: [minZ - margin, maxZ + margin]
            const fMin = f.minZ - margin;
            const fMax = f.maxZ + margin;
            if (rangeMin <= fMax && rangeMax >= fMin) return true;
        }
        return false;
    }

    /**
     * Get fence half-width at a given Z coordinate (considering node scale).
     * Returns the real-world X half-width if z is inside an active fence,
     * or null if no fence exists at that Z.
     */
    public static getFenceXLimit(z: number): number | null {
        if (!ObstacleManager._instance) return null;
        const inst = ObstacleManager._instance;
        const pool = inst._pool;
        for (let i = 0; i < pool.length; i++) {
            const f = pool[i];
            if (f.active && z >= f.minZ && z <= f.maxZ) {
                // Account for node X scale to get real-world half-width
                return inst.fenceHalfWidth * f.node.scale.x;
            }
        }
        return null;
    }

    /**
     * Get the forbidden half-width at a given Z coordinate.
     * Returns 0 if no fence is present at that Z.
     * Includes 0.2 safety buffer and accounts for node X scale.
     */
    public static getFenceForbiddenWidth(z: number): number {
        if (!ObstacleManager._instance) return 0;
        const inst = ObstacleManager._instance;
        const pool = inst._pool;
        for (let i = 0; i < pool.length; i++) {
            const f = pool[i];
            if (f.active && z >= f.minZ && z <= f.maxZ) {
                return inst.fenceHalfWidth * f.node.scale.x + 0.2;
            }
        }
        return 0;
    }

    /**
     * Clear all fences in a specific Z range (e.g. for Track Recycling cleanup).
     */
    public clearRange(minZ: number, maxZ: number) {
        // Normalize
        const start = Math.min(minZ, maxZ);
        const end = Math.max(minZ, maxZ);

        for (let i = 0; i < this._pool.length; i++) {
            const f = this._pool[i];
            if (f.active) {
                // If fence is within range (even partially?)
                // Strict check: if fence center is in range?
                // Or overlap?
                // For recycling, we want to clear EVERYTHING that might have been left over at the new Z position?
                // No, the new Z position is deep negative (new territory). There should be nothing there.
                // UNLESS the map looped?
                // If Player moves -Z forever, we never loop coordinate-wise.
                // We just keep going -1000, -2000...
                // So there are no "old obstacles" at -2000.
                // So we actually don't need to clear "target" area.
                // But we might need to forced-clean "behind" area if culling missed it?
                // Culling handles it.

                // User requested: "Ensure old track's obstacles ... are cleared".
                // Our obstacles are in `activeObstacles` in TrackManager, and `_pool` in ObstacleManager.
                // TrackManager culls activeObstacles behind player.
                // ObstacleManager culls fences behind camera.
                // So automatic culling should suffice.
                // But let's add this utility just in case.

                if (f.minZ > start && f.maxZ < end) {
                    f.active = false;
                    f.node.active = false;
                }
            }
        }
    }

    onLoad() {
        ObstacleManager._instance = this;
        ObstacleManager.globalGateCount = 0; // Essential for Restart Logic
    }
    onDestroy() { if (ObstacleManager._instance === this) ObstacleManager._instance = null; }

    start() {
        if (!this.targetCamera || !this.fencePrefab) return;
        // Pre-instantiate fence pool
        for (let i = 0; i < this.poolSize; i++) {
            const node = instantiate(this.fencePrefab);
            node.setParent(this.node);
            node.active = false;
            this._pool.push({ node, minZ: 0, maxZ: 0, active: false, boostTriggered: false });
        }
        // Start spawning a bit ahead of camera
        this._nextSpawnZ = this.targetCamera.position.z - 80;
    }

    update(dt: number) {
        if (!UIManager.isPlaying || !this.targetCamera) return;

        const camZ = this.targetCamera.position.z;
        const frontLimit = camZ - this.spawnAheadZ; // Negative Z = forward

        // Check for Speed Boost Triggers
        const playerZ = TrackManager.instance && TrackManager.instance.player
            ? TrackManager.instance.player.position.z
            : (this.targetCamera ? this.targetCamera.position.z : 0);

        for (let i = 0; i < this._pool.length; i++) {
            const f = this._pool[i];
            if (f.active && !f.boostTriggered) {
                // If player is within 40m of the fence start
                // Fence is at Z (center). Player moves -Z.
                // Fence Z = -100. Player Z = -50. Dist = 50.
                // When Player Z is close to Fence Z.
                // Since moving negative, playerZ > fenceZ.
                // Trigger when playerZ - f.node.position.z < 40

                // Let's use absolute distance for simplicity
                // Boost when approaching: 
                const dist = playerZ - f.node.position.z;
                // Player is usually "before" the fence (z > fence.z)
                // We want to trigger when dist is small (e.g. 40m)

                if (dist > 0 && dist < 40) {
                    f.boostTriggered = true;
                    if (TrackManager.instance) {
                        // Feature disabled per user request
                    }
                }
            }
        }

        // Spawn new fences ahead
        while (this._nextSpawnZ > frontLimit) {
            if (math.random() < this.spawnChance) {
                this.activateFence(this._nextSpawnZ);
            }
            this._nextSpawnZ -= this.spawnIntervalZ;
        }

        // Cull fences behind camera
        const cullThreshold = camZ + this.cullBehind;
        for (let i = 0; i < this._pool.length; i++) {
            const f = this._pool[i];
            if (f.active && f.maxZ > cullThreshold) {
                f.active = false;
                f.node.active = false;
            }
        }
        // Cull gate nodes behind camera
        for (let i = this._gateNodes.length - 1; i >= 0; i--) {
            const g = this._gateNodes[i];
            if (!g || !g.isValid || g.position.z > cullThreshold) {
                if (g && g.isValid) g.destroy();
                this._gateNodes.splice(i, 1);
            }
        }
    }

    private activateFence(z: number) {
        // Global Registry Check
        // Fence: 20m long. Center at z.
        // Occupy [z-10, z+30] (Wall 20m + 10m buffer = 30m total span? User said z-10 to z+30)
        // Center is z. Fence extends z-10 to z+10. 
        // User requested: "rangeStart = spawnZ - 10; rangeEnd = spawnZ + 30;" (Locks 10m before, 30m after center?)
        // Yes, ensuring 10m buffer before fence starts, and 20m buffer after fence ends.
        if (!TrackManager.tryOccupy(z - 10, z + 30)) {
            return;
        }

        // Find an inactive slot
        let slot: FenceSlot | null = null;
        for (let i = 0; i < this._pool.length; i++) {
            if (!this._pool[i].active) { slot = this._pool[i]; break; }
        }
        if (!slot) return; // Pool exhausted

        const halfLen = this.fenceLength / 2;
        slot.minZ = z - halfLen;
        slot.maxZ = z + halfLen;
        slot.active = true;
        slot.node.active = true;

        // Visual Fix: Micro-adjust Z to -0.05 (User Requet)
        slot.node.setPosition(0, 0, z - 0.05);

        // Visual Fix: Restore Dynamic Scale (Model is small, needs scaling)
        // Original logical size: 0.5m wide, 3m high, 20m long
        slot.node.setScale(0.5, 3, this.fenceLength);

        // Reset boost trigger
        slot.boostTriggered = false;

        // REMOVED PREMATURE BOOST HERE
        // It will be triggered in update() when player gets close


        // Spawn paired decision gates INSIDE the fence (offset 4 units deeper)
        // Player enters at maxZ, so subtract to go deeper into the fence
        const gateZ = z + halfLen - 4;
        this.spawnDecisionGates(gateZ);

        // Notify TrackManager to prevent overlap
        // Using any cast to avoid cyclic dependency issues if TrackManager imports ObstacleManager
        const tm = (window as any).TrackManager || director.getScene()?.getComponentInChildren('TrackManager');
        if (tm && tm.notifyGateSpawn) {
            tm.notifyGateSpawn(gateZ);
        } else {
            // Fallback: try finding by name if class ref is missing
            const node = director.getScene()?.getChildByName('TrackManager'); // Assumption
            const comp = node?.getComponent('TrackManager');
            if (comp) (comp as any).notifyGateSpawn(gateZ);
        }
    }

    /**
     * Spawn two paired gates near the fence entrance (one per lane).
     * 75% chance: one add + one subtract (clear risk/reward choice).
     * 25% chance: both subtraction (choose lesser evil).
     */
    /**
     * Spawn two paired gates inside the fence (one per lane).
     * Logic: Create meaningful choices (Dilemmas).
     */
    private spawnDecisionGates(gateZ: number) {
        if (!this.positiveGatePrefab || !this.negativeGatePrefab) return;

        const leftX = -3.8;
        const rightX = 3.8;

        let typeL = '+', valL = 10;
        let typeR = '+', valR = 10;

        const roll = math.random();
        const playerCount = TrackManager.instance ? (TrackManager.instance as any).getPlayerCount() : 0;

        // Difficulty Tiers based on Player Count
        // Phase 1: 0-99 (Growth)
        // Phase 2: 100-199 (Soft Cap - Intro Division)
        // Phase 3: 200-299 (Hard Cap - Suppression)
        // Phase 4: 300+ (Absolute Suppression)

        if (playerCount >= 300) {
            // PHASE 4: Absolute Suppression
            // 50% High Subtraction, 50% Division
            // No mercy.
            typeL = (math.random() < 0.5) ? '-' : '/';
            valL = (typeL === '-') ? math.randomRangeInt(50, 100) : math.randomRangeInt(2, 3);

            typeR = (math.random() < 0.5) ? '-' : '/';
            valR = (typeR === '-') ? math.randomRangeInt(50, 100) : math.randomRangeInt(2, 3);
        }
        else if (playerCount >= 200) {
            // PHASE 3: Hard Cap
            // x: 0%, +: 10%, -: 50%, /: 40%
            const rollChoice = (r: number) => {
                if (r < 0.10) return { t: '+', v: math.randomRangeInt(5, 10) }; // Bait
                if (r < 0.60) return { t: '-', v: math.randomRangeInt(20, 50) };
                return { t: '/', v: 2 };
            };

            const r1 = rollChoice(math.random());
            typeL = r1.t; valL = r1.v;

            const r2 = rollChoice(math.random());
            typeR = r2.t; valR = r2.v;
        }
        else if (playerCount >= 100) {
            // PHASE 2: Soft Cap
            // x: 10% (max 2), +: 40%, -: 30%, /: 20%
            const rollChoice = (r: number) => {
                if (r < 0.10) return { t: 'x', v: 2 };
                if (r < 0.50) return { t: '+', v: math.randomRangeInt(10, 30) };
                if (r < 0.80) return { t: '-', v: math.randomRangeInt(10, 30) };
                return { t: '/', v: 2 };
            };

            const r1 = rollChoice(math.random());
            typeL = r1.t; valL = r1.v;

            const r2 = rollChoice(math.random());
            typeR = r2.t; valR = r2.v;
        }
        else {
            // PHASE 1: Normal Growth (< 100)
            // Existing logic or slightly simplified High Growth
            if (math.random() < 0.04) {
                typeL = 'x'; valL = this.rollWeightedMultiplier();
                typeR = '+'; valR = this.rollWeightedAdditive(15, 30);
            } else if (math.random() < 0.66) {
                typeL = '+'; valL = this.rollWeightedAdditive(5, 15);
                typeR = '-'; valR = math.randomRangeInt(10, 30);
            } else {
                typeL = '-'; valL = math.randomRangeInt(5, 15);
                typeR = '-'; valR = math.randomRangeInt(20, 50);
            }
        }

        // SAFETY: Prevent instant loss at low count (< 20)
        // If both gates are negative, force one to be positive to ensure survival.
        if (playerCount < 20) {
            const isBadL = (typeL === '-' || typeL === '/');
            const isBadR = (typeR === '-' || typeR === '/');
            if (isBadL && isBadR) {
                // Force Left to be Positive (Pity)
                typeL = '+';
                valL = math.randomRangeInt(5, 10);
            }
        }

        // Randomize Left/Right flipping
        if (math.random() < 0.5) {
            const t = typeL; const v = valL;
            typeL = typeR; valL = valR;
            typeR = t; valR = v;
        }

        // Spawn them (or Ambush!)
        this.spawnGateOrAmbush(leftX, gateZ, typeL, valL);
        this.spawnGateOrAmbush(rightX, gateZ, typeR, valR);
    }

    /**
     * Spawns a gate, OR if it's a negative gate, potentially spawns an Enemy Group (Ambush).
     */
    private spawnGateOrAmbush(x: number, z: number, type: string, value: number) {
        // AMBUSH LOGIC:
        // If type is '-', 30% chance to replace with Enemy Group
        if (type === '-') {
            if (math.random() < 0.3) {
                // Spawn Enemy Group instead!
                // Count = Value (1:1 ratio, 20 value = 20 enemies)
                if (TrackManager.instance) {
                    TrackManager.instance.spawnEnemyGroup(x, z, value, true);
                    return; // Skip gate spawn
                }
            }
        }

        // Normal Gate Spawn
        this.spawnSingleGate(x, z, type, value);
    }

    private rollWeightedAdditive(min: number, max: number): number {
        const r = math.random();
        const range = max - min;
        if (r < 0.60) return math.randomRangeInt(min, min + Math.floor(range * 0.33));
        if (r < 0.90) return math.randomRangeInt(min + Math.floor(range * 0.33) + 1, min + Math.floor(range * 0.66));
        return math.randomRangeInt(min + Math.floor(range * 0.66) + 1, max);
    }

    private rollWeightedMultiplier(): number {
        const r = math.random();
        if (r < 0.70) return 2;
        if (r < 0.90) return 3;
        if (r < 0.98) return 4;
        return 5;
    }

    private spawnSingleGate(x: number, z: number, gateType: string, gateValue: number) {
        // User Correction: "Division gate uses Subtraction gate's asset"
        // '-' and '/' use negativeGatePrefab.
        const prefab = (gateType === '-' || gateType === '/') ? this.negativeGatePrefab : this.positiveGatePrefab;
        if (!prefab) return;
        const gate = instantiate(prefab);
        gate.setParent(this.node);
        gate.setPosition(x, 0, z);
        this._gateNodes.push(gate);

        // Increment Global Count
        ObstacleManager.globalGateCount++;

        // Configure the gate via GateController
        const multiplierGate = gate.getChildByName('MultiplierGate');
        if (multiplierGate) {
            const gateCtrl = multiplierGate.getComponent('GateController');
            if (gateCtrl) {
                (gateCtrl as any).setMathLogic(gateType, gateValue);
            }
        }
    }
}

