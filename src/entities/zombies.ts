import * as THREE from 'three';
import { ZombieModel, type HitPart, type SpeedType, type ZombieTier } from './zombieModel';
import type { Game } from '../game';
import type { WindowRT } from '../world/level';
import { SILL } from '../world/level';
import { rand, clamp, angleDiff, damp } from '../core/util';
import type { KillKind } from '../fx/feedback';

/** 伤害的附加信息：命中点（伤害数字位置）、击飞力度、击杀图标类型 */
export interface HitOpts {
  point?: THREE.Vector3;
  force?: number;
  kind?: KillKind;
}

type ZState = 'rising' | 'approach' | 'scaling' | 'tearing' | 'climbing' | 'chasing' | 'attacking' | 'dying';
export type DamageSource = 'bullet' | 'melee' | 'explosive' | 'nuke' | 'trap' | 'turret';

const ATTACK_DUR = 1.0;

/**
 * 三种丧尸。同一种丧尸的血量、攻击、移动速度、拆板速度都是固定的，不随回合变强；
 * 回合越高只是数量越多、精英和超精英的比例越高。
 */
export const TIERS: Record<ZombieTier, {
  name: string;
  desc: string;
  health: number;
  damage: number;
  speed: number;
  gait: SpeedType;
  /** 拽一下路障的间隔（秒） */
  tear: number;
  /** 击杀额外加分 */
  bonus: number;
  radius: number;
}> = {
  normal: { name: '普通丧尸', desc: '', health: 150, damage: 35, speed: 1.2, gait: 'walk', tear: 1.4, bonus: 0, radius: 0.28 },
  elite: { name: '精英丧尸', desc: '戴钢盔的士兵：血更厚、会跑、拆板更快', health: 700, damage: 50, speed: 2.7, gait: 'run', tear: 1.0, bonus: 40, radius: 0.3 },
  super: { name: '超精英丧尸', desc: '铁面具的巨汉：血极厚、冲刺、一爪很疼', health: 2500, damage: 75, speed: 4.2, gait: 'sprint', tear: 0.7, bonus: 100, radius: 0.33 },
};

/**
 * 各回合三种丧尸的比例：前 4 轮全是普通丧尸；第 5 轮开始出精英（每轮 +5%，最多 50%）；
 * 第 10 轮开始出超精英（每轮 +4%，最多 30%）
 */
export function tierMix(r: number) {
  const sup = clamp((r - 9) * 0.04, 0, 0.3);
  const elite = clamp((r - 4) * 0.05, 0, 0.5);
  return { normal: 1 - sup - elite, elite, super: sup };
}
function tierFor(r: number): ZombieTier {
  const m = tierMix(r);
  const x = Math.random();
  return x < m.super ? 'super' : x < m.super + m.elite ? 'elite' : 'normal';
}

export class Zombie {
  model: ZombieModel;
  pos = new THREE.Vector3();
  yaw = 0;
  health: number;
  maxHealth: number;
  speed: number;
  state: ZState = 'rising';
  st = 0;
  dead = false;
  remove = false;
  nukeT = -1;
  radius: number;
  type: SpeedType;
  private phase = rand(0, 6);
  private groanT = rand(1, 4);
  private steerT = 0;
  private target = new THREE.Vector3();
  private tearT = 0;
  private attackHit = false;
  private returnState: ZState = 'chasing';
  private deathDir = -1;
  private deathVel = new THREE.Vector3();
  private progressT = 0;
  private bestDist = Infinity;
  private climbFrom = new THREE.Vector3();
  private pitch = rand(0.85, 1.2);
  private moved = 0;
  private stunT = 0;
  /** 死亡时脚下的参考高度（决定尸体落到哪层） */
  private deathRef = 0;

  constructor(
    private game: Game,
    public win: WindowRT,
    spawn: THREE.Vector3,
    public tier: ZombieTier,
  ) {
    const t = TIERS[tier];
    this.health = t.health;
    this.maxHealth = t.health;
    this.speed = t.speed;
    this.type = t.gait;
    this.radius = t.radius;
    if (tier === 'super') this.pitch *= 0.72;
    else if (tier === 'elite') this.pitch *= 0.88;
    this.model = new ZombieModel(this, tier);
    this.model.setSilhouette(tier);
    // 白天地图：身上接收阴影（进了屋就暗下来）
    if (game.level.lab) {
      this.model.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.receiveShadow = true;
      });
    }
    this.model.root.rotation.order = 'YXZ';
    this.pos.copy(spawn);
    this.pos.y = -1.7;
    this.yaw = Math.atan2(win.climbBase.x - spawn.x, win.climbBase.z - spawn.z);
    game.scene.add(this.model.root);
    game.audio.rise(spawn);
    this.sync();
  }

  get collides() {
    return this.state === 'approach' || this.state === 'tearing' || this.state === 'chasing' || this.state === 'attacking';
  }
  /** 还在窗外（没翻进来）：被路障挡住时显示透视轮廓 */
  get outsideWindow() {
    return this.state === 'rising' || this.state === 'approach' || this.state === 'scaling' || this.state === 'tearing';
  }
  get inside() {
    return this.state === 'chasing' || this.state === 'attacking' && this.returnState === 'chasing';
  }
  get tearInterval() {
    return TIERS[this.tier].tear;
  }

  private setState(s: ZState) {
    this.state = s;
    this.st = 0;
    this.model.setSilhouette(this.outsideWindow ? this.tier : null);
    if (s === 'chasing') {
      this.bestDist = Infinity;
      this.progressT = 0;
      this.steerT = 0;
    }
  }

  /** face=false 时只挪位置不转身；离目标很近时也不转，避免被挤来挤去时原地打转 */
  private moveToward(tx: number, tz: number, speed: number, dt: number, face = true) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    if (face && d > 0.3) this.faceToward(dx, dz, dt, 9);
  }
  /** 平滑转身，并限制最大角速度（走路型约 200°/秒，冲刺型约 400°/秒） */
  private faceToward(dx: number, dz: number, dt: number, rate: number) {
    const want = Math.atan2(dx, dz);
    const maxTurn = (this.type === 'sprint' ? 7 : this.type === 'run' ? 5 : 3.5) * dt;
    this.yaw += clamp(angleDiff(this.yaw, want) * damp(rate, dt), -maxTurn, maxTurn);
  }

  /** 选择下一个移动目标：看得见玩家就直冲，否则沿流场“拉线”走（上下楼只能走楼梯） */
  private computeTarget() {
    const lvl = this.game.level;
    const pl = this.game.player;
    const p = pl.pos;
    const y = this.pos.y;
    if (Math.abs(pl.groundY - y) < 1.2 && lvl.segmentClear(this.pos.x, this.pos.z, p.x, p.z, 0.26, y, pl.groundY)) {
      this.target.set(p.x, pl.groundY, p.z);
      return;
    }
    let cur = lvl.nodeAt(this.pos.x, y, this.pos.z);
    let found = false;
    for (let k = 0; k < 6 && cur >= 0; k++) {
      const nb = lvl.bestNeighbor(cur);
      if (nb < 0) break;
      const c = lvl.nodeCell(nb);
      const nx = (c % lvl.w) + 0.5, nz = Math.floor(c / lvl.w) + 0.5, ny = lvl.nodeH(nb);
      if (k === 0 || lvl.segmentClear(this.pos.x, this.pos.z, nx, nz, 0.26, y, ny)) {
        this.target.set(nx, ny, nz);
        found = true;
        cur = nb;
      } else break;
    }
    if (!found) this.target.set(p.x, pl.groundY, p.z);
  }

  update(dt: number) {
    const g = this.game;
    this.st += dt;
    if (this.nukeT > 0) {
      this.nukeT -= dt;
      if (this.nukeT <= 0) g.zombies.damage(this, 1e9, 'torso', 'nuke');
    }
    if (this.state === 'dying') return this.updateDying(dt);
    if (this.stunT > 0) {
      // 被电网电住：原地定住（不抖动，方便瞄准）
      this.stunT -= dt;
      this.model.animate(this.phase, this.type, 'idle', this.st);
      this.sync();
      return;
    }

    const p = g.player.pos;
    const pdx = p.x - this.pos.x, pdz = p.z - this.pos.z;
    const pDist = Math.hypot(pdx, pdz);
    // 和玩家的高度差（楼上楼下够不着）
    const pdy = Math.abs(g.player.groundY - this.pos.y);
    let mode: 'move' | 'idle' | 'attack' | 'tear' | 'climb' | 'rise' | 'ladder' = 'idle';
    let animT = this.st;
    const before = this.pos.clone();

    switch (this.state) {
      case 'rising': {
        const t = Math.min(1, this.st / 1.3);
        this.pos.y = -1.7 * (1 - t) * (1 - t);
        mode = 'rise';
        if (t >= 1) {
          this.pos.y = 0;
          this.setState('approach');
        }
        break;
      }
      case 'approach': {
        // 一楼窗户直接走到窗外；二楼窗户先走到脚手架的梯子底下
        const o = this.win.climbBase;
        const d = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
        if (d < 0.35) {
          if (this.win.layer > 0) {
            this.climbFrom.copy(this.pos);
            this.setState('scaling');
          } else {
            this.setState('tearing');
            this.tearT = this.tearInterval * 0.6;
          }
        } else this.moveToward(o.x, o.z, this.speed, dt);
        mode = 'move';
        break;
      }
      case 'scaling': {
        // 顺着梯子爬上脚手架，再走到窗前的跳板上
        const w = this.win;
        const dur = this.type === 'walk' ? 2.6 : this.type === 'run' ? 1.9 : 1.4;
        const t = Math.min(1, this.st / dur);
        mode = 'ladder';
        animT = ((t / 0.8) * 4) % 1;
        if (t < 0.8) {
          const u = t / 0.8;
          this.pos.x = w.climbBase.x;
          this.pos.z = w.climbBase.z;
          this.pos.y = w.floorY * u;
        } else {
          const u = (t - 0.8) / 0.2;
          this.pos.lerpVectors(w.climbBase, w.outside, u);
          this.pos.y = w.floorY;
          mode = 'move';
        }
        this.faceToward(w.center.x - w.climbBase.x, w.center.z - w.climbBase.z, dt, 10);
        if (t >= 1) {
          this.pos.y = w.floorY;
          this.setState('tearing');
          this.tearT = this.tearInterval * 0.6;
        }
        break;
      }
      case 'tearing': {
        const w = this.win;
        mode = 'tear';
        this.faceToward(w.center.x - this.pos.x, w.center.z - this.pos.z, dt, 8);
        const o = w.outside;
        const off = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
        if (off > 0.9 && w.layer === 0) {
          this.setState('approach');
          break;
        }
        if (off > 0.15) this.moveToward(o.x, o.z, off > 0.9 ? this.speed : 1, dt, false);
        const nb = g.level.boardCount(w);
        if (nb > 0) {
          this.tearT -= dt;
          if (this.tearT <= 0) {
            this.tearT = this.tearInterval;
            if (g.level.pullBoard(w, this)) break;
          }
        } else if (pDist < 2.0 && pdy < 1.0 && !g.player.dead) {
          this.returnState = 'tearing';
          this.attackHit = false;
          this.setState('attacking');
        } else if (!w.occupant) {
          w.occupant = this;
          this.climbFrom.copy(this.pos);
          this.setState('climbing');
        }
        break;
      }
      case 'climbing': {
        const w = this.win;
        const dur = this.type === 'walk' ? 1.6 : this.type === 'run' ? 1.2 : 0.9;
        const t = Math.min(1, this.st / dur);
        mode = 'climb';
        if (t < 0.5) {
          const u = t / 0.5;
          this.pos.lerpVectors(this.climbFrom, w.center, u);
          this.pos.y = w.floorY + SILL * Math.sin((u * Math.PI) / 2);
        } else {
          const u = (t - 0.5) / 0.5;
          this.pos.lerpVectors(w.center, w.inside, u);
          this.pos.y = w.floorY + SILL * (1 - u * u);
        }
        this.faceToward(w.inside.x - w.center.x, w.inside.z - w.center.z, dt, 10);
        if (t >= 1) {
          this.pos.y = w.floorY;
          w.occupant = null;
          this.setState('chasing');
        }
        break;
      }
      case 'chasing': {
        this.steerT -= dt;
        if (this.steerT <= 0) {
          this.computeTarget();
          this.steerT = 0.12 + Math.random() * 0.1;
        }
        this.moveToward(this.target.x, this.target.z, this.speed, dt);
        mode = 'move';
        if (pDist < 1.15 && pdy < 1.0 && !g.player.dead) {
          this.returnState = 'chasing';
          this.attackHit = false;
          this.setState('attacking');
        }
        // 长时间追不近就换个窗户重新出生，避免卡死（高度差按两倍算，上楼也算在靠近）
        const d3 = Math.hypot(pDist, pdy * 2);
        if (d3 < this.bestDist - 0.5) {
          this.bestDist = d3;
          this.progressT = 0;
        } else this.progressT += dt;
        if (this.progressT > 14 && d3 > 10) this.respawn();
        break;
      }
      case 'attacking': {
        mode = 'attack';
        animT = this.st / ATTACK_DUR;
        if (pDist > 0.3) this.faceToward(pdx, pdz, dt, 10);
        if (this.returnState === 'chasing' && pDist > 0.75) this.moveToward(p.x, p.z, this.speed * 0.2, dt, false);
        if (!this.attackHit && this.st > ATTACK_DUR * 0.5) {
          this.attackHit = true;
          g.audio.zombieSwipe(this.headPos());
          const reach = this.returnState === 'tearing' ? 2.15 : 1.6;
          if (pDist < reach && pdy < 1.3 && !g.player.dead) g.player.damage(TIERS[this.tier].damage, this.pos);
        }
        if (this.st >= ATTACK_DUR) this.setState(this.returnState);
        break;
      }
    }

    this.moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / Math.max(dt, 1e-4);
    const stride = this.type === 'walk' ? 3.2 : this.type === 'run' ? 2.4 : 2.0;
    this.phase += (mode === 'move' ? Math.max(this.moved, this.speed * 0.5) : 0) * dt * stride;

    this.groanT -= dt;
    if (this.groanT <= 0) {
      if (pDist < 32) g.audio.groan(this.headPos(), this.pitch, this.type === 'sprint');
      this.groanT = this.type === 'sprint' ? rand(1.5, 4) : rand(3, 7.5);
    }

    this.model.animate(this.phase, this.type, mode, animT);
    this.sync();
  }

  private respawn() {
    const w = this.game.zombies.pickWindow();
    if (!w) return;
    this.win = w;
    this.pos.copy(this.game.zombies.spawnPoint(w));
    this.pos.y = -1.7;
    this.setState('rising');
  }

  stun(t: number) {
    this.stunT = Math.max(this.stunT, t);
  }

  headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.65, this.pos.z);
  }

  /** 受击：姿势保持不变，屋里的丧尸会被轻微击退 */
  onHit(dir: THREE.Vector3 | undefined, force: number) {
    if (dir && this.inside) {
      const k = Math.min(0.16, 0.035 * force);
      const len = Math.hypot(dir.x, dir.z) || 1;
      this.pos.x += (dir.x / len) * k;
      this.pos.z += (dir.z / len) * k;
    }
  }

  die(part: HitPart, source: DamageSource, dir?: THREE.Vector3, force = 1) {
    this.dead = true;
    if (this.win.occupant === this) this.win.occupant = null;
    const g = this.game;
    if (part === 'head' && (source === 'bullet' || source === 'melee')) {
      this.model.head.visible = false;
      g.particles.blood(this.headPos(), new THREE.Vector3(0, 1, 0), 40, 1.6);
      g.audio.headshot(this.headPos());
    }
    // 大多数时候朝远离射击方向倒下
    if (dir) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.deathDir = fwd.dot(dir) > 0 ? 1 : -1;
    } else this.deathDir = Math.random() < 0.5 ? 1 : -1;
    // 致死一击把尸体击飞：霰弹枪、狙击、爆炸飞得更远
    this.deathVel.set(0, 0, 0);
    if (dir && this.state !== 'climbing' && this.state !== 'rising') {
      const len = Math.hypot(dir.x, dir.z) || 1;
      const sp = 0.8 + force * 1.3;
      this.deathVel.set((dir.x / len) * sp, source === 'explosive' ? 2.5 + force * 0.4 : 0, (dir.z / len) * sp);
    }
    // 翻窗时死在窗台上、爬梯子时掉回地面
    if (this.state === 'climbing') this.pos.y = this.win.floorY;
    this.deathRef = this.state === 'scaling' ? 0 : Math.max(0, this.pos.y);
    const bx = this.pos.x + Math.sin(this.yaw) * this.deathDir * 0.8, bz = this.pos.z + Math.cos(this.yaw) * this.deathDir * 0.8;
    if (this.pos.y > -0.5) g.decals.bloodPool(bx, bz, g.level.groundAt(bx, bz, this.deathRef));
    this.setState('dying');
    this.model.root.rotation.z = rand(-0.3, 0.3);
  }

  private updateDying(dt: number) {
    const lvl = this.game.level;
    let gy = lvl.groundAt(this.pos.x, this.pos.z, this.deathRef);
    if (this.deathVel.lengthSq() > 1e-4) {
      this.pos.addScaledVector(this.deathVel, dt);
      const f = Math.exp(-4.5 * dt);
      this.deathVel.x *= f;
      this.deathVel.z *= f;
      this.deathVel.y -= 14 * dt;
      lvl.collideCircle(this.pos, 0.25, this.deathRef, this.deathRef);
      gy = lvl.groundAt(this.pos.x, this.pos.z, this.deathRef);
      if (this.pos.y <= gy && this.deathVel.y < 0) {
        this.pos.y = gy;
        this.deathVel.y = 0;
      }
    }
    const t = Math.min(1, this.st / 0.65);
    this.model.root.rotation.x = this.deathDir * (Math.PI / 2) * t * t;
    this.model.lArm.rotation.x *= 0.9;
    this.model.rArm.rotation.x *= 0.9;
    this.model.root.position.set(this.pos.x, this.pos.y + 0.12 * t, this.pos.z);
    if (this.pos.y > gy) this.pos.y = Math.max(gy, this.pos.y - dt * (this.deathRef === 0 && gy === 0 ? 6 : 3));
    if (this.st > 3.5) this.pos.y -= dt * 0.3;
    if (this.st > 5.5) this.remove = true;
  }

  sync() {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
  }

  dispose() {
    this.game.scene.remove(this.model.root);
  }
}

export function zombieCount(r: number) {
  const table = [6, 8, 13, 18, 24];
  return r <= 5 ? table[r - 1] : 24 + (r - 5) * 4;
}

export class ZombieManager {
  list: Zombie[] = [];
  toSpawn = 0;
  round = 0;
  private spawnT = 0;
  private interval = 2;
  /** 已经出现过的丧尸种类（第一次出现时提示） */
  private seenTiers = new Set<ZombieTier>();
  private maxAlive = 24;
  private hitMeshes: THREE.Mesh[] = [];
  private dirty = true;
  private killsSinceDrop = 0;
  private dropsThisRound = 0;

  constructor(private game: Game) {}

  beginRound(r: number) {
    this.round = r;
    this.toSpawn = zombieCount(r);
    this.interval = Math.max(0.35, 2.2 * Math.pow(0.93, r - 1));
    this.spawnT = 0.8;
    this.dropsThisRound = 0;
  }

  get alive() {
    let n = 0;
    for (const z of this.list) if (!z.dead) n++;
    return n;
  }
  get remaining() {
    return this.toSpawn + this.alive;
  }
  get roundClear() {
    return this.toSpawn === 0 && this.alive === 0;
  }

  pickWindow(): WindowRT | null {
    const lvl = this.game.level;
    const p = this.game.player.pos;
    const py = this.game.player.groundY;
    const pz = this.game.player.zone;
    const cands: [WindowRT, number][] = [];
    let total = 0;
    for (const w of lvl.windows) {
      if (!lvl.zoneActive[w.zone]) continue;
      const d = Math.hypot(w.inside.x - p.x, w.inside.z - p.z, (w.floorY - py) * 1.5);
      const wt = 1 / (1 + (d / 9) ** 2) + (w.zone === pz ? 0.5 : 0);
      cands.push([w, wt]);
      total += wt;
    }
    if (!cands.length) return null;
    let x = Math.random() * total;
    for (const [w, wt] of cands) {
      x -= wt;
      if (x <= 0) return w;
    }
    return cands[cands.length - 1][0];
  }

  spawnPoint(w: WindowRT) {
    const out = new THREE.Vector3(w.out[0], 0, w.out[1]);
    const lat = new THREE.Vector3(-w.out[1], 0, w.out[0]);
    const p = w.climbBase.clone().addScaledVector(out, rand(3, 6.5)).addScaledVector(lat, rand(-2.2, 2.2));
    p.y = 0;
    return p;
  }

  private spawnOne() {
    const w = this.pickWindow();
    if (!w) return;
    const tier = tierFor(this.round);
    const z = new Zombie(this.game, w, this.spawnPoint(w), tier);
    // 第一次出现精英 / 超精英时提示一下
    if (tier !== 'normal' && !this.seenTiers.has(tier)) {
      this.seenTiers.add(tier);
      this.game.hud.announce(`${TIERS[tier].name}出现了`, TIERS[tier].desc);
    }
    this.list.push(z);
    this.dirty = true;
  }

  /** 供射线检测用：所有活着的丧尸的身体部件网格 */
  targets(): THREE.Mesh[] {
    if (this.dirty) {
      this.hitMeshes = [];
      for (const z of this.list) if (!z.dead) this.hitMeshes.push(...z.model.meshes);
      this.dirty = false;
    }
    return this.hitMeshes;
  }

  damage(z: Zombie, dmg: number, part: HitPart, source: DamageSource, dir?: THREE.Vector3, opts: HitOpts = {}): boolean {
    if (z.dead) return false;
    const g = this.game;
    if (g.powerups.instakill > 0 && source !== 'nuke') dmg = z.health + 1;
    z.health -= dmg;
    const force = opts.force ?? 1;
    if (z.health > 0) {
      // 自动机枪打中和玩家一样 +10（飘字合并显示）；电网、铁丝网打中不给分，只有击杀给分
      if (source === 'turret') g.addPoints(10, true);
      else if (source !== 'trap') g.addPoints(10);
      z.onHit(dir, force);
      g.feedback.onDamage(z, dmg, part, source, false, opts.point, opts.kind);
      return false;
    }
    if (source !== 'nuke') {
      const base = source === 'melee' ? 130 : source === 'trap' || source === 'turret' ? 50 : part === 'head' ? 100 : 60;
      g.addPoints(base + TIERS[z.tier].bonus);
    }
    g.stats.kills++;
    if (part === 'head' && source === 'bullet') g.stats.headshots++;
    const wasInside = z.inside;
    g.feedback.onDamage(z, dmg, part, source, true, opts.point, opts.kind);
    z.die(part, source, dir, force);
    this.dirty = true;
    if (source !== 'nuke' && wasInside) {
      this.killsSinceDrop++;
      const chance = this.killsSinceDrop >= 28 ? 1 : 0.03;
      if (this.dropsThisRound < 4 && Math.random() < chance) {
        this.killsSinceDrop = 0;
        this.dropsThisRound++;
        g.powerups.spawn(new THREE.Vector3(z.pos.x, Math.max(0, z.pos.y), z.pos.z));
      }
    }
    return true;
  }

  explode(center: THREE.Vector3, radius: number, dmg: number) {
    for (const z of this.list) {
      if (z.dead) continue;
      const d = Math.hypot(z.pos.x - center.x, z.pos.y + 1 - center.y, z.pos.z - center.z);
      if (d < radius) {
        const dir = new THREE.Vector3(z.pos.x - center.x, 0, z.pos.z - center.z);
        this.damage(z, dmg * (1 - (d / radius) * 0.6), 'torso', 'explosive', dir, { force: 4 * (1 - d / radius) + 1 });
      }
    }
  }

  nuke() {
    for (const z of this.list) if (!z.dead) z.nukeT = rand(0.1, 1.6);
  }

  update(dt: number) {
    const g = this.game;
    if (this.toSpawn > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.alive < this.maxAlive) {
        this.spawnOne();
        this.toSpawn--;
        this.spawnT = this.interval * rand(0.7, 1.3);
      }
    }

    for (const z of this.list) z.update(dt);

    // 丧尸之间互相推开
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.collides) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (!b.collides || Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (min - d) / 2;
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
    }
    // 与玩家的碰撞（丧尸会把玩家“卡”住）
    const p = g.player.pos;
    const lvl = g.level;
    for (const z of L) {
      if (!z.collides) continue;
      const dx = z.pos.x - p.x, dz = z.pos.z - p.z;
      const min = z.radius + g.player.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8 && Math.abs(z.pos.y - p.y) < 1.5) {
        const d = Math.sqrt(d2);
        const push = min - d;
        z.pos.x += (dx / d) * push * 0.75;
        z.pos.z += (dz / d) * push * 0.75;
        p.x -= (dx / d) * push * 0.25;
        p.z -= (dz / d) * push * 0.25;
      }
      g.turrets.collide(z.pos, z.radius, z.pos.y);
      lvl.collideCircle(z.pos, z.radius, z.pos.y, z.pos.y);
      // 屋里的丧尸贴着地面走（上下楼梯）
      if (z.inside) z.pos.y = lvl.groundAt(z.pos.x, z.pos.z, z.pos.y);
      z.sync();
    }
    g.turrets.collide(p, g.player.radius, g.player.groundY);
    lvl.collideCircle(p, g.player.radius, p.y, g.player.groundY);

    for (let i = L.length - 1; i >= 0; i--) {
      if (L[i].remove) {
        L[i].dispose();
        L.splice(i, 1);
      }
    }
  }
}
