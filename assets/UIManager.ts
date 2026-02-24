import {
    _decorator, Component, Node, Label, Canvas, UITransform,
    Button, Sprite, Color, director, view, Layers,
    Camera, Texture2D, SpriteFrame, sys, LabelOutline, Vec2, Widget
} from 'cc';
import { AudioManager } from './AudioManager';
import { TrackManager } from './TrackManager';
import { CrowdManager } from './CrowdManager';
const { ccclass } = _decorator;

// ========== Localization ==========
const L = {
    cn: {
        title: '越跑人越多', start: '▶  开始游戏',
        paused: '⏸  暂停', resume: '▶  继续游戏', restart: '🔄  重新开始',
        gameOver: '💀  挑战失败',
        bgmOn: '🎵 音乐: 开', bgmOff: '🎵 音乐: 关',
        sfxOn: '🔊 音效: 开', sfxOff: '🔊 音效: 关',
        vibOn: '📳 震动: 开', vibOff: '📳 震动: 关',
        lang: '🌐 English',
        dist: '距离', best: '最佳',
        crowd: '人数', maxCrowd: '历史最多',
    },
    en: {
        title: 'MORE PEOPLE\nRUNNER', start: '▶  START',
        paused: '⏸  PAUSED', resume: '▶  CONTINUE', restart: '🔄  RESTART',
        gameOver: '💀  GAME OVER',
        bgmOn: '🎵 BGM: ON', bgmOff: '🎵 BGM: OFF',
        sfxOn: '🔊 SFX: ON', sfxOff: '🔊 SFX: OFF',
        vibOn: '📳 Vib: ON', vibOff: '📳 Vib: OFF',
        lang: '🌐 中文',
        dist: 'Dist', best: 'Best',
        crowd: 'Crowd', maxCrowd: 'Max Crowd',
    }
};
type LangKey = keyof typeof L;

@ccclass('UIManager')
export class UIManager extends Component {

    private static _instance: UIManager | null = null;
    public static get instance(): UIManager | null { return UIManager._instance; }

    // Global game state (static = survives across scene reloads)
    public static isPlaying: boolean = false;
    public static isRestarting: boolean = false;
    public static lang: LangKey = 'cn';

    private _whiteSF: SpriteFrame | null = null;
    private _canvas: Node | null = null;
    private _startMenu: Node | null = null;
    private _gameHUD: Node | null = null;
    private _pauseMenu: Node | null = null;
    private _gameOverMenu: Node | null = null;
    private _distanceLabel: Label | null = null;
    private _crowdStatsLabel: Label | null = null;

    // Game Over Labels
    private _goDistanceLabel: Label | null = null;
    private _goBestDistLabel: Label | null = null;
    private _goMaxCrowdLabel: Label | null = null;

    // Store label refs for language refresh
    private _labelRefs: { node: Node, key: string }[] = [];

    onLoad() {
        UIManager._instance = this;
        this._whiteSF = this.mkSF();
        this.setupCanvas();
        this.buildStartMenu();
        this.buildGameHUD();
        this.buildPauseMenu();
        this.buildGameOverMenu();

        if (UIManager.isRestarting) {
            UIManager.isRestarting = false;
            this.doStartGame();
        } else {
            this.showStartMenu();
        }
    }

    onDestroy() { if (UIManager._instance === this) UIManager._instance = null; }

    // ========== Canvas Setup ==========

    private mkSF(): SpriteFrame {
        const tex = new Texture2D();
        tex.reset({ width: 2, height: 2, format: Texture2D.PixelFormat.RGBA8888 });
        tex.uploadData(new Uint8Array(16).fill(255));
        const sf = new SpriteFrame(); sf.texture = tex; return sf;
    }

    private setupCanvas() {
        const scene = director.getScene()!;
        const existing = scene.getComponentInChildren(Canvas);
        if (existing) {
            this._canvas = existing.node;
            console.log('UIManager: Found existing Canvas.');
            // Ensure it has a widget to fill screen? Usually Canvas does.
            return;
        }

        console.log('UIManager: Creating new Canvas.');
        this._canvas = new Node('GameUI');
        this._canvas.layer = Layers.Enum.UI_2D;
        const t = this._canvas.addComponent(UITransform);
        const vs = view.getVisibleSize();
        t.setContentSize(vs.width, vs.height);

        // Add Widget to fill window
        const w = this._canvas.addComponent(Widget);
        w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
        w.top = w.bottom = w.left = w.right = 0;

        const c = this._canvas.addComponent(Canvas);
        const camN = new Node('UICam');
        camN.layer = Layers.Enum.UI_2D;
        camN.setParent(this._canvas);
        const cam = camN.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.visibility = Layers.Enum.UI_2D;
        cam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        cam.priority = 1000;
        c.cameraComponent = cam;
        this._canvas.setParent(scene);
    }

    // ========== UI Helpers ==========

    private rect(p: Node, n: string, w: number, h: number, col: Color): Node {
        const nd = new Node(n); nd.layer = Layers.Enum.UI_2D; nd.setParent(p);
        nd.addComponent(UITransform).setContentSize(w, h);
        const sp = nd.addComponent(Sprite);
        sp.type = Sprite.Type.SIMPLE; sp.sizeMode = Sprite.SizeMode.CUSTOM;
        if (this._whiteSF) sp.spriteFrame = this._whiteSF;
        sp.color = col; return nd;
    }

    // ========== Build Screens ==========

    private buildStartMenu() {
        // Fullscreen Widget
        this._startMenu = this.rect(this._canvas!, 'SM', 100, 100, new Color(20, 20, 40, 220));
        const w = this._startMenu.addComponent(Widget);
        w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
        w.top = w.bottom = w.left = w.right = 0;

        this.lbl(this._startMenu, 'T', this.t('title'), 72, Color.WHITE, 180, 'title');
        this.btn(this._startMenu, 'Go', this.t('start'), 320, 70, new Color(50, 180, 80), Color.WHITE, 40, () => this.doStartGame(), 'start');
        this.btn(this._startMenu, 'Bgm', this.bgmText(), 260, 55, new Color(60, 60, 90), Color.WHITE, -50, () => this.togBGM('SM'));
        this.btn(this._startMenu, 'Sfx', this.sfxText(), 260, 55, new Color(60, 60, 90), Color.WHITE, -120, () => this.togSFX('SM'));
        this.btn(this._startMenu, 'Vib', this.vibText(), 260, 55, new Color(60, 60, 90), Color.WHITE, -190, () => this.togVib('SM'));
        this.btn(this._startMenu, 'Lng', this.t('lang'), 260, 55, new Color(60, 60, 90), Color.WHITE, -260, () => this.togLang(), 'lang');
    }

    private buildGameHUD() {
        this._gameHUD = new Node('HUD'); this._gameHUD.layer = Layers.Enum.UI_2D;
        this._gameHUD.setParent(this._canvas!);
        this._gameHUD.addComponent(UITransform);
        // Fullscreen Widget
        const w = this._gameHUD.addComponent(Widget);
        w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
        w.top = w.bottom = w.left = w.right = 0;

        this._gameHUD.active = false;

        // Pause button (Top Right, using Widget)
        const pb = this.rect(this._gameHUD, 'Pau', 80, 80, new Color(0, 0, 0, 150)); // Semi-transparent black bg

        // Ensure PB is Top-Most sibling
        pb.setSiblingIndex(999);

        const pbW = pb.addComponent(Widget);
        pbW.isAlignTop = true; pbW.isAlignRight = true;
        pbW.top = 30; pbW.right = 30; // Increased margin slightly

        const lblN = new Node('L');
        lblN.layer = Layers.Enum.UI_2D;
        lblN.setParent(pb);
        lblN.addComponent(UITransform);

        const lb = lblN.addComponent(Label);
        lb.string = 'II';
        lb.fontSize = 40; lb.lineHeight = 80; // Slightly smaller font to fit in circle/box
        lb.color = Color.WHITE;
        lb.horizontalAlign = Label.HorizontalAlign.CENTER;
        lb.verticalAlign = Label.VerticalAlign.CENTER;
        lb.isBold = true;

        // Add Outline
        const outline = lblN.addComponent(LabelOutline);
        outline.color = new Color(0, 0, 0, 255);
        outline.width = 2;

        const b = pb.addComponent(Button);
        b.transition = Button.Transition.SCALE; b.zoomScale = 0.9;
        pb.on('click', () => this.showPauseMenu(), this);

        // Distance & Stats (Top Left, using Widget container)
        const statsPanel = new Node('Stats');
        statsPanel.layer = Layers.Enum.UI_2D;
        statsPanel.setParent(this._gameHUD);
        statsPanel.addComponent(UITransform);
        const spW = statsPanel.addComponent(Widget);
        spW.isAlignTop = true; spW.isAlignLeft = true;
        // User Request: "More into the corner"
        spW.top = 10; spW.left = 15; // Tighter corner position

        // Distance
        this._distanceLabel = this.lbl(statsPanel, 'Dist', '', 32, Color.WHITE, 0);
        this._distanceLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this._distanceLabel.getComponent(UITransform)?.setAnchorPoint(0, 1);
        this._distanceLabel.node.setPosition(0, 0);

        // Crowd (Moved up to stick closer to Distance)
        // User Fix: Moved to -80 to avoid overlap with multi-line Distance label (Dist + Best)
        this._crowdStatsLabel = this.lbl(statsPanel, 'Crowd', '', 28, new Color(200, 255, 200), -80);
        this._crowdStatsLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this._crowdStatsLabel.getComponent(UITransform)?.setAnchorPoint(0, 1);
        this._crowdStatsLabel.node.setPosition(0, -80); // Tighter packing but enough for 2 lines above
    }

    private buildPauseMenu() {
        this._pauseMenu = this.rect(this._canvas!, 'PM', 100, 100, new Color(0, 0, 0, 180));
        const w = this._pauseMenu.addComponent(Widget);
        w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
        w.top = w.bottom = w.left = w.right = 0;

        this._pauseMenu.active = false;
        this.lbl(this._pauseMenu, 'T', this.t('paused'), 56, Color.WHITE, 220, 'paused');
        this.btn(this._pauseMenu, 'Res', this.t('resume'), 300, 65, new Color(50, 180, 80), Color.WHITE, 110, () => this.doResume(), 'resume');
        this.btn(this._pauseMenu, 'Rst', this.t('restart'), 300, 65, new Color(200, 70, 70), Color.WHITE, 30, () => this.doRestart(), 'restart');
        this.btn(this._pauseMenu, 'Bgm', this.bgmText(), 260, 55, new Color(60, 60, 90), Color.WHITE, -50, () => this.togBGM('PM'));
        this.btn(this._pauseMenu, 'Sfx', this.sfxText(), 260, 55, new Color(60, 60, 90), Color.WHITE, -120, () => this.togSFX('PM'));
        this.btn(this._pauseMenu, 'Vib', this.vibText(), 260, 55, new Color(60, 60, 90), Color.WHITE, -190, () => this.togVib('PM'));
        this.btn(this._pauseMenu, 'Lng', this.t('lang'), 260, 55, new Color(60, 60, 90), Color.WHITE, -260, () => this.togLang(), 'lang');
    }

    private buildGameOverMenu() {
        this._gameOverMenu = this.rect(this._canvas!, 'GO', 100, 100, new Color(30, 10, 10, 230));
        const w = this._gameOverMenu.addComponent(Widget);
        w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
        w.top = w.bottom = w.left = w.right = 0;

        this._gameOverMenu.active = false;

        this.lbl(this._gameOverMenu, 'T', this.t('gameOver'), 64, new Color(255, 80, 80), 200, 'gameOver');

        // Stats
        this._goDistanceLabel = this.lbl(this._gameOverMenu, 'CurDist', '', 40, Color.WHITE, 80);
        this._goBestDistLabel = this.lbl(this._gameOverMenu, 'BestDist', '', 30, new Color(255, 220, 0), 30);
        this._goMaxCrowdLabel = this.lbl(this._gameOverMenu, 'MaxCrowd', '', 30, new Color(100, 255, 100), -20);

        this.btn(this._gameOverMenu, 'Rst', this.t('restart'), 320, 80, new Color(200, 70, 70), Color.WHITE, -120, () => this.doRestart(), 'restart');
    }

    // ========== Helpers for Manual Positioning inside Widgets ==========
    // Since we use manual positions inside the menus, that's fine as long as the Menus themselves are centered/stretched.
    // The previous implementation used offset from center (0, y, 0), which is correct for a centered parent.

    private lbl(p: Node, n: string, text: string, sz: number, col: Color, y: number, langKey?: string): Label {
        const nd = new Node(n); nd.layer = Layers.Enum.UI_2D; nd.setParent(p);
        nd.addComponent(UITransform); nd.setPosition(0, y, 0);
        const lb = nd.addComponent(Label);
        lb.string = text; lb.fontSize = sz; lb.lineHeight = sz + 4;
        lb.color = col; lb.horizontalAlign = Label.HorizontalAlign.CENTER;
        lb.overflow = Label.Overflow.NONE;
        if (langKey) this._labelRefs.push({ node: nd, key: langKey });
        return lb;
    }

    private btn(p: Node, n: string, text: string, w: number, h: number,
        bg: Color, fg: Color, y: number, cb: () => void, langKey?: string): Node {
        const nd = this.rect(p, n, w, h, bg);
        nd.setPosition(0, y, 0);
        const lblN = new Node('L'); lblN.layer = Layers.Enum.UI_2D; lblN.setParent(nd);
        lblN.addComponent(UITransform);
        const lb = lblN.addComponent(Label);
        lb.string = text; lb.fontSize = Math.floor(h * 0.45); lb.lineHeight = h;
        lb.color = fg; lb.horizontalAlign = Label.HorizontalAlign.CENTER;
        lb.overflow = Label.Overflow.NONE;
        const b = nd.addComponent(Button);
        b.transition = Button.Transition.SCALE; b.zoomScale = 0.9;
        nd.on('click', cb, this);
        if (langKey) this._labelRefs.push({ node: lblN, key: langKey });
        return nd;
    }

    private t(key: string): string {
        const strings = L[UIManager.lang];
        return (strings as any)[key] ?? key;
    }

    // ========== Public API ==========

    public showStartMenu() {
        UIManager.isPlaying = false;
        this.setActive(true, false, false, false);
    }

    public showGameHUD() {
        this.setActive(false, true, false, false);
    }

    public showPauseMenu() {
        UIManager.isPlaying = false;
        if (this._pauseMenu) this._pauseMenu.active = true;
    }

    public showGameOver(_count: number) {
        console.log(`UIManager: showGameOver called. Count: ${_count}`);
        UIManager.isPlaying = false;
        this.setActive(false, false, false, true);

        // --- Distance Records ---
        const currentDist = TrackManager.instance ? Math.floor(TrackManager.instance.totalDistance) : 0;
        const savedBestDist = sys.localStorage.getItem('BestDist');
        let bestDist = savedBestDist ? parseInt(savedBestDist) : 0;

        if (currentDist > bestDist) {
            bestDist = currentDist;
            sys.localStorage.setItem('BestDist', bestDist.toString());
        }

        // --- Crowd Records ---
        const cm = CrowdManager.instance;
        const sessionMaxCrowd = cm ? cm.maxCrowdCount : _count;
        const savedMaxCrowd = sys.localStorage.getItem('MaxCrowd');
        let recordCrowd = savedMaxCrowd ? parseInt(savedMaxCrowd) : 0;

        if (sessionMaxCrowd > recordCrowd) {
            recordCrowd = sessionMaxCrowd;
            sys.localStorage.setItem('MaxCrowd', recordCrowd.toString());
        }

        // --- Update UI ---
        if (this._goDistanceLabel)
            this._goDistanceLabel.string = `${this.t('dist')}: ${currentDist}m`;

        if (this._goBestDistLabel)
            this._goBestDistLabel.string = `${this.t('best')}: ${bestDist}m`;

        if (this._goMaxCrowdLabel)
            this._goMaxCrowdLabel.string = `${this.t('maxCrowd')}: ${recordCrowd}`;
    }

    // Optimized: Dirty Checking
    private _lastDist: number = -1;
    private _lastMaxCrowd: string = '';

    update(deltaTime: number) {
        if (UIManager.isPlaying) {
            if (this._distanceLabel && TrackManager.instance) {
                const dist = Math.floor(TrackManager.instance.totalDistance);
                if (dist !== this._lastDist) {
                    this._lastDist = dist;
                    const savedBest = sys.localStorage.getItem('BestDist');
                    const best = savedBest ? savedBest : '0';
                    this._distanceLabel.string = `${this.t('dist')}: ${dist}m\n${this.t('best')}: ${best}m`;
                }
            }
            if (this._crowdStatsLabel) {
                // Crowd Max only updates externally or rarely, but let's check cache
                const savedMax = sys.localStorage.getItem('MaxCrowd');
                const max = savedMax ? savedMax : '0';
                if (max !== this._lastMaxCrowd) {
                    this._lastMaxCrowd = max;
                    this._crowdStatsLabel.string = `${this.t('maxCrowd')}: ${max}`;
                }
            }
        }
    }

    private setActive(sm: boolean, hud: boolean, pm: boolean, go: boolean) {
        console.log(`UIManager: setActive - SM:${sm}, HUD:${hud}, PM:${pm}, GO:${go}`);
        if (this._startMenu) this._startMenu.active = sm;
        if (this._gameHUD) this._gameHUD.active = hud;
        if (this._pauseMenu) this._pauseMenu.active = pm;
        if (this._gameOverMenu) this._gameOverMenu.active = go;
    }

    private doStartGame() {
        console.log('UIManager: doStartGame');
        UIManager.isPlaying = true;
        this.showGameHUD();
    }

    private doResume() {
        console.log('UIManager: doResume');
        UIManager.isPlaying = true;
        if (this._pauseMenu) this._pauseMenu.active = false;
    }

    private doRestart() {
        console.log('UIManager: doRestart');
        UIManager.isPlaying = false;
        UIManager.isRestarting = true;
        director.getScheduler().setTimeScale(1);
        director.loadScene('scene');
    }

    // ========== Toggle Helpers ==========

    private bgmText(): string { return AudioManager.bgmEnabled ? this.t('bgmOn') : this.t('bgmOff'); }
    private sfxText(): string { return AudioManager.sfxEnabled ? this.t('sfxOn') : this.t('sfxOff'); }
    private vibText(): string { return AudioManager.vibrationEnabled ? this.t('vibOn') : this.t('vibOff'); }

    private togBGM(screen: string) {
        AudioManager.instance?.toggleBGM();
        this.updateToggleLabel(screen, 'Bgm', this.bgmText());
    }
    private togSFX(screen: string) {
        AudioManager.instance?.toggleSFX();
        this.updateToggleLabel(screen, 'Sfx', this.sfxText());
    }
    private togVib(screen: string) {
        AudioManager.instance?.toggleVibration();
        this.updateToggleLabel(screen, 'Vib', this.vibText());
    }

    private togLang() {
        UIManager.lang = UIManager.lang === 'cn' ? 'en' : 'cn';
        this.rebuildAllUI();
    }

    private updateToggleLabel(screen: string, btnName: string, text: string) {
        const parent = screen === 'SM' ? this._startMenu : this._pauseMenu;
        if (!parent) return;
        const nd = parent.getChildByName(btnName);
        if (nd) { const lb = nd.getComponentInChildren(Label); if (lb) lb.string = text; }
    }

    private rebuildAllUI() {
        const wasPlaying = UIManager.isPlaying;
        const smActive = this._startMenu?.active ?? false;
        const hudActive = this._gameHUD?.active ?? false;
        const pmActive = this._pauseMenu?.active ?? false;
        const goActive = this._gameOverMenu?.active ?? false;

        if (this._startMenu) { this._startMenu.destroy(); this._startMenu = null; }
        if (this._gameHUD) { this._gameHUD.destroy(); this._gameHUD = null; }
        if (this._pauseMenu) { this._pauseMenu.destroy(); this._pauseMenu = null; }
        if (this._gameOverMenu) { this._gameOverMenu.destroy(); this._gameOverMenu = null; }
        this._labelRefs = [];

        this.buildStartMenu();
        this.buildGameHUD();
        this.buildPauseMenu();
        this.buildGameOverMenu();

        this.setActive(smActive, hudActive, pmActive, goActive);
        UIManager.isPlaying = wasPlaying;
    }
}
