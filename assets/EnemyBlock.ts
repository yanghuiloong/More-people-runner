import { _decorator, Component, Node, Prefab, instantiate, math } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('EnemyBlock')
export class EnemyBlock extends Component {
    @property(Prefab)
    enemyPrefab: Prefab | null = null; // 敌方小兵预制体

    start() {
        // 生成红方大军方阵
        this.spawnEnemyFormation();
    }

    /**
     * 生成红方敌军方阵
     */
    private spawnEnemyFormation() {
        if (!this.enemyPrefab) {
            console.error('EnemyBlock: enemyPrefab 未设置');
            return;
        }

        // 方阵参数配置
        const cols = 10; // 横向列数（宽度足以堵死跑道）
        const rows = math.randomRangeInt(3, 8); // 纵向排数随机（决定敌军厚度）
        const spacing = 0.6; // 敌军间距

        // 嵌套循环生成方阵
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // 实例化敌军小兵
                const enemy = instantiate(this.enemyPrefab);
                
                // 设置为当前节点的子节点
                enemy.setParent(this.node);
                
                /**
                 * 计算局部位置（居中对齐）
                 * X 轴：从 -(cols-1)/2 到 +(cols-1)/2，确保整体居中
                 * Z 轴：从前往后排列
                 */
                const offsetX = (col - (cols - 1) / 2) * spacing;
                const offsetZ = row * spacing;
                
                // 设置敌军小兵的位置
                enemy.setPosition(offsetX, 0, offsetZ);
            }
        }

        console.log(`EnemyBlock: 生成了 ${rows} 行 × ${cols} 列 = ${rows * cols} 个敌军`);
    }
}
