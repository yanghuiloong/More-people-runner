import { _decorator, Component, AudioClip, AudioSource, director, input, Input, sys } from 'cc';
import { NativeUtils } from './NativeUtils';
const { ccclass, property } = _decorator;

@ccclass('AudioManager')
export class AudioManager extends Component {

    private static _instance: AudioManager | null = null;
    public static get instance(): AudioManager | null { return AudioManager._instance; }

    // Static settings — survive across scene reloads
    public static bgmEnabled: boolean = true;
    public static sfxEnabled: boolean = true;
    public static vibrationEnabled: boolean = true;

    @property({ type: AudioClip }) bgmClip: AudioClip | null = null;
    @property({ type: AudioClip }) addGateClip: AudioClip | null = null;
    @property({ type: AudioClip }) mulGateClip: AudioClip | null = null;
    @property({ type: AudioClip }) subGateClip: AudioClip | null = null;
    @property({ type: AudioClip }) divGateClip: AudioClip | null = null; // New Slot
    @property({ type: AudioClip }) hitClip: AudioClip | null = null;

    private _bgmSource: AudioSource | null = null;
    private _sfxSource: AudioSource | null = null;
    private _lastHitTime: number = 0;
    private readonly HIT_COOLDOWN_MS: number = 40; // Increased from 15ms to prevent buzz-saw effect
    private _bgmPending: boolean = false;

    // ... (onLoad, start, etc. unchanged) ...

    public playSound(clip: AudioClip | null) {
        if (!AudioManager.sfxEnabled || !this._sfxSource || !clip) return;
        this._sfxSource.playOneShot(clip);
    }

    onLoad() {
        if (AudioManager._instance && AudioManager._instance.node && AudioManager._instance.node.isValid) {
            this.node.destroy();
            return;
        }
        AudioManager._instance = this;
        director.addPersistRootNode(this.node);

        this._bgmSource = this.node.addComponent(AudioSource);
        this._sfxSource = this.node.addComponent(AudioSource);
        this._sfxSource.loop = false;
        this._sfxSource.volume = 0.8;
    }

    start() {
        if (AudioManager.bgmEnabled) this.tryPlayBGM();
        if (this._bgmSource && !this._bgmSource.playing) {
            this._bgmPending = true;
            input.on(Input.EventType.TOUCH_START, this._onFirstTouch, this);
        }
    }

    private _onFirstTouch() {
        input.off(Input.EventType.TOUCH_START, this._onFirstTouch, this);
        if (this._bgmPending) {
            this._bgmPending = false;
            if (AudioManager.bgmEnabled) this.tryPlayBGM();
        }
    }

    private tryPlayBGM() {
        if (this._bgmSource && this.bgmClip) {
            // Check if already playing the same clip to avoid restart
            if (this._bgmSource.playing && this._bgmSource.clip === this.bgmClip) {
                return;
            }
            this._bgmSource.clip = this.bgmClip;
            this._bgmSource.loop = true;
            this._bgmSource.volume = 0.5;
            this._bgmSource.play();
        }
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this._onFirstTouch, this);
        if (AudioManager._instance === this) AudioManager._instance = null;
    }

    // ========== SFX ==========

    public playGateSound(mathType: string) {
        if (!AudioManager.sfxEnabled || !this._sfxSource) return;
        let clip: AudioClip | null = null;
        if (mathType === 'x') clip = this.mulGateClip;
        else if (mathType === '-') clip = this.subGateClip ?? this.hitClip;
        else if (mathType === '/') clip = this.divGateClip ?? this.subGateClip; // Fallback to Sub if missing
        else clip = this.addGateClip;

        if (clip) this._sfxSource.playOneShot(clip);

        // Stronger vibration for gates (User Request: "Strong vibration")
        // 80ms is noticeably distinct from UI taps
        this.vibrateShort(80);
    }

    public playHitSound() {
        if (!AudioManager.sfxEnabled) return;
        const now = Date.now();
        if (now - this._lastHitTime < this.HIT_COOLDOWN_MS) return;
        this._lastHitTime = now;
        if (this._sfxSource && this.hitClip) this._sfxSource.playOneShot(this.hitClip);

        // Combat Hit: Even stronger vibration
        this.vibrateShort(120);
    }

    // ========== Toggles ==========

    public toggleBGM(): boolean {
        AudioManager.bgmEnabled = !AudioManager.bgmEnabled;
        if (AudioManager.bgmEnabled) this.tryPlayBGM();
        else if (this._bgmSource) this._bgmSource.stop();
        return AudioManager.bgmEnabled;
    }

    public toggleSFX(): boolean {
        AudioManager.sfxEnabled = !AudioManager.sfxEnabled;
        return AudioManager.sfxEnabled;
    }

    public toggleVibration(): boolean {
        AudioManager.vibrationEnabled = !AudioManager.vibrationEnabled;
        return AudioManager.vibrationEnabled;
    }

    public stopBGM() { if (this._bgmSource) this._bgmSource.stop(); }
    public resumeBGM() {
        if (AudioManager.bgmEnabled && this._bgmSource && this.bgmClip && !this._bgmSource.playing) {
            this._bgmSource.play();
        }
    }

    // ========== Vibration (independent toggle) ==========

    private vibrateShort(durationMs: number) {
        if (!AudioManager.vibrationEnabled) return;

        // NATIVE ANDROID FIX:
        // Physical vibration motors have "spin-up" latency.
        // Extremely short durations (like 15ms) often fail to produce any sensation on native devices.
        // We clamp the minimum duration for Native platforms to ensure feedback.
        if (sys.isNative && sys.os === sys.OS.ANDROID) {
            if (durationMs < 40) durationMs = 40;
        }

        try {
            // Use JNI helper for Android Native, Navigator for Web
            NativeUtils.vibrate(durationMs);
        } catch (e) {
            // Fallback or ignore
        }
    }
}
