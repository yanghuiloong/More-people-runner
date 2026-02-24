<p align="center">
  <img src="assets/APP_logo.png" alt="More People Runner" width="200">
</p>

<h1 align="center">🏃 More People Runner</h1>

<p align="center">
  <b>A 3D Endless Runner with Crowd Mechanics, Math Gates & Zombie Combat</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Engine-Cocos%20Creator%203.8.8-blue?logo=data:image/svg+xml;base64,..." alt="Cocos Creator 3.8.8">
  <img src="https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Platform-Android%20%7C%20Web-green" alt="Platform">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## 📖 About

**More People Runner** is a casual 3D endless runner mobile game built with **Cocos Creator 3.8.8**. Players control a growing crowd of characters running through a procedurally generated city. Collect clones through math gates, battle zombie-like enemy groups, and survive as long as possible!

Inspired by popular "crowd runner" hyper-casual games, this project features advanced systems including **Boids-based crowd simulation**, **spatial hash grids for performance**, **dynamic difficulty scaling**, and a **full combat AI system**.

---

## 🎮 Gameplay

### Core Loop

1. **Run** — Your crowd automatically runs forward through the city
2. **Swipe** — Drag left/right to steer your crowd across lanes
3. **Choose Gates** — Pass through math gates to grow (or shrink!) your crowd
4. **Fight Enemies** — Clash with enemy groups in 1-vs-1 auto-combat
5. **Survive** — Keep your crowd alive as long as possible for a high score!

### Gate Types

| Gate | Effect | Color |
|------|--------|-------|
| **+ (Add)** | Adds members to your crowd | 🟢 Green |
| **× (Multiply)** | Multiplies your crowd size | 🟡 Gold |
| **− (Subtract)** | Removes members | 🔴 Red |
| **÷ (Divide)** | Divides your crowd | 🔴 Red |
| **? (Mystery)** | Random outcome based on difficulty state | 🟡 Gold |

### Difficulty System (FlowState)

The game dynamically adjusts difficulty based on your crowd size:

| State | Trigger | Description |
|-------|---------|-------------|
| 🟢 **RECOVERY** | Crowd < 10 | More favorable gates, easier enemies |
| 🟡 **CHALLENGE** | 10 ≤ Crowd < 80 | Balanced risk/reward |
| 🔴 **GRINDER** | Crowd ≥ 80 | Harsh gates, stronger enemy groups |

---

## ✨ Features

### 🧠 Advanced Crowd AI
- **Boids Simulation** — Clones exhibit flocking behavior with separation, cohesion, and alignment
- **Spatial Hash Grid** — Zero-GC optimized spatial partitioning for efficient neighbor queries
- **Object Pooling** — Reusable clone/effect pools for smooth performance

### ⚔️ Combat System
- **Enemy Formations** — Enemy groups spawn in military-style formations across the road
- **Smart Targeting** — Enemies use proximity-based target selection with lock-on mechanics
- **Aggression Levels** — Static (0), Patrol (1), and Charge (2) enemy behaviors
- **Deadlock Resolution** — Automatic sacrifice mechanics when combat stalls

### 🏗️ Procedural Generation
- **Infinite Track** — Seamless road generation with efficient recycling
- **Fence Obstacles** — Narrow corridors that force crowd compression & lane splitting
- **Decision Gates** — Paired gates inside fences creating meaningful dilemma choices
- **City Skyline** — Procedurally generated building backdrop with fog-based depth

### 🎨 Visual & Audio
- **Visual Banking** — Characters tilt smoothly when turning
- **Splatter Effects** — Green/Red particle effects on clone gain/loss
- **BGM & SFX** — Full audio system with per-gate sound effects
- **Haptic Feedback** — Native Android vibration via JNI, Web vibration API fallback
- **Bilingual UI** — Full Chinese/English UI toggle (中文/English)

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Engine** | Cocos Creator 3.8.8 |
| **Language** | TypeScript |
| **3D Assets** | FBX (Character models with animations) |
| **Physics** | Cocos Built-in 3D Physics (Triggers & Colliders) |
| **Audio** | Cocos AudioSource (BGM + SFX) |
| **Platforms** | Android (Native APK), Web (HTML5) |

---

## 📁 Project Structure

```
MorePeopleRunner/
├── assets/
│   ├── PlayerController.ts     # Touch input & character movement
│   ├── CrowdManager.ts         # Boids crowd simulation & clone management
│   ├── TrackManager.ts         # Infinite track generation & gate spawning
│   ├── EnemyGroupManager.ts    # Enemy formation & group AI
│   ├── Enemy.ts                # Individual enemy targeting & combat
│   ├── GateController.ts       # Math gate logic (+, ×, −, ÷, ?)
│   ├── ObstacleManager.ts      # Fence obstacles & decision gate pairs
│   ├── UIManager.ts            # Full code-generated UI system
│   ├── AudioManager.ts         # BGM, SFX & haptic feedback
│   ├── CityGenerator.ts        # Procedural city skyline
│   ├── CameraController.ts     # Camera follow logic
│   ├── VisualBanking.ts        # Turn-tilt visual effect
│   ├── ParallaxBackground.ts   # Parallax depth effect
│   ├── NativeUtils.ts          # Native platform utilities (JNI vibration)
│   ├── AutoDestroy.ts          # Timed auto-destruction component
│   ├── EnemyBlock.ts           # Enemy block obstacle
│   ├── Prefabs/                # All game prefabs
│   │   ├── Clone.prefab        # Player clone unit
│   │   ├── Enemy.prefab        # Enemy unit
│   │   ├── EnemyGroup.prefab   # Enemy group container
│   │   ├── Road.prefab         # Road segment
│   │   ├── FencePrefab.prefab  # Fence obstacle
│   │   ├── Gold/Green/RedGatePrefab.prefab  # Math gates
│   │   └── Green/RedSplatter.prefab         # VFX
│   └── scene.scene             # Main game scene
├── settings/                   # Cocos Creator project settings
├── package.json                # Project metadata
└── tsconfig.json               # TypeScript configuration
```

---

## 🚀 Getting Started

### Prerequisites

- [Cocos Creator 3.8.x](https://www.cocos.com/en/creator/download) (3.8.8 recommended)
- Node.js 16+

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yanghuiloong/More-people-runner.git
   ```

2. **Open in Cocos Creator**
   - Launch Cocos Dashboard
   - Click "Add" → Browse to the cloned project folder
   - Open the project

3. **Run the game**
   - Open `assets/scene.scene` in the editor
   - Click the **Play** button (▶) to preview in browser

### Build for Android

1. Go to **Project → Build** in Cocos Creator
2. Select **Android** platform
3. Configure your Android SDK/NDK paths
4. Click **Build** then **Make** then **Run**

---

## 🎯 Architecture Highlights

### Spatial Hash Grid
The `CrowdManager` uses a custom **Spatial Hash Grid** with zero garbage collection overhead for efficient O(1) average-case neighbor queries. This enables smooth Boids simulation even with 100+ active clones.

### FlowState Difficulty Scaling
The `TrackManager` implements a three-tier dynamic difficulty system:
- **RECOVERY** — Helps struggling players rebuild their crowd
- **CHALLENGE** — The core gameplay loop with balanced risk/reward
- **GRINDER** — Punishes overpowered crowds to maintain tension

### Combat Resolution
When the player crowd meets an enemy group:
1. Individual enemies lock onto the nearest player clone
2. Both units are destroyed on contact (1-for-1 exchange)
3. Deadlock detection triggers automatic sacrifice if combat stalls
4. Player speed reduces to 15% during combat ("creep forward")

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with ❤️ using <a href="https://www.cocos.com/en/creator">Cocos Creator</a>
</p>
