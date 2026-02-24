import { _decorator, Component, Collider, ITriggerEvent, Node, Prefab, instantiate, director, Vec3, SkinnedMeshRenderer } from 'cc';
import { AutoDestroy } from './AutoDestroy';
import { CrowdManager } from './CrowdManager';
const { ccclass, property } = _decorator;

const _tempPos = new Vec3();
const _tempTarget = new Vec3();
const _tempDiff = new Vec3();

@ccclass('Enemy')
export class Enemy extends Component {

    private collider: Collider | null = null;
    public isDead: boolean = false; // 防抖标志，防止重复触发

    // AI Targeting
    public currentTarget: Node | null = null;
    public isHunting: boolean = false; // Controlled by EnemyGroupManager
    private lastSearchTime: number = 0;
    private searchInterval: number = 0.2;
    private moveSpeed: number = 8.0;

    start() {
        // PERF: Enforce Baked Animation for Instancing compatibility
        const skims = this.getComponentsInChildren(SkinnedMeshRenderer);
        skims.forEach(s => s.setUseBakedAnimation(true));

        this.collider = this.getComponent(Collider);

        // ATOMIC PHYSICS COMBAT: Force Trigger Mode
        if (this.collider) {
            this.collider.isTrigger = true;
            this.collider.on('onTriggerEnter', this.onTriggerEnter, this);
        }

        // Randomize search interval to prevent frame spikes
        this.searchInterval = 0.2 + Math.random() * 0.1;
    }

    onDisable() {
        this.currentTarget = null;
        this.isHunting = false;
    }

    onDestroy() {
        // Release target lock if this enemy is destroyed
        if (this.currentTarget && CrowdManager.instance) {
            CrowdManager.instance.removeTargetLock(this.currentTarget);
        }
    }

    private _lastCheckTime: number = 0;

    update(deltaTime: number) {
        if (this.isDead || !this.isHunting) return;

        // 1. Maintain Target & Strict Validation
        const now = director.getTotalTime() / 1000;
        if (this.currentTarget) {
            if (!this.currentTarget.isValid || !this.currentTarget.activeInHierarchy) {
                // Target Lost/Dead: Release Lock
                if (CrowdManager.instance) CrowdManager.instance.removeTargetLock(this.currentTarget);
                this.currentTarget = null;
            }
        }

        if (!this.currentTarget) {
            this.findNearestTarget();
        }

        // 2. Opportunistic Re-Targeting (Every 0.1s)
        // Smart Targeting: Check 3.5m range for better, unlocked targets.
        if (now - this._lastCheckTime > 0.1) {
            this._lastCheckTime = now;

            // FIX: Removed "distSq > 1.0" restriction. Always scan for better targets.
            // Opportunity Kill Check
            if (this.currentTarget) {
                const better = this.findBetterTargetInRange(3.5);
                if (better) {
                    this.node.getWorldPosition(_tempPos);
                    better.getWorldPosition(_tempTarget);
                    const bDistSq = Vec3.squaredDistance(_tempPos, _tempTarget);

                    // OPPORTUNITY KILL: If new target is within kill range (0.8m), kill immediately!
                    if (bDistSq < 0.64) {
                        this.executeCombatLogic(better);
                        return;
                    }

                    this.switchTarget(better);
                }
            }
        }

        // 3. Move to Target & Combat
        if (this.currentTarget && this.currentTarget.isValid && this.currentTarget.activeInHierarchy) {
            this.node.getWorldPosition(_tempPos);
            this.currentTarget.getWorldPosition(_tempTarget);
            const distSq = Vec3.squaredDistance(_tempPos, _tempTarget);

            // Active Distance Check
            // User requested 0.8m threshold (0.8 * 0.8 = 0.64)
            if (distSq < 0.64) {
                this.executeCombatLogic(this.currentTarget);
                return;
            }

            // Look At (Y-axis only)
            const dx = _tempTarget.x - _tempPos.x;
            const dz = _tempTarget.z - _tempPos.z;
            const angle = Math.atan2(dx, dz); // radians
            this.node.setRotationFromEuler(0, angle * 57.2958, 0);

            // Move
            let speed = 12.0;

            const dist = speed * deltaTime;
            const vx = Math.sin(angle) * dist;
            const vz = Math.cos(angle) * dist;

            _tempPos.x += vx;
            _tempPos.z += vz;
            this.node.setWorldPosition(_tempPos);
        }
    }

    private findNearestTarget() {
        if (!CrowdManager.instance) return;

        // OPTIMIZED: Smart Target Distribution
        const clones = CrowdManager.instance.rawClones;
        const leader = CrowdManager.instance.node;
        const manager = CrowdManager.instance;

        let bestTarget: Node | null = null;
        let minScore = 999999;

        this.node.getWorldPosition(_tempPos);

        const checkCandidate = (candidate: Node) => {
            if (!candidate.isValid || !candidate.activeInHierarchy) return;

            candidate.getWorldPosition(_tempTarget);
            const distSq = Vec3.squaredDistance(_tempPos, _tempTarget);
            const lockCount = manager.getLockCount(candidate);

            // Heuristic Score: Lowest Lock Count -> Lowest Distance
            const score = lockCount * 10000 + distSq;

            if (score < minScore) {
                minScore = score;
                bestTarget = candidate;
            }
        };

        if (leader) checkCandidate(leader);
        for (let i = 0; i < clones.length; i++) {
            checkCandidate(clones[i]);
        }

        if (this.currentTarget !== bestTarget) {
            this.switchTarget(bestTarget);
        }
    }

    /**
     * Opportunistic Check (Smart Targeting):
     * Scans for a MUCH closer target within a range (e.g. 3.5m).
     * Rule: New target must be unlocked OR extremely close (Kill Steal).
     */
    private findBetterTargetInRange(range: number): Node | null {
        if (!CrowdManager.instance) return null;

        // Safety: If we don't have a target, we can't compare "better".
        if (!this.currentTarget) return null;

        this.currentTarget.getWorldPosition(_tempTarget);
        const currentDistSq = Vec3.squaredDistance(this.node.worldPosition, _tempTarget);

        // Hysteresis: New target must be closer (95% of current distance)
        const thresholdSq = currentDistSq * 0.95;
        const searchRangeSq = range * range;

        // We only care if the new target is within 'range' AND satisfies hysteresis
        const effectiveMaxSq = Math.min(thresholdSq, searchRangeSq);

        const clones = CrowdManager.instance.rawClones;
        const leader = CrowdManager.instance.node;
        const manager = CrowdManager.instance;

        const myPos = this.node.worldPosition;

        // Helper to check candidate
        const checkCandidate = (candidate: Node): boolean => {
            if (candidate === this.currentTarget || !candidate.isValid || !candidate.activeInHierarchy) return false;

            const d2 = Vec3.squaredDistance(myPos, candidate.worldPosition);

            // 1. Must be closer than current target (with hysteresis)
            if (d2 > effectiveMaxSq) return false;

            // 2. Kill Steal Exception: If extremely close (< 1.0m), ignore locks!
            if (d2 < 1.0) return true;

            // 3. Normal Rule: Must be UNLOCKED
            if (manager.getLockCount(candidate) > 0) return false;

            return true;
        };

        // 1. Check Leader
        if (leader && checkCandidate(leader)) return leader;

        // 2. Check Clones
        for (let i = 0; i < clones.length; i++) {
            if (checkCandidate(clones[i])) return clones[i];
        }

        return null;
    }

    private switchTarget(newTarget: Node | null) {
        if (this.currentTarget === newTarget) return;

        // Unlock old
        if (this.currentTarget && CrowdManager.instance) {
            CrowdManager.instance.removeTargetLock(this.currentTarget);
        }

        this.currentTarget = newTarget;

        // Lock new
        if (this.currentTarget && CrowdManager.instance) {
            CrowdManager.instance.addTargetLock(this.currentTarget);
        }
    }

    private onTriggerEnter(event: ITriggerEvent) {
        this.executeCombatLogic(event.otherCollider.node);
    }

    private executeCombatLogic(targetNode: Node) {
        // 1. ATOMIC LOCK: Strict 1v1 Check
        if (this.isDead || !targetNode || !targetNode.isValid) return;

        let isPlayer = targetNode.name === 'Player' || targetNode.name.startsWith('Clone');
        if (!isPlayer) return;

        // Is it the Leader?
        const playerCtrl = targetNode.getComponent('PlayerController') as any;
        if (playerCtrl) {
            if (playerCtrl.isDead) return; // Leader already dead
            playerCtrl.isDead = true; // Lock Leader
        }

        // Lock Self
        this.isDead = true;

        // Release Target Lock (Important for others to know he's dead)
        if (CrowdManager.instance) {
            CrowdManager.instance.removeTargetLock(targetNode);
        }

        // Execute Mutual Destruction
        this.spawnRedSplatter();

        // Remove Player Unit
        const crowdManager = CrowdManager.instance;
        if (crowdManager) {
            crowdManager.removeMember(targetNode);
        }

        // Notify Group for Slowdown Logic
        const group = this.node.parent?.getComponent('EnemyGroupManager') as any;
        if (group) {
            group.onEnemyDied();
        }

        // Destroy Self
        this.node.destroy();
    }

    private spawnRedSplatter() {
        if (CrowdManager.instance) {
            CrowdManager.instance.spawnSplatter('red', this.node.worldPosition);
        }
    }

    public checkCulling(playerZ: number) {
        // STRICT PHYSICS CULLING:
        // Only enable physics when absolutely necessary (close contact potential).
        // 6m is safe enough for 12m/s speed (0.5s reaction time).
        const distZ = Math.abs(this.node.worldPosition.z - playerZ);
        const shouldActive = distZ < 6.0;

        if (this.collider && this.collider.enabled !== shouldActive) {
            this.collider.enabled = shouldActive;
        }
    }
}
