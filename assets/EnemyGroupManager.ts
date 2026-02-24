import { _decorator, Component, Node, Prefab, instantiate, Label, CapsuleCollider, ITriggerEvent, Vec3, math, RigidBody, BoxCollider } from 'cc';
import { PlayerController } from './PlayerController';
import { CrowdManager } from './CrowdManager';
import { AudioManager } from './AudioManager';
import { UIManager } from './UIManager';
import { TrackManager } from './TrackManager';
const { ccclass, property } = _decorator;

@ccclass('EnemyGroupManager')
export class EnemyGroupManager extends Component {
    @property(Prefab) enemyPrefab: Prefab | null = null;
    @property(Label) countLabel: Label | null = null;

    public currentCount: number = 0;
    private enemyList: Node[] = [];

    // ========== Formation Constants ==========
    private targetPositions: Vec3[] = [];
    private readonly LERP_SPEED: number = 20;
    private readonly ZOMBIE_SPEED: number = 12;
    private readonly ROAD_LIMIT_X: number = 5.0;
    private readonly SPACING_X: number = 0.6;
    private readonly SPACING_Z: number = 0.55;

    // ========== Aggression & Animation ==========
    public aggression: number = 0; // 0:Static, 1:Patrol, 2:Charge
    private _patrolTime: number = 0;


    public initEnemyGroup(count: number, aggression: number = 0) {
        // Reset static timer on first use if needed, but it's just a timestamp.
        // Actually best to reset in onLoad if possible, but this is a prefab.
        // Let's iterate: if director.time < 1.0 (just started), reset?
        // Or just let it be. 40ms is nothing.
        // But user requested "Check all static".
        // Let's add a static reset method called by GameManager/UIManager?
        // Or just reset it here if it's way in the past? No.
        // It's benign.

        this.currentCount = count;
        this.aggression = aggression;
        if (this.countLabel) this.countLabel.string = this.formatEnemyCount(count);

        const positions = this.calculateFormation(count, 0);
        if (!this.enemyPrefab) return;

        for (let i = 0; i < count; i++) {
            const enemyNode = instantiate(this.enemyPrefab);
            enemyNode.setParent(this.node);
            const pos = positions[i];
            enemyNode.setPosition(pos.x, 1.05, pos.z);

            // Physics Blocking Mode: isTrigger = FALSE
            const collider = enemyNode.getComponent(CapsuleCollider);
            if (collider) {
                collider.isTrigger = false;
            }

            const rb = enemyNode.getComponent(RigidBody);
            if (rb) {
                rb.type = RigidBody.Type.DYNAMIC;
                rb.linearFactor = new Vec3(1, 0, 1); // Lock Y movement
                rb.angularFactor = new Vec3(0, 0, 0); // Lock Rotation
                rb.mass = 2.0; // Heavier than player to push?
            }

            this.enemyList.push(enemyNode);
        }

        this.recalcTargetPositions();
    }

    // ========== Combat Logic (Atomic Physics) ==========

    // ========== Feedback Control ==========
    private static _lastFeedbackTime: number = 0;

    public onEnemyDied() {
        // Called by Enemy before it dies.

        // 1. Trigger Slowdown (First Blood)
        this._hasSlowedDown = true;
        this._combatStartTime = Date.now() / 1000; // Start Timer
        this._lastCasualtyTime = this._combatStartTime; // Init Deadlock Timer
        CrowdManager.instance.setCombatState(true); // Player Lock
        CrowdManager.instance.setSpeedScale(0.1);   // Slow down clones?

        // Update Deadlock Timer
        this._lastCasualtyTime = Date.now() / 1000;

        // 2. Feedback (Throttled 40ms)
        const now = Date.now();
        if (now - EnemyGroupManager._lastFeedbackTime > 40) {
            EnemyGroupManager._lastFeedbackTime = now;
            if (AudioManager.instance) AudioManager.instance.playHitSound();
            if (navigator && navigator.vibrate) navigator.vibrate(15); // Stronger tick
        }

        // 3. Update Count
        this.currentCount--;
        if (this.countLabel) this.countLabel.string = this.formatEnemyCount(Math.max(0, this.currentCount));

        // 4. Check Wipe
        if (this.currentCount <= 0) {
            if (CrowdManager.instance) {
                CrowdManager.instance.setCombatState(false);
                CrowdManager.instance.setSpeedScale(1.0);
            }
            this.destroyGroup();
        }
    }

    private formatEnemyCount(count: number): string {
        if (count < 10) return count.toString();
        const s = count.toString();
        // Keep first digit, replace rest with '?'
        return s[0] + '?'.repeat(s.length - 1);
    }

    private _hasSlowedDown: boolean = false;
    private _combatStartTime: number = 0;
    private _lastCasualtyTime: number = 0; // Moved up for clarity
    private readonly COMBAT_TIMEOUT: number = 5.0; // 5 seconds timeout (User Request)

    update(deltaTime: number) {
        if (!UIManager.isPlaying) return;

        // Cleanup invalid nodes from list first
        for (let i = this.enemyList.length - 1; i >= 0; i--) {
            if (!this.enemyList[i].isValid) {
                this.enemyList.splice(i, 1);
            }
        }

        // Global Optimization: Cull groups far behind
        if (TrackManager.instance && TrackManager.instance.player) {
            const pZ = TrackManager.instance.player.worldPosition.z;
            if (this.node.worldPosition.z > pZ + 25.0) {
                this.destroyGroup();
                return;
            }
        }

        this._patrolTime += deltaTime;
        this.updateMovement(deltaTime);

        // Timeout Failsafe (Deadlock Resolution)
        if (this._hasSlowedDown && this.currentCount > 0) {
            const now = Date.now() / 1000;

            // Dynamic Threshold:
            // > 10 enemies: 3.0s (Give time for swarm to settle)
            // <= 10 enemies: 1.0s (Fast cleanup for stragglers)
            const threshold = this.currentCount > 10 ? 3.0 : 1.0;

            if (now - this._lastCasualtyTime > threshold) {
                this.resolveDeadlock();
            }
        }
    }

    private resolveDeadlock() {
        if (!CrowdManager.instance) return;

        console.warn(`[Deadlock] Group ${this.node.uuid} stuck. resolving...`);

        // 1. Calculate remaining enemies
        // We can trust this.currentCount or get actual children
        const enemies = this.node.getComponentsInChildren('Enemy') as any[];
        const remaining = enemies.length;

        if (remaining === 0) {
            this.destroyGroup();
            return;
        }

        // 2. Sacrifice Player Clones (Mutual Destruction)
        // We remove 'remaining' number of clones to simulate the fight happening instantly.
        CrowdManager.instance.sacrificeClones(remaining);

        // 3. Kill All Enemies with VFX
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (enemy.node && enemy.node.isValid) {
                // VFX: Blood Splatter
                CrowdManager.instance.spawnSplatter('red', enemy.node.worldPosition);
                // Destroy
                enemy.node.destroy();
            }
        }

        // 4. Force Cleanup
        if (this.node.isValid) {
            // Wait a frame for destroy? Or just kill group controller immediately
            // Destroying group might kill children before they render vfx? 
            // splatters are in world space (hopefully). CrowdManager spawns them in world.
            // So we can destroy group now.
            this.destroyGroup();
        }
    }

    private destroyGroup() {
        if (this.node.isValid) this.node.destroy();
    }

    private updateMovement(deltaTime: number) {
        const playerNode = TrackManager.instance ? TrackManager.instance.player : null;
        const playerZ = playerNode ? playerNode.worldPosition.z : 0;

        // Strict "Only Contact" Trigger:
        // Swarm (Hunt) Mode activates ONLY when contact has been made (First Blood).
        const isSwarming = this._hasSlowedDown;

        if (isSwarming) {
            // Activate Hunting Mode on all enemies
            for (const enemyNode of this.enemyList) {
                if (!enemyNode.isValid) continue;
                const enemyComp = enemyNode.getComponent('Enemy') as any;
                if (enemyComp) {
                    enemyComp.isHunting = true;
                }
            }
        } else {
            // Formation Logic (Pre-combat / Patrol)
            const offset = this.aggression === 1 ? Math.sin(this._patrolTime * 2.0) * 2.0 : 0;
            const groupWorldX = this.node.worldPosition.x;
            const groupWorldZ = this.node.worldPosition.z;

            // Recalculate formation if count changed? (Optional, but efficient enough)
            // For now, just map current list to target slots
            for (let i = 0; i < this.enemyList.length; i++) {
                const enemy = this.enemyList[i];
                if (!enemy || !enemy.isValid) continue; // Ensure enemy is valid before proceeding

                const enemyComp = enemy.getComponent('Enemy') as any;
                // PHYSICS OPTIMIZATION: Disable Collider if far away
                if (enemyComp) {
                    enemyComp.checkCulling(playerZ);
                }

                // Safety check if we have more enemies than slots (rare)
                if (i >= this.targetPositions.length) break;

                const target = this.targetPositions[i];
                if (!target) continue;

                // Ensure Hunting is OFF
                if (enemyComp) enemyComp.isHunting = false;

                // Lerp to target slot
                const targetWorldX = groupWorldX + target.x + offset;
                const targetWorldZ = groupWorldZ + target.z;

                const current = enemy.worldPosition;
                const newX = math.lerp(current.x, targetWorldX, deltaTime * this.LERP_SPEED);
                const newZ = math.lerp(current.z, targetWorldZ, deltaTime * this.LERP_SPEED);

                enemy.setWorldPosition(newX, 1.05, newZ);
                enemy.setRotationFromEuler(0, 0, 0);
            }
        }
        this.updateLabelPosition();
    }

    private updateLabelPosition() {
        if (!this.countLabel || this.enemyList.length === 0) return;
        let sX = 0, sZ = 0, v = 0;
        for (const e of this.enemyList) {
            if (e.isValid) { sX += e.position.x; sZ += e.position.z; v++; }
        }
        if (v > 0) {
            const cP = this.countLabel.node.position;
            this.countLabel.node.setPosition(sX / v, cP.y, sZ / v);
        }
    }

    private recalcTargetPositions() {
        // Formation recalculation (always allowed now)
        this.targetPositions = this.calculateFormation(this.enemyList.length, 0);
    }

    private calculateFormation(count: number, offsetX: number): Vec3[] {
        const positions: Vec3[] = [];
        const sr = Math.max(10, Math.ceil(Math.sqrt(count)) + 5);
        let pts: Vec3[] = [];
        for (let r = -sr; r <= sr; r++) {
            for (let c = -sr; c <= sr; c++) {
                const h = (r % 2 !== 0) ? this.SPACING_X * 0.5 : 0;
                const x = c * this.SPACING_X + h + offsetX;
                const z = r * this.SPACING_Z;
                if (Math.abs(x) <= this.ROAD_LIMIT_X) pts.push(new Vec3(x, 0, z));
            }
        }
        pts.sort((a, b) => (a.x * a.x * 0.3 + a.z * a.z) - (b.x * b.x * 0.3 + b.z * b.z));
        for (let i = 0; i < count; i++) positions.push(pts[i] || new Vec3(offsetX, 0, 0));
        return positions;
    }

    // Listener removed: Individual Enemy components handle collision now.

    onDestroy() {
        // Cleanup if needed
        if (this._hasSlowedDown && CrowdManager.instance) {
            CrowdManager.instance.setCombatState(false);
            CrowdManager.instance.setSpeedScale(1.0);
        }
    }
}