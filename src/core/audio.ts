import * as THREE from 'three';
import { rand } from './util';

/** 每把枪的枪声合成参数 */
export interface ShotSound {
  freq: number; // 噪声低通起始频率，越高越“脆”
  decay: number; // 衰减时长
  thump: number; // 低频冲击起始频率
  vol: number;
  zap?: boolean; // 射线枪
}

interface NoiseOpts {
  type: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  vol: number;
  attack?: number;
}
interface ToneOpts {
  type: OscillatorType;
  f0: number;
  f1?: number;
  vol: number;
  attack?: number;
}

/**
 * 全部音效都用 Web Audio 实时合成，不依赖任何音频文件。
 * 带位置的音效走 HRTF 立体声定位，能听出丧尸从哪边来。
 */
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private volume = 0.8;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    comp.connect(this.master);
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(comp);
    this.music = ctx.createGain();
    this.music.gain.value = 0.8;
    this.music.connect(comp);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.startAmbient();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  suspend(on: boolean) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend();
    else this.ctx.resume();
  }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // ---------- 底层工具 ----------

  private out(pos?: THREE.Vector3 | null, gain = 1, bus?: GainNode): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const target = bus ?? this.sfx;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 2.5;
      p.maxDistance = 80;
      p.rolloffFactor = 1.3;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      p.connect(target);
    } else g.connect(target);
    return g;
  }

  private noise(t0: number, dur: number, out: AudioNode, o: NoiseOpts) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    const a = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(o.vol, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  private tone(t0: number, dur: number, out: AudioNode, o: ToneOpts) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
    const g = ctx.createGain();
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(o.vol, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private get now() {
    return this.ctx!.currentTime;
  }

  // ---------- 武器 ----------

  shot(s: ShotSound, pos?: THREE.Vector3 | null) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, 1);
    if (s.zap) {
      this.tone(t, 0.3, out, { type: 'sawtooth', f0: 1800, f1: 160, vol: 0.22 * s.vol });
      this.tone(t, 0.22, out, { type: 'square', f0: 950, f1: 110, vol: 0.1 * s.vol });
      this.noise(t, 0.14, out, { type: 'bandpass', f0: 3200, f1: 700, q: 2, vol: 0.25 * s.vol });
      return;
    }
    this.noise(t, s.decay, out, { type: 'lowpass', f0: s.freq, f1: Math.max(180, s.freq * 0.12), q: 0.9, vol: s.vol });
    this.noise(t, 0.045, out, { type: 'highpass', f0: 3500, vol: s.vol * 0.45 });
    this.tone(t, 0.16, out, { type: 'sine', f0: s.thump, f1: 36, vol: s.vol * 0.95 });
    // 室内回响尾音
    this.noise(t + 0.04, s.decay * 2.2, out, { type: 'lowpass', f0: 700, f1: 140, vol: s.vol * 0.14, attack: 0.04 });
  }

  /** 换弹声：0 退弹匣 1 插弹匣 2 拉栓；pos 为空时是玩家自己的枪 */
  reload(kind: 0 | 1 | 2, pos?: THREE.Vector3) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos ? new THREE.Vector3(pos.x, 1, pos.z) : null, 1);
    if (kind === 0) {
      this.noise(t, 0.06, out, { type: 'bandpass', f0: 1800, q: 3, vol: 0.3 });
      this.tone(t, 0.04, out, { type: 'square', f0: 700, f1: 300, vol: 0.04 });
    } else if (kind === 1) {
      this.noise(t, 0.08, out, { type: 'bandpass', f0: 1100, q: 2, vol: 0.45 });
      this.tone(t, 0.06, out, { type: 'triangle', f0: 260, f1: 180, vol: 0.12 });
    } else {
      this.noise(t, 0.04, out, { type: 'bandpass', f0: 2600, q: 3, vol: 0.35 });
      this.noise(t + 0.09, 0.05, out, { type: 'bandpass', f0: 1500, q: 3, vol: 0.4 });
    }
  }

  dryFire() {
    if (!this.ctx) return;
    this.noise(this.now, 0.035, this.out(null), { type: 'highpass', f0: 3000, vol: 0.25 });
  }

  knifeSwing() {
    if (!this.ctx) return;
    this.noise(this.now, 0.22, this.out(null), { type: 'bandpass', f0: 500, f1: 2600, q: 1.5, vol: 0.28, attack: 0.06 });
  }

  fleshHit(pos: THREE.Vector3, heavy = false) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, 1);
    this.tone(t, 0.14, out, { type: 'sine', f0: heavy ? 140 : 110, f1: 45, vol: 0.45 });
    this.noise(t, 0.12, out, { type: 'bandpass', f0: 700, q: 1, vol: 0.35 });
  }

  headshot(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, 1);
    this.noise(t, 0.25, out, { type: 'bandpass', f0: 1600, f1: 350, q: 1.2, vol: 0.55 });
    this.tone(t, 0.12, out, { type: 'sine', f0: 160, f1: 50, vol: 0.5 });
  }

  explosion(pos: THREE.Vector3 | null, big = false) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, big ? 1.4 : 1);
    this.noise(t, big ? 2.2 : 0.9, out, { type: 'lowpass', f0: 1400, f1: 70, vol: 0.9 });
    this.tone(t, big ? 1.6 : 0.7, out, { type: 'sine', f0: 75, f1: 24, vol: 0.9 });
    this.noise(t, 0.06, out, { type: 'highpass', f0: 2500, vol: 0.4 });
  }

  // ---------- 丧尸 ----------

  groan(pos: THREE.Vector3, pitch: number, sprinter: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now;
    const dur = sprinter ? rand(0.45, 0.85) : rand(0.9, 1.9);
    const out = this.out(pos, sprinter ? 0.8 : 1);
    const f0 = (sprinter ? 175 : 82) * pitch;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 1.18, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.78, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rand(4, 8);
    const lfoG = ctx.createGain();
    lfoG.gain.value = f0 * 0.07;
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = (sprinter ? 950 : 520) * pitch;
    bp1.Q.value = 5;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = (sprinter ? 2200 : 1150) * pitch;
    bp2.Q.value = 7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + dur * 0.28);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    osc.connect(bp1);
    osc.connect(bp2);
    bp1.connect(g);
    bp2.connect(g2);
    g2.connect(g);
    g.connect(out);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
    this.noise(t, dur, out, { type: 'bandpass', f0: 900, q: 0.8, vol: 0.07, attack: dur * 0.3 });
  }

  zombieSwipe(pos: THREE.Vector3) {
    if (!this.ctx) return;
    this.noise(this.now, 0.2, this.out(pos), { type: 'bandpass', f0: 900, f1: 280, q: 1.2, vol: 0.35, attack: 0.03 });
  }

  rise(pos: THREE.Vector3) {
    if (!this.ctx) return;
    this.noise(this.now, 0.9, this.out(pos), { type: 'lowpass', f0: 260, f1: 90, vol: 0.35, attack: 0.1 });
  }

  // ---------- 玩家 ----------

  playerHurt() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null);
    this.tone(t, 0.28, out, { type: 'sine', f0: 130, f1: 42, vol: 0.8 });
    this.noise(t, 0.2, out, { type: 'lowpass', f0: 600, vol: 0.5 });
    this.noise(t, 0.14, out, { type: 'bandpass', f0: 1500, q: 1.5, vol: 0.25 });
  }

  heartbeat() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null);
    this.tone(t, 0.14, out, { type: 'sine', f0: 58, f1: 40, vol: 0.55 });
    this.tone(t + 0.2, 0.14, out, { type: 'sine', f0: 52, f1: 38, vol: 0.4 });
  }

  footstep() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null);
    this.noise(t, 0.09, out, { type: 'lowpass', f0: 420, vol: 0.09 });
    this.tone(t, 0.06, out, { type: 'sine', f0: 90, f1: 50, vol: 0.05 });
  }

  jumpLand() {
    if (!this.ctx) return;
    this.noise(this.now, 0.14, this.out(null), { type: 'lowpass', f0: 300, vol: 0.18 });
  }

  // ---------- 场景交互 ----------

  woodBreak(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos);
    this.noise(t, 0.22, out, { type: 'bandpass', f0: 1100, q: 1.5, vol: 0.6 });
    this.noise(t + 0.03, 0.35, out, { type: 'bandpass', f0: 420, q: 1, vol: 0.4 });
    this.tone(t, 0.12, out, { type: 'sine', f0: 95, f1: 50, vol: 0.35 });
    for (let i = 0; i < 3; i++) this.noise(t + rand(0.02, 0.2), 0.02, out, { type: 'highpass', f0: 2500, vol: 0.25 });
  }

  hammer(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos);
    for (const dt of [0, 0.16]) {
      this.tone(t + dt, 0.07, out, { type: 'sine', f0: 430, f1: 250, vol: 0.4 });
      this.noise(t + dt, 0.05, out, { type: 'bandpass', f0: 2000, q: 1.5, vol: 0.3 });
    }
  }

  purchase() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null);
    this.tone(t, 0.12, out, { type: 'sine', f0: 1318, vol: 0.22 });
    this.tone(t + 0.08, 0.25, out, { type: 'sine', f0: 1760, vol: 0.22 });
    this.tone(t, 0.05, out, { type: 'square', f0: 2637, vol: 0.04 });
    this.noise(t, 0.3, out, { type: 'highpass', f0: 6000, vol: 0.05 });
  }

  denied() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null);
    this.tone(t, 0.3, out, { type: 'square', f0: 140, vol: 0.1 });
    this.tone(t, 0.3, out, { type: 'square', f0: 148, vol: 0.1 });
  }

  doorOpen(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, 1.3);
    this.noise(t, 1.3, out, { type: 'lowpass', f0: 320, f1: 80, vol: 0.6, attack: 0.1 });
    this.tone(t, 0.7, out, { type: 'sawtooth', f0: 190, f1: 105, vol: 0.05, attack: 0.1 });
    this.tone(t + 0.9, 0.35, out, { type: 'sine', f0: 70, f1: 38, vol: 0.55 });
  }

  powerupSpawn(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, 1.2);
    [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(t + i * 0.07, 0.25, out, { type: 'triangle', f0: f, vol: 0.16 }));
  }

  powerupGrab() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1, this.music);
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(t + i * 0.06, 0.35, out, { type: 'sine', f0: f, vol: 0.22 }));
    this.tone(t, 0.8, out, { type: 'triangle', f0: 131, vol: 0.2 });
  }

  perkDrink() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null);
    for (const dt of [0.1, 0.38, 0.66]) this.tone(t + dt, 0.12, out, { type: 'sine', f0: 190, f1: 85, vol: 0.3 });
    const m = this.out(null, 1, this.music);
    [392, 494, 587, 784].forEach((f, i) => this.tone(t + 1.05 + i * 0.1, 0.4, m, { type: 'triangle', f0: f, vol: 0.16 }));
  }

  boxJingle(duration: number) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1, this.music);
    const scale = [523, 587, 659, 784, 880, 1046, 1175, 1318];
    const n = Math.floor(duration / 0.22);
    for (let i = 0; i < n; i++) {
      const f = scale[(i * 3 + (i % 4)) % scale.length];
      this.tone(t + i * 0.22, 0.35, out, { type: 'triangle', f0: f, vol: 0.1 });
      if (i % 4 === 0) this.tone(t + i * 0.22, 0.5, out, { type: 'sine', f0: f / 2, vol: 0.07 });
    }
  }

  roundStart() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1, this.music);
    this.tone(t, 5, out, { type: 'sawtooth', f0: 55, vol: 0.05, attack: 0.8 });
    for (const f of [110, 130.8, 164.8]) this.tone(t + 0.1, 3.8, out, { type: 'triangle', f0: f, vol: 0.11, attack: 0.5 });
    this.tone(t, 3.2, out, { type: 'sine', f0: 440, vol: 0.14 });
    this.tone(t, 2.4, out, { type: 'sine', f0: 1113, vol: 0.05 });
    this.tone(t, 1.6, out, { type: 'sine', f0: 62, f1: 30, vol: 0.55 });
  }

  roundEnd() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1, this.music);
    [330, 311, 294, 262, 247].forEach((f, i) => {
      this.tone(t + i * 0.45, 0.8, out, { type: 'triangle', f0: f, vol: 0.13, attack: 0.03 });
      this.tone(t + i * 0.45, 0.8, out, { type: 'sine', f0: f / 2, vol: 0.08, attack: 0.03 });
    });
  }

  gameOver() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1, this.music);
    [220, 207.7, 196, 185, 174.6, 164.8].forEach((f, i) =>
      this.tone(t + i * 0.6, 1.4, out, { type: 'triangle', f0: f, vol: 0.14, attack: 0.05 }),
    );
    this.tone(t, 5, out, { type: 'sine', f0: 55, vol: 0.2, attack: 0.5 });
  }

  rocketLaunch() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1);
    this.noise(t, 0.7, out, { type: 'bandpass', f0: 400, f1: 1800, q: 0.8, vol: 0.6, attack: 0.02 });
    this.tone(t, 0.25, out, { type: 'sine', f0: 90, f1: 40, vol: 0.8 });
    this.noise(t, 0.08, out, { type: 'highpass', f0: 2000, vol: 0.4 });
  }

  /** 电弧噼啪声 */
  lightning(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, 1.2);
    for (let i = 0; i < 7; i++) this.noise(t + i * 0.035 + Math.random() * 0.02, 0.05, out, { type: 'highpass', f0: 2500, vol: 0.45 });
    this.tone(t, 0.35, out, { type: 'sawtooth', f0: 110, f1: 70, vol: 0.12 });
    this.tone(t, 0.2, out, { type: 'square', f0: 1400, f1: 300, vol: 0.05 });
  }

  /** 电网电击 */
  shockZap(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, 1.1);
    this.tone(t, 0.45, out, { type: 'sawtooth', f0: 120, vol: 0.18 });
    this.tone(t, 0.45, out, { type: 'square', f0: 240, vol: 0.06 });
    for (let i = 0; i < 5; i++) this.noise(t + i * 0.07, 0.05, out, { type: 'highpass', f0: 3000, vol: 0.35 });
  }

  /** 加固木板 / 钢板被拽时的撞击声 */
  boardRattle(pos: THREE.Vector3, steel: boolean) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos);
    if (steel) {
      this.tone(t, 0.45, out, { type: 'triangle', f0: 780, vol: 0.18 });
      this.tone(t, 0.35, out, { type: 'triangle', f0: 1270, vol: 0.1 });
      this.noise(t, 0.08, out, { type: 'bandpass', f0: 2500, q: 2, vol: 0.3 });
    } else {
      this.noise(t, 0.15, out, { type: 'bandpass', f0: 650, q: 1.5, vol: 0.45 });
      this.tone(t, 0.08, out, { type: 'sine', f0: 180, f1: 90, vol: 0.25 });
    }
  }

  carpenter() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null);
    for (let i = 0; i < 6; i++) {
      this.tone(t + i * 0.13, 0.07, out, { type: 'sine', f0: 430, f1: 250, vol: 0.35 });
      this.noise(t + i * 0.13, 0.05, out, { type: 'bandpass', f0: 2000, q: 1.5, vol: 0.25 });
    }
  }

  fireSale() {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1, this.music);
    [659, 784, 988, 1175, 988, 1319].forEach((f, i) => this.tone(t + i * 0.1, 0.2, out, { type: 'square', f0: f, vol: 0.06 }));
  }

  // ---------- 打击反馈 ----------

  /** 命中反馈：身体是闷闷的“噗”，爆头是清脆的金属“叮” */
  hitConfirm(head: boolean) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1);
    if (head) {
      this.tone(t, 0.12, out, { type: 'triangle', f0: 2400, vol: 0.14 });
      this.tone(t, 0.09, out, { type: 'sine', f0: 3650, vol: 0.08 });
      this.noise(t, 0.03, out, { type: 'highpass', f0: 5000, vol: 0.12 });
    } else {
      this.noise(t, 0.05, out, { type: 'bandpass', f0: 1300, q: 1.2, vol: 0.2 });
      this.tone(t, 0.06, out, { type: 'sine', f0: 320, f1: 160, vol: 0.14 });
    }
  }

  /** 击杀确认：低沉一击 + 铃声，连杀越多音调越高 */
  killConfirm(streak: number, head: boolean) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, 1);
    const step = Math.min(streak - 1, 7) * 2;
    const f = 784 * Math.pow(2, step / 12);
    this.tone(t, 0.2, out, { type: 'sine', f0: 170, f1: 55, vol: 0.55 });
    this.noise(t, 0.08, out, { type: 'lowpass', f0: 1800, vol: 0.25 });
    this.tone(t + 0.015, 0.55, out, { type: 'sine', f0: f, vol: 0.22 });
    this.tone(t + 0.015, 0.35, out, { type: 'sine', f0: f * 2.76, vol: 0.06 });
    this.tone(t + 0.015, 0.4, out, { type: 'triangle', f0: f * 1.5, vol: 0.07 });
    if (head) {
      this.noise(t, 0.05, out, { type: 'highpass', f0: 4000, vol: 0.35 });
      this.tone(t + 0.06, 0.45, out, { type: 'sine', f0: f * 2, vol: 0.12 });
    }
  }

  /** 连杀达成：随连杀数升高的和弦 + 下潜重低音 */
  multiKill(n: number) {
    if (!this.ctx) return;
    const t = this.now + 0.08;
    const out = this.out(null, 1, this.music);
    const root = 262 * Math.pow(2, (Math.min(n, 9) - 2) / 12 * 2);
    const notes = [1, 1.26, 1.5, 2].slice(0, Math.min(4, n));
    notes.forEach((r, i) => {
      this.tone(t + i * 0.055, 0.7, out, { type: 'sawtooth', f0: root * r, vol: 0.05 });
      this.tone(t + i * 0.055, 0.8, out, { type: 'triangle', f0: root * r * 2, vol: 0.07 });
    });
    this.tone(t, 0.6, out, { type: 'sine', f0: 110, f1: 40, vol: 0.45 });
    this.noise(t, 0.35, out, { type: 'bandpass', f0: 600, f1: 3000, q: 0.8, vol: 0.12, attack: 0.05 });
  }

  /** 风声 + 低频嗡鸣的环境音 */
  private startAmbient() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 220;
    lfo.connect(lfoG);
    lfoG.connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.06;
    src.connect(f);
    f.connect(g);
    g.connect(this.music);
    src.start();
    lfo.start();
    const hum = ctx.createOscillator();
    hum.frequency.value = 41;
    const hg = ctx.createGain();
    hg.gain.value = 0.035;
    hum.connect(hg);
    hg.connect(this.music);
    hum.start();
  }
}
