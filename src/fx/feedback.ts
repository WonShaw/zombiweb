import * as THREE from 'three';
import type { Game } from '../game';
import type { Zombie, DamageSource } from '../entities/zombies';
import type { HitPart } from '../entities/zombieModel';

export type KillKind = 'normal' | 'head' | 'knife' | 'explosive' | 'lightning';

/** 击杀图标（24×24 的内联 SVG） */
const SKULL =
  'M12 2a9 8.5 0 0 0-9 8.5c0 2.6 1.3 4.5 3 5.6V20h3v-2h2v2h2v-2h2v2h3v-3.9c1.7-1.1 3-3 3-5.6A9 8.5 0 0 0 12 2zM8.5 9.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 13.5l1.2 2h-2.4z';
const ICONS: Record<KillKind, string> = {
  normal: `<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="${SKULL}"/></svg>`,
  head: `<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="${SKULL}"/><circle class="ring" cx="12" cy="11" r="10.5"/><path class="ring" d="M12 -1v5M12 18v6M-1 11h5M20 11h5"/></svg>`,
  knife: `<svg viewBox="0 0 24 24"><path d="M3.5 20.5l5.5-5.5 1.8 1.8-5.5 5.5zM10 14L21 3c.9 2.6.2 5.2-1.8 7.2L12 17.2z"/></svg>`,
  explosive: `<svg viewBox="0 0 24 24"><polygon points="12,1 14.5,8 22,6 16.5,11.5 23,16 15,15.5 13,23 10.5,16 3,19 7.5,12.5 1,8 9,8.5"/></svg>`,
  lightning: `<svg viewBox="0 0 24 24"><polygon points="13,1 4,14 11,14 9,23 20,9 13,9"/></svg>`,
};

const STREAK_ZH = ['', '', '双杀', '三杀', '四杀', '五杀', '六杀', '七杀'];
const STREAK_EN = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTI KILL', 'MEGA KILL', 'ULTRA KILL', 'MONSTER KILL'];
/** 两次击杀间隔在这个时间内算连杀 */
const STREAK_WINDOW = 3.5;
/** 连杀奖励：双杀起每多一杀 +20，封顶 +100 */
const STREAK_BONUS_STEP = 20;
const STREAK_BONUS_MAX = 100;
const MAX_ICONS = 8;

interface Num {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
  value: number;
  zombie: Zombie | null;
  dx: number;
  scale: number;
  active: boolean;
}

/**
 * 打击反馈：伤害数字、屏幕中下方的击杀图标 / 连杀徽章、命中与击杀音效、连杀奖励积分。
 * 只有玩家自己造成的击杀才计入连杀（自动机枪、电网只显示小号伤害数字）。
 */
export class Feedback {
  showNumbers = true;
  private layer = document.getElementById('dmgnums')!;
  private banner = document.getElementById('killbanner')!;
  private bannerIcons = document.getElementById('kb-icons')!;
  private bannerLabel = document.getElementById('kb-label')!;
  private bannerSub = document.getElementById('kb-sub')!;
  private bannerBonus = document.getElementById('kb-bonus')!;
  private pool: Num[] = [];
  private streak = 0;
  private sinceKill = 99;
  private lastHitSound = 0;
  private frameKills = 0;
  private frameHead = false;
  private announced = 0;
  private tmp = new THREE.Vector3();

  constructor(private game: Game) {
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.style.opacity = '0';
      this.layer.appendChild(el);
      this.pool.push({ el, pos: new THREE.Vector3(), age: 0, life: 1, value: 0, zombie: null, dx: 0, scale: 1, active: false });
    }
  }

  /** 由 ZombieManager.damage 在每次伤害后调用 */
  onDamage(z: Zombie, dmg: number, part: HitPart, source: DamageSource, killed: boolean, point?: THREE.Vector3, kind?: KillKind) {
    if (source === 'nuke') return;
    const byPlayer = source === 'bullet' || source === 'melee' || source === 'explosive';
    if (this.showNumbers) this.addNumber(z, dmg, part, source, killed, point);
    if (!byPlayer) return;
    const now = this.game.time;
    if (!killed) {
      if (now - this.lastHitSound > 0.045) {
        this.lastHitSound = now;
        this.game.audio.hitConfirm(part === 'head');
      }
      return;
    }
    const k: KillKind = kind ?? (source === 'melee' ? 'knife' : source === 'explosive' ? 'explosive' : part === 'head' ? 'head' : 'normal');
    this.onKill(k);
  }

  private onKill(kind: KillKind) {
    this.streak = this.sinceKill < STREAK_WINDOW ? this.streak + 1 : 1;
    if (this.streak === 1) this.announced = 1;
    this.sinceKill = 0;
    this.frameKills++;
    if (kind === 'head') this.frameHead = true;

    // 新图标
    const icon = document.createElement('i');
    icon.className = `kb-icon k-${kind}`;
    icon.innerHTML = ICONS[kind];
    if (this.streak === 1) this.bannerIcons.innerHTML = '';
    this.bannerIcons.appendChild(icon);
    while (this.bannerIcons.children.length > MAX_ICONS) this.bannerIcons.firstElementChild!.remove();

    const n = this.streak;
    let zh = '';
    let en = '';
    if (n >= 2) {
      zh = n < STREAK_ZH.length ? STREAK_ZH[n] : `${n} 连杀`;
      en = n < STREAK_EN.length ? STREAK_EN[n] : n >= 15 ? 'GODLIKE' : 'UNSTOPPABLE';
    } else if (kind === 'head') {
      zh = '爆头';
      en = 'HEADSHOT';
    } else if (kind === 'knife') {
      zh = '刀杀';
      en = 'KNIFE KILL';
    }
    this.bannerLabel.textContent = zh;
    this.bannerSub.textContent = en;
    // 连杀奖励积分（双倍积分期间也翻倍，显示实际到账的数）
    const bonus = n >= 2 ? Math.min((n - 1) * STREAK_BONUS_STEP, STREAK_BONUS_MAX) : 0;
    this.bannerBonus.textContent = bonus ? `连杀奖励 +${this.game.addPoints(bonus)}` : '';
    this.banner.className = `show tier-${Math.min(n, 8)}${kind === 'head' ? ' head' : ''}`;
    // 重新触发弹出动画
    void this.banner.offsetWidth;
    this.banner.classList.add('pop');
    this.game.hud.hitmarker(true, kind === 'head');
  }

  private addNumber(z: Zombie, dmg: number, part: HitPart, source: DamageSource, killed: boolean, point?: THREE.Vector3) {
    const value = Math.round(Math.min(dmg, 99999));
    if (value <= 0) return;
    // 同一只丧尸在极短时间内的多次命中（霰弹枪弹丸）合并成一个数字
    const merge = this.pool.find((n) => n.active && n.zombie === z && n.age < 0.07);
    let cls = 'dmg';
    if (source === 'turret') cls += ' d-turret';
    else if (source === 'trap') cls += ' d-trap';
    else if (source === 'explosive') cls += ' d-exp';
    else if (part === 'head') cls += ' d-head';
    else if (part === 'limb') cls += ' d-limb';
    if (killed) cls += ' d-kill';
    const small = source === 'turret' || source === 'trap';
    if (merge) {
      merge.value += value;
      merge.el.textContent = String(merge.value);
      merge.el.className = cls;
      merge.age = 0;
      merge.scale = killed ? 1.9 : 1.5;
      return;
    }
    let n = this.pool.find((q) => !q.active);
    if (!n) n = this.pool.reduce((a, b) => (a.age > b.age ? a : b));
    n.active = true;
    n.zombie = z;
    n.value = value;
    n.age = 0;
    n.life = small ? 0.6 : 0.95;
    n.dx = (Math.random() - 0.5) * 60;
    n.scale = killed ? 1.9 : part === 'head' ? 1.7 : 1.45;
    if (point) n.pos.copy(point);
    else n.pos.set(z.pos.x, z.pos.y + (part === 'head' ? 1.65 : 1.25), z.pos.z);
    n.el.className = cls;
    n.el.textContent = String(value);
  }

  update(dt: number) {
    const g = this.game;
    // 本帧的击杀音效只播一次，避免一发火箭炸死五只时声音叠成一团
    if (this.frameKills > 0) {
      g.audio.killConfirm(this.streak, this.frameHead);
      if (this.streak >= 2 && this.streak > this.announced) {
        g.audio.multiKill(this.streak);
        this.announced = this.streak;
      }
      this.frameKills = 0;
      this.frameHead = false;
    }
    this.sinceKill += dt;
    if (this.sinceKill > STREAK_WINDOW && this.banner.classList.contains('show')) {
      this.banner.classList.remove('show', 'pop');
      this.streak = 0;
    }

    const cam = g.camera;
    const W = window.innerWidth, H = window.innerHeight;
    for (const n of this.pool) {
      if (!n.active) continue;
      n.age += dt;
      if (n.age >= n.life) {
        n.active = false;
        n.el.style.opacity = '0';
        continue;
      }
      const t = n.age / n.life;
      this.tmp.copy(n.pos);
      this.tmp.y += t * 0.55;
      this.tmp.project(cam);
      if (this.tmp.z > 1) {
        n.el.style.opacity = '0';
        continue;
      }
      const x = (this.tmp.x * 0.5 + 0.5) * W + n.dx * t;
      const y = (-this.tmp.y * 0.5 + 0.5) * H;
      // 先弹大再缩回，最后淡出
      const pop = n.age < 0.1 ? n.scale - (n.scale - 1) * (n.age / 0.1) : 1;
      n.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${pop.toFixed(3)})`;
      n.el.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
    }
  }
}
