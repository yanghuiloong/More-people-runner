import { _decorator, Component, Node, Prefab, instantiate, math } from 'cc';
import { EnemyGroupManager } from './EnemyGroupManager';
import { CrowdManager } from './CrowdManager';
import { UIManager } from './UIManager';
import { ObstacleManager } from './ObstacleManager';
const { ccclass, property } = _decorator;

@ccclass('TrackManager')
export class TrackManager extends Component {
    public static instance: TrackManager;
    @property(Prefab)
    roadPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: 'Gate prefab for + and x' })
    positiveGatePrefab: Prefab | null = null;
    @property({ type: Prefab, tooltip: 'Gate prefab for - and /' })
    negativeGatePrefab: Prefab | null = null;

    @property(Prefab)
    enemyGroupPrefab: Prefab | null = null;

    @property(Node)
    player: Node | null = null;

    @property
    trackLength: number = 100;

    private activeTracks: Node[] = [];
    private activeObstacles: Node[] = [];

    // ================================================================
    // ========== ADDICTIVE RHYTHM SYSTEM (4-Layer Design) ==========
    // ================================================================

    /** Total distance of generated tracks */
    private _totalDistance: number = 0;
    public get totalDistance(): number { return this._totalDistance; }

    /** Consecutive addition gates without a multiplier (pity counter) */
    private _gatesSinceLastMultiplier: number = 0;
    /** Pity threshold: force a multiplier gate after this many additions */
    private readonly MULTIPLIER_PITY: number = 12;

    /** Road half-width for gate placement */
    private readonly ROAD_HALF_WIDTH: number = 4.0;

    // Anti-overlap
    // Replaced by Global Registry (occupiedRanges)


    /** Last Z coordinate where a gate was spawned (prevents double-spawning) */
    private _lastGateSpawnZ: number = 9999;
    /** Minimum Z distance between successive gate spawns */
    private readonly MIN_GATE_Z_GAP: number = 20;

    /** Track Z of the last spawned Charge (Aggression 2) enemy group */
    private _lastChargeEnemyZ: number = 9999;

    start() {
        TrackManager.instance = this;
        TrackManager.occupiedRanges = []; // Reset global registry on restart

        // POOLING: Create 5 segments (enough to cover view + buffer)
        for (let i = 0; i < 5; i++) {
            const trackZ = -i * this.trackLength;
            this.spawnTrack(trackZ);
        }
    }

    public notifyGateSpawn(z: number) {
        this._lastGateSpawnZ = z;
    }

    // Speed Control
    private _baseSpeed: number = 8.0;
    public get speedMultiplier(): number { return this._speedMultiplier; }
    private _speedMultiplier: number = 1.0;
    private _boostTimer: number = 0;

    /**
     * Boost speed for a duration.
     * @param multiplier e.g. 1.5 for 50% faster
     * @param duration seconds
     */
    public boostSpeed(multiplier: number, duration: number) {
        this._speedMultiplier = multiplier;
        this._boostTimer = duration;
    }

    update(deltaTime: number) {
        if (!UIManager.isPlaying) return;
        if (!this.player || this.activeTracks.length === 0) return;

        // Dynamic Speed Logic
        if (this._boostTimer > 0) {
            this._boostTimer -= deltaTime;
            if (this._boostTimer <= 0) {
                this._speedMultiplier = 1.0; // Reset
            }
        }

        // Track is spawned relative to player position
        // Current implementation: Player moves negative Z. TrackManager checks player Z.
        const playerZ = this.player.position.z;
        this._totalDistance = Math.abs(playerZ);

        // RECYCLING LOGIC:
        // Detect if the "rear" track (closest to positive Z, index 0) is out of view.
        // Array is sorted by Z descending (0 -> -100 -> -200 -> -300 -> -400)
        // Wait, current logic:
        // spawnTrack pushes to array. So index 0 is Z=0, index 1 is Z=-100...
        // Player moves to -Z.
        // "Rear" track (behind player) is index 0.
        // Buffer: 120m behind player.

        const firstTrack = this.activeTracks[0];
        // Player at -150. Track 0 at 0. Distance 150.
        // Condition: playerZ < firstTrack.position.z - 120
        // -150 < 0 - 120 (-120). True.

        if (playerZ < firstTrack.position.z - 120) {
            this.recycleTrack();
        }

        // Recycle expired obstacles (still needed as obstacles don't move with track parent locally)
        // Cleanup: 30m behind player (matches enemy culling + margin)
        for (let i = this.activeObstacles.length - 1; i >= 0; i--) {
            const obstacle = this.activeObstacles[i];
            if (!obstacle || !obstacle.isValid) {
                this.activeObstacles.splice(i, 1);
                continue;
            }
            if (playerZ < obstacle.position.z - 30) {
                obstacle.destroy();
                this.activeObstacles.splice(i, 1);
            }
        }

        // Clean up global spawn registry
        this.cleanOccupiedRanges(playerZ);
    }

    private recycleTrack() {
        const track = this.activeTracks.shift(); // Remove from head (Oldest, behind player)
        if (!track) return;

        const lastTrack = this.activeTracks[this.activeTracks.length - 1]; // Current front-most
        const newZ = lastTrack.position.z - this.trackLength;

        // Move track
        track.setPosition(0, 0, newZ);

        // Add to tail
        this.activeTracks.push(track);

        // Spawn Contents
        // We need to clean old contents? 
        // Obstacles are children of TrackManager (this.node), NOT the track segment.
        // So moving the track segment just moves the road mesh.
        // Obstacles are handled separately by activeObstacles list and culling in update().
        // So we just spawn NEW contents at newZ.
        this.spawnContents(newZ);
    }

    // ========== Helpers ==========

    private getPlayerCount(): number {
        if (!this.player) return 0;
        const cm = this.player.getComponent(CrowdManager);
        if (!cm) return 0;
        return cm.currentCount;
    }



    /** Get a fixed X position for gate placement (strict lane coordinates) */
    private randomGateX(): number {
        // Fixed lane positions — never center, consistent visual alignment
        // Aligned with ObstacleManager's fence gates (±3.8)
        return math.random() < 0.5 ? -3.8 : 3.8;
    }

    // ========== Track Spawning ==========

    private spawnTrack(zPosition: number) {
        if (!this.roadPrefab) {
            console.error('TrackManager: roadPrefab 未设置');
            return;
        }

        const track = instantiate(this.roadPrefab);
        track.setPosition(0, 0, zPosition);
        track.setParent(this.node);
        this.activeTracks.push(track);
        this._totalDistance += this.trackLength;

        // First 50m: road only
        if (zPosition > -50) return;

        this.spawnContents(zPosition);
    }

    // ================================================================
    //  Layer 1: Distance-driven difficulty config (Addictive Rhythm Design)
    // ================================================================

    // ================================================================
    //  Dynamic Flow Control (State Machine)
    // ================================================================

    public getFlowState(): 'RECOVERY' | 'CHALLENGE' | 'GRINDER' {
        const count = this.getPlayerCount();
        if (count < 30) return 'RECOVERY';
        if (count < 200) return 'CHALLENGE';
        return 'GRINDER';
    }

    // ================================================================
    //  Gate Probability & Mystery Logic
    // ================================================================

    private rollGateValue(): { type: string; value: number } {
        const count = this.getPlayerCount();
        const r = math.random();

        // Phase 4: Absolute Suppression (300+)
        if (count >= 300) {
            // 50% High Subtraction, 50% Division
            if (r < 0.50) return { type: '-', value: math.randomRangeInt(50, 100) };
            return { type: '/', value: math.randomRangeInt(2, 3) };
        }

        // Phase 3: Hard Cap (200-299)
        if (count >= 200) {
            // x: 0%, +: 10%, -: 50%, /: 40%
            if (r < 0.10) return { type: '+', value: math.randomRangeInt(5, 10) };
            if (r < 0.60) return { type: '-', value: math.randomRangeInt(20, 50) };
            return { type: '/', value: 2 };
        }

        // Phase 2: Soft Cap (100-199)
        if (count >= 100) {
            // x: 10% (max 2), +: 40%, -: 30%, /: 20%
            if (r < 0.10) return { type: 'x', value: 2 };
            if (r < 0.50) return { type: '+', value: math.randomRangeInt(10, 30) };
            if (r < 0.80) return { type: '-', value: math.randomRangeInt(10, 30) };
            return { type: '/', value: 2 };
        }

        // Phase 1: Normal Growth (0-99)
        // MYSTERY GATE: 5% chance (Only in early phases to avoid unfairness later? Or keep it?)
        // User didn't ban mystery, but let's keep it fun. 
        if (r < 0.05) {
            return { type: '?', value: 0 };
        }

        const state = this.getFlowState(); // Still use state for early game nuances or just simplify?
        // Let's stick to the Phase 1 logic requested: "Keep status quo"

        if (state === 'RECOVERY') {
            // 100% Positive
            if (r < 0.20) return { type: 'x', value: 2 };
            return { type: '+', value: math.randomRangeInt(10, 50) };
        }
        else { // Challenge/Grinder logic for <100 (which is mostly Challenge start)
            // 50% Positive, 40% Negative, 10% Trap
            if (r < 0.50) return { type: '+', value: math.randomRangeInt(10, 30) };
            if (r < 0.90) return { type: '-', value: math.randomRangeInt(10, 40) };
            return { type: '-', value: math.randomRangeInt(50, 80) };
        }
    }

    // ================================================================
    //  Content Spawning (State-Driven)
    // ================================================================

    private spawnContents(baseZ: number) {
        const state = this.getFlowState();
        const pityTriggered = this._gatesSinceLastMultiplier >= this.MULTIPLIER_PITY;

        // Config per state
        let gateProb = 0.5;
        let waveCount = 1;
        let enemyAggression = 0; // 0:Low, 1:Med, 2:High

        if (state === 'RECOVERY') {
            gateProb = 0.90; // Mostly gates to heal
            waveCount = 1;   // Minimal obstacles
            enemyAggression = 0; // Static
        }
        else if (state === 'CHALLENGE') {
            gateProb = 0.50; // Balanced
            waveCount = math.randomRangeInt(2, 3);
            enemyAggression = 1; // Patrol
        }
        else { // GRINDER
            gateProb = 0.30; // Mostly enemies to kill
            enemyAggression = 2; // Charge
        }

        // --- Charge Cooldown Logic ---
        // Prevents back-to-back charge waves in Grinder mode (unfair difficulty)
        const CHARGE_COOLDOWN_Z = 80; // Min distance between charge groups
        if (enemyAggression === 2) {
            // Check last charge position
            // Note: waveZ is negative (e.g. -200, -250). Smaller is "further".
            // Distance is abs(waveZ - lastZ).
            if (Math.abs(baseZ - this._lastChargeEnemyZ) < CHARGE_COOLDOWN_Z) {
                // Too soon! Downgrade to Patrol
                enemyAggression = 1;
                // console.log(`Charge Downgraded at ${baseZ} (Cooldown active)`);
            } else {
                // Allowed. Record position.
                this._lastChargeEnemyZ = baseZ;
            }
        }

        // Pity Override
        if (pityTriggered) gateProb = 1.0;

        for (let wave = 0; wave < waveCount; wave++) {
            const waveZOffset = math.randomRangeInt(40, 55) * wave;
            const waveZ = baseZ + waveZOffset;
            const r = math.random();

            // Spawn GATE
            if (r < gateProb) {
                if (Math.abs(waveZ - this._lastGateSpawnZ) >= this.MIN_GATE_Z_GAP) {
                    if (TrackManager.tryOccupy(waveZ - 2, waveZ + 2)) {
                        const gx = this.randomGateX();

                        // Force Multiplier if Pity
                        let gv = this.rollGateValue();
                        if (pityTriggered) gv = { type: 'x', value: 2 };

                        this.spawnGateWithValues(gx, waveZ, gv.type, gv.value);
                        this._lastGateSpawnZ = waveZ;

                        if (gv.type === '+') this._gatesSinceLastMultiplier++;
                        else this._gatesSinceLastMultiplier = 0;
                    }
                }
            }
            // Spawn ENEMY
            else {
                // Enemy Count Logic
                let enemyCount = 10;
                const playerCount = this.getPlayerCount();

                if (state === 'RECOVERY') {
                    enemyCount = 5; // Tiny annoyance
                } else if (state === 'CHALLENGE') {
                    // 0.4 ratio
                    enemyCount = Math.floor(playerCount * 0.4);
                } else { // GRINDER
                    // 0.6 ratio (as per previous agreement)
                    enemyCount = Math.floor(playerCount * 0.6);
                }

                enemyCount = Math.max(5, Math.min(enemyCount, 300)); // Clamp

                this.spawnEnemyGroup(0, waveZ, enemyCount, false, enemyAggression);
            }
        }
    }

    // ================================================================
    //  Gate Spawning
    // ================================================================

    private spawnGateWithValues(x: number, z: number, gateType: string, gateValue: number) {
        // User Correction: "Division gate uses Subtraction gate's asset"
        let prefab = this.positiveGatePrefab;
        if (gateType === '-' || gateType === '/') prefab = this.negativeGatePrefab;
        else if (gateType === '?') {
            // Use Gold/Mystery Prefab from ObstacleManager
            if (ObstacleManager.instance && ObstacleManager.instance.goldGatePrefab) {
                prefab = ObstacleManager.instance.goldGatePrefab;
            } else {
                prefab = this.positiveGatePrefab; // Fallback
            }
        }

        if (!prefab) return;

        const gate = instantiate(prefab);
        gate.setParent(this.node);
        gate.setPosition(x, 0, z);
        this.activeObstacles.push(gate);

        // Increment Global Gate Count
        ObstacleManager.globalGateCount++;

        const multiplierGate = gate.getChildByName('MultiplierGate');
        if (multiplierGate) {
            const gateCtrl = multiplierGate.getComponent('GateController');
            if (gateCtrl) {
                (gateCtrl as any).setMathLogic(gateType, gateValue);

                // ================================================================
                //  Dynamic Movement Logic (High Value Gates)
                // ================================================================
                // Condition 1: High Value Thresholds (Moving Gates)
                // User Request: All 'x'/'/' and High '+/-' gates should move.
                const isHighValue = (gateType === '+' && gateValue >= 20) ||
                    (gateType === '-' && gateValue >= 20) ||
                    (gateType === 'x') ||
                    (gateType === '/') ||
                    (gateType === '?');

                // Condition 2: MUST be a "Single Independent Gate"
                // TrackManager.spawnContents only calls this for single gates.
                // Dual gates are spawned by ObstacleManager.spawnDecisionGates, which calls spawnSingleGate directly 
                // (NOT this method if logic is separate, or calls this? Let's check).
                // Actually TrackManager.spawnGateWithValues is PRIVATE and only called by spawnContents (Line 273/310).
                // ObstacleManager calls its own spawnSingleGate.
                // So ANY gate spawned here is a candidate for movement!

                if (isHighValue) {
                    // FORCE CENTER SPAWN
                    gate.setPosition(0, 0, z);

                    // Enable Movement
                    (gateCtrl as any).isMoving = true;
                    (gateCtrl as any).moveSpeed = math.randomRange(2.5, 3.0); // Slight variance
                }
            }
        }
    }

    // ================================================================
    // ========== GLOBAL SPAWN REGISTRY (Anti-Overlap) ==========
    // ================================================================

    private static occupiedRanges: { start: number; end: number }[] = [];

    /**
     * Try to book a Z-range for spawning.
     * Returns true if successful (no overlap), false if blocked.
     */
    public static tryOccupy(zStart: number, zEnd: number): boolean {
        // Normalize input (start < end)
        const s = Math.min(zStart, zEnd);
        const e = Math.max(zStart, zEnd);

        // Check overlap with existing ranges
        for (const r of TrackManager.occupiedRanges) {
            // Overlap condition: (StartA <= EndB) and (EndA >= StartB)
            if (s <= r.end && e >= r.start) {
                return false; // Overlap detected!
            }
        }

        // No overlap, book it
        TrackManager.occupiedRanges.push({ start: s, end: e });
        return true;
    }

    private cleanOccupiedRanges(playerZ: number) {
        // Remove ranges that are far behind the player (e.g. > 30m behind)
        // Player moves forward (negative Z), so "behind" is Z > playerZ + 30
        const threshold = playerZ + 30;
        for (let i = TrackManager.occupiedRanges.length - 1; i >= 0; i--) {
            if (TrackManager.occupiedRanges[i].end > threshold) {
                TrackManager.occupiedRanges.splice(i, 1);
            }
        }
    }

    // ================================================================
    //  Enemy Spawning (always full-road, single centered group)
    // ================================================================

    /**
     * Spawn a single enemy group centered at X.
     * The EnemyGroupManager's formation algorithm handles
     * spreading enemies across the full road width.
     * @param force If true, bypasses global overlap check (used for Fence Ambushes)
     * @param aggression 0:Static, 1:Patrol, 2:Charge
     */
    public spawnEnemyGroup(x: number, z: number, count: number, force: boolean = false, aggression: number = 0) {
        if (!this.enemyGroupPrefab) return;

        // Global Registry Check
        // Enemy Group: occupy [z-5, z+10] (User Config: 5m before, 10m after)
        // Center is z. Queue ~5m.
        if (!force && !TrackManager.tryOccupy(z - 5, z + 10)) {
            // Overlap detected, skip spawning
            return;
        }

        const enemyGroup = instantiate(this.enemyGroupPrefab);
        enemyGroup.setParent(this.node);
        enemyGroup.setPosition(x, 0, z);
        this.activeObstacles.push(enemyGroup);

        const mgr = enemyGroup.getComponent(EnemyGroupManager);
        if (mgr) {
            mgr.initEnemyGroup(count, aggression);
        }
    }
}