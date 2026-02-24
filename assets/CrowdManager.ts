import { _decorator, Component, Node, Prefab, instantiate, math, Label, Vec3, director, RigidBody, Quat, tween, SkinnedMeshRenderer } from 'cc';
import { AudioManager } from './AudioManager';
import { UIManager } from './UIManager';
import { ObstacleManager } from './ObstacleManager';
const { ccclass, property } = _decorator;

// ================================================================
//  Spatial Hash Grid (Zero-GC Optimized)
// ================================================================

class SpatialHashGrid {
    private cellSize: number;
    private inverseCellSize: number;

    // Flat Array Linked List
    // head[cellKey] -> first particle index
    // next[particleIndex] -> next particle index in same cell
    private static readonly TABLE_SIZE = 10007; // Prime number for hashing
    private head: Int32Array;
    private next: Int32Array;

    constructor(cellSize: number, capacity: number) {
        this.cellSize = cellSize;
        this.inverseCellSize = 1.0 / cellSize;
        this.head = new Int32Array(SpatialHashGrid.TABLE_SIZE);
        this.next = new Int32Array(capacity);
        this.clear();
    }

    resize(capacity: number) {
        if (capacity > this.next.length) {
            this.next = new Int32Array(capacity);
        }
    }

    clear() {
        this.head.fill(-1);
        // next array doesn't need clearing, just overwritten on insert
    }

    private hash(x: number, z: number): number {
        // Simple hash: (x * 73856093 ^ z * 19349663) % TABLE_SIZE
        // Handle negative coordinates correctly
        const cx = Math.floor(x * this.inverseCellSize);
        const cz = Math.floor(z * this.inverseCellSize);

        let h = ((cx * 73856093) ^ (cz * 19349663)) % SpatialHashGrid.TABLE_SIZE;
        if (h < 0) h += SpatialHashGrid.TABLE_SIZE;
        return h;
    }

    insert(index: number, x: number, z: number) {
        if (index >= this.next.length) return; // Safety check
        const key = this.hash(x, z);
        this.next[index] = this.head[key];
        this.head[key] = index;
    }

    // Since we can't return an array (GC), we adhere to a callback pattern or iterator
    // But for Boids, we usually iterate neighbors to sum forces.
    // Let's provide a way to iterate neighbors without allocating result array.
    // However, the original code used queryNeighbors() -> number[].
    // To match that signature without allocating, we'd need a reusable array.
    // Better: Provide `queryNeighbors(x, z, resultsBuffer)` 

    public queryNeighbors(x: number, z: number, results: number[]): number {
        const cx = Math.floor(x * this.inverseCellSize);
        const cz = Math.floor(z * this.inverseCellSize);
        let count = 0;

        // 3x3 neighbor cells
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                // Re-calculate hash for neighbor cell
                // We must use the exact same hash logic as insert
                const ncx = cx + dx;
                const ncz = cz + dz;
                let h = ((ncx * 73856093) ^ (ncz * 19349663)) % SpatialHashGrid.TABLE_SIZE;
                if (h < 0) h += SpatialHashGrid.TABLE_SIZE;

                let idx = this.head[h];
                while (idx !== -1) {
                    results[count++] = idx;
                    idx = this.next[idx];
                }
            }
        }
        return count;
    }
}

// ================================================================
//  CrowdManager
// ================================================================

@ccclass('CrowdManager')
export class CrowdManager extends Component {
    @property(Prefab) clonePrefab: Prefab | null = null;
    @property({ type: Label }) countLabel: Label | null = null;

    @property({ type: Prefab }) greenSplatterPrefab: Prefab | null = null;
    @property({ type: Prefab }) redSplatterPrefab: Prefab | null = null;

    @property separationWeight: number = 15.0;
    @property cohesionWeight: number = 1.0;
    public static instance: CrowdManager | null = null;

    // Optimized Physics Arrays (Float32Array for performance)
    private _posX: Float32Array = new Float32Array(0);
    private _posZ: Float32Array = new Float32Array(0);
    private _velX: Float32Array = new Float32Array(0);
    private _velZ: Float32Array = new Float32Array(0);

    // Logic Throttling State
    private _logicTimer: number = 0;
    private readonly LOGIC_INTERVAL: number = 0.05; // 20Hz

    // Capacity Tracking
    private _arrayCapacity: number = 0;

    @property separationRadius: number = 0.7;
    @property maxSpeed: number = 10.0;
    private readonly roadHalfWidth: number = 7.0;

    @property
    public moveSpeed: number = 8;
    private _baseMoveSpeed: number = 20; // Player default is 20

    public setSpeedScale(scale: number) {
        // Sync with PlayerController
        const playerCtrl = this.node.getComponent('PlayerController') as any;
        if (playerCtrl) {
            // If PlayerController has setBattleMode/speedFactor, usage depends.
            // The user wants "Combat Impact Slow-down". 
            // We can directly modify PlayerController's moveSpeed or a scale factor.
            // Let's assume PlayerController has a way to scale speed. 
            // Based on previous files, PlayerController uses moveSpeed * _currentSpeedFactor.
            // We can overwrite moveSpeed or add a method.
            // Simpler: Just update PlayerController.moveSpeed
            playerCtrl.moveSpeed = this._baseMoveSpeed * scale;
        }
        this.moveSpeed = this._baseMoveSpeed * scale;
    }

    public removeMember(target: Component | Node) {
        let node = target instanceof Component ? target.node : target;
        this.tryKillUnit(node);
    }

    @property
    public modelRotationY: number = 0;

    // ========== Internal State ==========
    public get currentCount(): number {
        return (this._clones ? this._clones.length : 0) + 1;
    }

    private _maxCrowdCount: number = 0;
    public get maxCrowdCount(): number { return this._maxCrowdCount; }

    private _clones: Node[] = [];
    public get rawClones(): Node[] { return this._clones; }
    public isGameOver: boolean = false;
    private readonly MAX_CROWD_SIZE: number = 5000;

    private readonly DAMPING: number = 0.90;
    private readonly BOUNDARY_FORCE: number = 15.0;
    private _grid: SpatialHashGrid = new SpatialHashGrid(1.0, 500);

    // Optimization: Buffer for neighbor queries
    private _neighborBuffer: number[] = new Array(200);

    // Amortized Spawning State
    private _pendingClonesToAdd: number = 0;
    private readonly UNITS_PER_FRAME: number = 8;

    // ========== Object Pooling ==========
    private _clonePool: Node[] = [];
    private _effectPool: Map<string, Node[]> = new Map();

    onLoad() {
        CrowdManager.instance = this;
        this._clones = [];
        this._maxCrowdCount = 1;
    }

    start() {
        this.isGameOver = false;
        this._pendingClonesToAdd = 0; // Fix: Reset pending clones on restart
        director.resume();
        director.getScheduler().setTimeScale(1);

        // Programmatic fallback for label
        if (!this.countLabel || !this.countLabel.isValid) {
            for (let i = 0; i < this.node.children.length; i++) {
                const child = this.node.children[i];
                const lbl = child.getComponent(Label);
                if (lbl) { this.countLabel = lbl; break; }
            }
        }

        // PRE-ALLOCATE POOL (300 nodes) as requested
        if (this.clonePrefab) {
            const preAllocCount = 300;
            for (let i = 0; i < preAllocCount; i++) {
                const node = instantiate(this.clonePrefab);
                node.active = false;
                node.setParent(this.node); // Keep in scene but inactive

                // Ensure baked animation is ON for pool items
                const skims = node.getComponentsInChildren(SkinnedMeshRenderer);
                skims.forEach(s => s.setUseBakedAnimation(true));

                this._clonePool.push(node);
            }
            console.log(`CrowdManager: Pre-allocated ${preAllocCount} clones.`);
        }

        this.updateLabel();
    }

    onDestroy() {
        this.unscheduleAllCallbacks();
        if (CrowdManager.instance === this) CrowdManager.instance = null;
    }

    update(deltaTime: number) {
        if (!UIManager.isPlaying) return;
        if (this.isGameOver) return;

        const count = this._clones.length;
        if (count === 0) return;

        // 1. LOGIC UPDATE (20Hz) - Boids Forces
        this._logicTimer += deltaTime;
        if (this._logicTimer >= this.LOGIC_INTERVAL) {
            // Fixed timestep for logic stability
            this.updateBoidsLogic(this.LOGIC_INTERVAL);
            this._logicTimer = 0; // Reset (simple approach to avoid spiral)
        }

        // 2. PHYSICS UPDATE (60Hz) - Movement & Clamping
        this.updatePhysics(deltaTime);
    }

    private updateBoidsLogic(dt: number) {
        const count = this._clones.length;

        // Ensure arrays capacity
        this.ensureCapacity(count);

        // 1. Sync Positions and Build Grid
        this._grid.resize(count);
        this._grid.clear();
        for (let i = 0; i < count; i++) {
            const clone = this._clones[i];
            // Use cached positions from physics update? 
            // Better to sync from actual node position or keep internal state as truth?
            // Let's rely on internal state _posX/_posZ as truth for Boids, 
            // but we must sync them from Node if external forces (physics engine) moved them?
            // We use Kinematic movement, so _posX IS the truth.

            // Just ensure grid is built from current internal state
            this._grid.insert(i, this._posX[i], this._posZ[i]);
        }

        const sepRadius = this.separationRadius;
        const sepRadiusSq = sepRadius * sepRadius;
        const sepWeight = this.separationWeight;
        const cohWeight = this.cohesionWeight;
        const damp = this.DAMPING;
        const maxSpd = this.maxSpeed;
        const maxSpdSq = maxSpd * maxSpd;
        const boundaryHalf = this.roadHalfWidth;
        const boundaryForce = this.BOUNDARY_FORCE;
        const neighborCountBuffer = this._neighborBuffer;

        // 2. Calculate Forces
        for (let i = 0; i < count; i++) {
            const px = this._posX[i];
            const pz = this._posZ[i];
            let vx = this._velX[i];
            let vz = this._velZ[i];

            // Cohesion
            vx += (-px * cohWeight) * dt;
            vz += (-pz * cohWeight) * dt;

            // Separation
            const foundCount = this._grid.queryNeighbors(px, pz, neighborCountBuffer);
            let sepFx = 0, sepFz = 0;

            for (let n = 0; n < foundCount; n++) {
                const j = neighborCountBuffer[n];
                if (j === i) continue;
                const dx = px - this._posX[j];
                const dz = pz - this._posZ[j];
                const distSq = dx * dx + dz * dz;
                if (distSq < sepRadiusSq && distSq > 0.0001) {
                    const dist = Math.sqrt(distSq);
                    const strength = (sepRadius - dist) / dist; // Simplified linear separation
                    sepFx += dx * strength;
                    sepFz += dz * strength;
                }
            }
            vx += sepFx * sepWeight * dt;
            vz += sepFz * sepWeight * dt;

            // Boundary
            if (px > boundaryHalf) vx -= (px - boundaryHalf) * boundaryForce * dt;
            else if (px < -boundaryHalf) vx -= (px + boundaryHalf) * boundaryForce * dt;

            // Damping
            vx *= damp;
            vz *= damp;

            // Clamp Speed
            const spdSq = vx * vx + vz * vz;
            if (spdSq > maxSpdSq) {
                const scale = maxSpd / Math.sqrt(spdSq);
                vx *= scale;
                vz *= scale;
            }

            this._velX[i] = vx;
            this._velZ[i] = vz;
        }
    }

    private updatePhysics(dt: number) {
        const count = this._clones.length;
        const playerPos = this.node.position;
        const roadHW = this.roadHalfWidth;

        for (let i = 0; i < count; i++) {
            const clone = this._clones[i];
            if (!clone || !clone.isValid) continue;

            // Integrate Position (Euler)
            // Use velocity from Logic Step
            let nextX = this._posX[i] + this._velX[i] * dt;
            const nextZ = this._posZ[i] + this._velZ[i] * dt;

            // Dynamic Lane Clamping (Per-Frame Correction)
            // Fixes "wall clipping"
            const worldZ = playerPos.z + nextZ;
            const wallLimit = ObstacleManager.getFenceForbiddenWidth(worldZ);

            let validMin = -roadHW;
            let validMax = roadHW;

            if (wallLimit > 0) {
                // Determine lane based on previous X to prevent jumping
                const cloneLimit = wallLimit + 0.15; // Extra buffer
                const prevWorldX = playerPos.x + this._posX[i];
                if (prevWorldX < 0) {
                    validMax = -cloneLimit - playerPos.x;
                    validMin = -roadHW - playerPos.x;
                } else {
                    validMin = cloneLimit - playerPos.x;
                    validMax = roadHW - playerPos.x;
                }
            } else {
                validMin = -roadHW - playerPos.x;
                validMax = roadHW - playerPos.x;
            }

            // Apply Clamp
            nextX = math.clamp(nextX, validMin, validMax);

            // Update Internal State & Node
            this._posX[i] = nextX;
            this._posZ[i] = nextZ;

            clone.setPosition(nextX, 0, nextZ);

            // Smooth Rotation (Visuals)
            const vx = this._velX[i];
            const yawFromVelocity = math.clamp(-vx * 8.0, -15.0, 15.0);
            const targetYaw = this.modelRotationY + yawFromVelocity;
            const curY = clone.eulerAngles.y;
            let deltaYaw = targetYaw - curY;
            if (deltaYaw > 180) deltaYaw -= 360;
            if (deltaYaw < -180) deltaYaw += 360;
            const smoothedYaw = curY + deltaYaw * Math.min(dt * 10.0, 1.0);
            clone.setRotationFromEuler(0, smoothedYaw, 0);
        }
    }

    private ensureCapacity(needed: number) {
        if (needed <= this._arrayCapacity) return;
        const newCap = Math.max(needed, this._arrayCapacity * 2, 64);

        const newVelX = new Float32Array(newCap);
        const newVelZ = new Float32Array(newCap);
        const newPosX = new Float32Array(newCap);
        const newPosZ = new Float32Array(newCap);

        if (this._arrayCapacity > 0) {
            newVelX.set(this._velX);
            newVelZ.set(this._velZ);
            newPosX.set(this._posX);
            newPosZ.set(this._posZ);
        }

        this._velX = newVelX;
        this._velZ = newVelZ;
        this._posX = newPosX;
        this._posZ = newPosZ;

        this._arrayCapacity = newCap;
    }

    private getClone(): Node {
        let node: Node;
        if (this._clonePool.length > 0) {
            node = this._clonePool.pop()!;
            node.active = true;
        } else {
            // Pool empty, create new (should be rare if pre-alloc is sufficient)
            if (!this.clonePrefab) return new Node("ErrorClone");
            node = instantiate(this.clonePrefab);

            // Ensure baked animation
            const skims = node.getComponentsInChildren(SkinnedMeshRenderer);
            skims.forEach(s => s.setUseBakedAnimation(true));
        }
        return node;
    }

    private returnClone(node: Node) {
        if (!node) return;
        node.active = false;
        node.setScale(Vec3.ONE);
        tween(node).stop();

        // Reset rigid body if exists (though we rely on kinematic calc mostly)
        const rb = node.getComponent(RigidBody);
        if (rb) {
            rb.clearState();
            rb.setLinearVelocity(Vec3.ZERO);
        }

        this._clonePool.push(node);
    }

    private getEffect(type: 'green' | 'red'): Node | null {
        let pool = this._effectPool.get(type);
        if (!pool) {
            pool = [];
            this._effectPool.set(type, pool);
        }

        if (pool.length > 0) {
            const node = pool.pop()!;
            node.active = true;
            return node;
        }

        const prefab = type === 'green' ? this.greenSplatterPrefab : this.redSplatterPrefab;
        if (!prefab) return null;
        return instantiate(prefab);
    }

    private returnEffect(node: Node, type: 'green' | 'red') {
        if (!node) return;
        node.active = false;
        let pool = this._effectPool.get(type);
        if (!pool) {
            pool = [];
            this._effectPool.set(type, pool);
        }
        pool.push(node);
    }

    public addClones(count: number) {
        if (this.isGameOver) return;
        this._pendingClonesToAdd += count;
    }

    private executeAddClones(count: number) {
        if (this.isGameOver) return;
        const room = this.MAX_CROWD_SIZE - this.currentCount;
        if (room <= 0) return;
        const actualCount = Math.min(count, room);
        if (!this.clonePrefab) return;
        this.ensureCapacity(this._clones.length + actualCount);

        let tailZ = 1.5;
        if (this._clones.length > 0) {
            // Use internal state for tail position
            const lastIdx = this._clones.length - 1;
            tailZ = this._posZ[lastIdx];
        }

        for (let i = 0; i < actualCount; i++) {
            const cloneNode = this.getClone();
            if (cloneNode.parent !== this.node) {
                cloneNode.setParent(this.node);
            }

            const total = this._clones.length;
            const col = total % 6;
            const rawSpawnX = (col - 2.5) * 0.7 + math.randomRange(-0.15, 0.15);
            const spawnX = math.clamp(rawSpawnX, -4.0, 4.0);
            const spawnZ = tailZ + 0.5 + math.randomRange(0, 0.2);

            cloneNode.setPosition(spawnX, 0, spawnZ);
            cloneNode.setRotationFromEuler(0, this.modelRotationY, 0);

            // Init Optimized Physics Arrays
            const idx = this._clones.length;
            this._clones.push(cloneNode);
            // Ensure capacity was called before loop? Yes.

            this._posX[idx] = spawnX;
            this._posZ[idx] = spawnZ;
            this._velX[idx] = 0;
            this._velZ[idx] = 0;

            // Elastic Pop-in
            cloneNode.setScale(Vec3.ZERO);
            tween(cloneNode)
                .to(0.25, { scale: new Vec3(0.8, 0.8, 0.8) }, { easing: 'backOut' })
                .start();
        }

        if (this.currentCount > this._maxCrowdCount) {
            this._maxCrowdCount = this.currentCount;
        }
        this.updateLabel();
    }

    public tryKillUnit(unitNode: Node): boolean {
        if (this.isGameOver) return false;

        // Leader Safety: If Leader is hit, sacrifice a clone!
        if (unitNode === this.node) {
            // "Sacrifice" - kill a clone instead
            const sacrificed = this.sacrificeForLeader();
            if (sacrificed) {
                // Visual feedback on Leader too?
                this.spawnSplatter('red', this.node.worldPosition); // Show leader took a hit but survived
                if (AudioManager.instance) AudioManager.instance.playHitSound();
                return true; // Count as a kill for the enemy
            } else {
                // No clones left -> Game Over
                this.onGameOver();
                return true;
            }
        }

        const index = this._clones.indexOf(unitNode);
        if (index === -1) return false;

        const worldPos = unitNode.worldPosition;
        this.spawnSplatter('green', worldPos);
        if (AudioManager.instance) AudioManager.instance.playHitSound();

        // Swap Remove O(1)
        const lastIdx = this._clones.length - 1;
        if (index < lastIdx) {
            this._clones[index] = this._clones[lastIdx];

            // Swap Physics Data
            this._posX[index] = this._posX[lastIdx];
            this._posZ[index] = this._posZ[lastIdx];
            this._velX[index] = this._velX[lastIdx];
            this._velZ[index] = this._velZ[lastIdx];
        }
        this._clones.pop();
        this.returnClone(unitNode);

        this.checkGameOver();
        if (!this.isGameOver) this.updateLabel();
        return true;
    }

    /**
     * Bulk Sacrifice for Deadlock Resolution
     */
    public sacrificeClones(amount: number) {
        if (this.isGameOver) return;

        // Safety cap
        const count = Math.min(amount, this._clones.length);

        for (let i = 0; i < count; i++) {
            // Just pop from end for efficiency
            if (this._clones.length > 0) {
                const clone = this._clones.pop();
                if (clone) {
                    this.spawnSplatter('green', clone.worldPosition); // Visuals for player death too?
                    this.returnClone(clone);
                }
            } else {
                // No clones left, hit leader?
                // Deadlock usually implies clones vs enemies.
                // If no clones, leader might die using tryKillUnit logic.
                // Let's just damage leader once if count remains?
                // For now, sacrificeClones only kills clones.
                break;
            }
        }
        this.updateLabel();
    }

    // ========== Combat State Control ==========
    public setCombatState(isCombat: boolean) {
        const playerCtrl = this.node.getComponent('PlayerController') as any;
        if (playerCtrl && playerCtrl.setCombatLock) {
            playerCtrl.setCombatLock(isCombat);
            // If Combat Locked, Player Speed is 0.
            // Enemies move at 1.0 (Normal Speed) if we set Scale to 1.0
            // OR if we want Slow Motion, we set speed scale.
            // But User wants "Enemies have speed".
            // Let's ensure Enemies are fast enough.
        }
    }

    /**
     * Hybrid Combat: Find the "Frontline" unit (Lowest Z) for proximity checks.
     */
    public getFrontlineUnit(): Node | null {
        if (this.isGameOver || this.currentCount <= 0) return null;

        let frontUnit: Node | null = null;
        let minZ = 999999;

        // Check Leader
        if (this.node.worldPosition.z < minZ) {
            minZ = this.node.worldPosition.z;
            frontUnit = this.node;
        }

        // Check Clones
        for (const clone of this._clones) {
            if (clone.worldPosition.z < minZ) {
                minZ = clone.worldPosition.z;
                frontUnit = clone;
            }
        }
        return frontUnit;
    }

    /**
     * Find the absolute closest unit to a given position (Zombie Swarm Logic).
     */
    public getClosestUnit(worldPos: Vec3): Node | null {
        if (this.isGameOver) return null;

        let closest: Node | null = null;
        let minSq = 999999;

        // Check Leader
        const leaderDist = Vec3.squaredDistance(this.node.worldPosition, worldPos);
        if (leaderDist < minSq) {
            minSq = leaderDist;
            closest = this.node;
        }

        // Check Clones
        for (const clone of this._clones) {
            const d = Vec3.squaredDistance(clone.worldPosition, worldPos);
            if (d < minSq) {
                minSq = d;
                closest = clone;
            }
        }
        return closest;
    }

    /**
     * Get all active player units (Leader + Clones).
     * Used by Enemy AI for individual targeting.
     */
    public getAllUnits(): Node[] {
        const units: Node[] = [];
        if (this.node.isValid) units.push(this.node);
        for (const c of this._clones) {
            if (c.isValid) units.push(c);
        }
        return units;
    }

    // ================================================================
    //  Smart Target Distribution (Lock System)
    // ================================================================
    private _targetLocks: Map<Node, number> = new Map();

    public addTargetLock(target: Node) {
        if (!target) return;
        const current = this._targetLocks.get(target) || 0;
        this._targetLocks.set(target, current + 1);
    }

    public removeTargetLock(target: Node) {
        if (!target) return;
        const current = this._targetLocks.get(target) || 0;
        if (current > 0) {
            this._targetLocks.set(target, current - 1);
        }
        // Cleanup if 0? Optional. Map handles objects as keys fine.
        if (current <= 1) {
            this._targetLocks.delete(target);
        }
    }

    public getLockCount(target: Node): number {
        if (!target) return 0;
        return this._targetLocks.get(target) || 0;
    }

    /**
     * Precision elimination for Frontline Erosion: 
     * Finds and kills the player unit at the "Front Line" (highest World Z).
     */
    public killClosestUnit(enemyWorldPos: Vec3): Node | null {
        if (this.isGameOver) return null;

        let target: Node | null = null;

        // Frontline Logic: Since players move in -Z, the "Front" units have the MINIMUM Z in world space
        // Wait, in this project Track is -Z (Forward). So LARGER Z is behind, SMALLER Z is forward?
        // Let's check TrackManager or PlayerController.
        // PlayerController: newZ = currentPos.z - (effectiveSpeed * deltaTime); 
        // So they move from Z=0 towards Z=-1000.
        // Therefore, the "Front" units are the ones with the SMALLER (most negative) Z.

        if (this._clones.length > 0) {
            // Find the clone closest to the enemy, but prefer those at the front (lower Z)
            let minZ = 999999;
            for (const clone of this._clones) {
                const z = clone.worldPosition.z;
                if (z < minZ) {
                    minZ = z;
                    target = clone;
                }
            }

            // Refinement: If there are multiple units at the front row, pick the one closest to enemy X
            const frontUnits = this._clones.filter(c => Math.abs(c.worldPosition.z - minZ) < 0.5);
            if (frontUnits.length > 1) {
                let minDistSq = 999999;
                for (const fu of frontUnits) {
                    const d = Vec3.squaredDistance(fu.worldPosition, enemyWorldPos);
                    if (d < minDistSq) {
                        minDistSq = d;
                        target = fu;
                    }
                }
            }
        } else {
            // No clones? Leader dies.
            this.onGameOver();
            return null;
        }

        if (target) {
            this.tryKillUnit(target);
            return target;
        }
        return null;
    }

    public sacrificeForLeader(): boolean {
        if (this._clones.length === 0) {
            this.checkGameOver();
            return false;
        }
        const victim = this._clones[this._clones.length - 1];
        if (victim && victim.isValid) return this.tryKillUnit(victim);
        return false;
    }

    public checkGameOver() {
        if (this._clones.length <= 0 && !this.isGameOver) {
            this.updateLabel();
            this.onGameOver();
        }
    }

    public applyMath(mathType: string, value: number) {
        this.applyGateEffect(mathType, value);
    }

    /**
     * Standardized entry point for gate effects (requested)
     */
    public applyGateEffect(mathType: string, value: number) {
        if (this.isGameOver) return;

        const realCount = this._clones.length + 1;
        let targetTotal = realCount;
        if (mathType === '+') targetTotal = realCount + value;
        else if (mathType === 'x') targetTotal = Math.floor(realCount * value);
        else if (mathType === '-') targetTotal = realCount - value;
        else if (mathType === '/') targetTotal = Math.floor(realCount / value);

        if (targetTotal <= 0) {
            this._pendingClonesToAdd = 0;
            while (this._clones.length > 0) {
                const c = this._clones.pop();
                if (c) {
                    this.spawnSplatter('green', c.worldPosition);
                    this.returnClone(c);
                }
            }
            this.updateLabel();
            if (AudioManager.instance) AudioManager.instance.playGateSound(mathType);
            this.onGameOver();
            return;
        }

        const diff = targetTotal - realCount;
        if (diff > 0) {
            this.addClones(diff);
        } else if (diff < 0) {
            const toRemove = Math.min(-diff, this._clones.length);
            for (let r = 0; r < toRemove; r++) {
                const c = this._clones.pop();
                if (c) {
                    this.spawnSplatter('green', c.worldPosition);
                    this.returnClone(c);
                }
            }
            this.checkGameOver();
        }
        if (AudioManager.instance) AudioManager.instance.playGateSound(mathType);
        this.updateLabel();
    }

    private updateLabel() {
        if (this.countLabel && this.countLabel.isValid) {
            this.countLabel.string = Math.max(0, this.currentCount).toString();
        }
    }

    private onGameOver() {
        if (this.isGameOver) return;
        this.isGameOver = true;
        UIManager.isPlaying = false;
        console.log('=== Game Over! ===');
        const playerCtrl = this.node.getComponent('PlayerController');
        if (playerCtrl) (playerCtrl as any).stopMoving();
        if (UIManager.instance) UIManager.instance.showGameOver(this.currentCount);
    }

    public spawnSplatter(type: 'green' | 'red', worldPos: Vec3) {
        const fx = this.getEffect(type);
        if (!fx) return;

        const scene = director.getScene();
        if (!scene) {
            this.returnEffect(fx, type);
            return;
        }

        if (fx.parent !== scene) fx.setParent(scene);
        fx.setWorldPosition(worldPos.x, worldPos.y + 0.5, worldPos.z);
        fx.active = true;

        this.scheduleOnce(() => {
            if (!this.node || !this.node.isValid) return;
            if (fx && fx.isValid) this.returnEffect(fx, type);
        }, 1.0);
    }

    lateUpdate(dt: number) {
        if (this._pendingClonesToAdd > 0) {
            const batch = Math.min(this._pendingClonesToAdd, this.UNITS_PER_FRAME);
            this.executeAddClones(batch);
            this._pendingClonesToAdd -= batch;
        }
    }
}