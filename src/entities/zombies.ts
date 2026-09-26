import * as THREE from 'three';
import { ZombieModel, type HitPart, type SpeedType } from './zombieModel';
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

type ZState = 'rising' | 'approach' | 'tearing' | 'climbing' | 'chasing' | 'attacking' | 'dying';
export type DamageSource = 'bullet' | 'melee' | 'explosive' | 'nuke' | 'trap' | 'turret';

const ATTACK_DUR = 1.0;
const ATTACK_DMG = 50;

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
  radius = 0.28;
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

  constructor(
    private game: Game,
    public win: WindowRT,
    spawn: THREE.Vector3,
    health: number,
    public type: SpeedType,
  ) {
    this.health = health;
    this.maxHealth = health;
    this.speed = type === 'walk' ? rand(1.0, 1.35) : type === 'run' ? rand(2.4, 2.9) : rand(4.2, 4.8);
    this.model = new ZombieModel(this, type === 'sprint');
    this.model.root.rotation.order = 'YXZ';
    this.pos.copy(spawn);
    this.pos.y = -1.7;
    this.yaw = Math.atan2(win.outside.x - spawn.x, win.outside.z - spawn.z);
    game.scene.add(this.model.root);
    game.audio.rise(spawn);
    this.sync();
  }

  get collides() {
    return this.state === 'approach' || this.state === 'tearing' || this.state === 'chasing' || this.state === 'attacking';
  }
  get inside() {
    return this.state === 'chasing' || this.state === 'attacking' && this.returnState === 'chasing';
  }
  get tearInterval() {
    return this.type === 'walk' ? 1.4 : this.type === 'run' ? 1.1 : 0.8;
  }

  private setState(s: ZState) {
    this.state = s;
    this.st = 0;
    if (s === 'chasing') {
      this.bestDist = Infinity;
      this.progressT = 0;
      this.steerT = 0;
    }
  }

  private moveToward(tx: number, tz: number, speed: number, dt: number) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.faceToward(dx, dz, dt, 9);
  }
  private faceToward(dx: number, dz: number, dt: number, rate: number) {
    const want = Math.atan2(dx, dz);
    this.yaw += angleDiff(this.yaw, want) * damp(rate, dt);
  }

  /** 选择下一个移动目标：看得见玩家就直冲，否则沿流场“拉线”走 */
  private computeTarget() {
    const lvl = this.game.level;
    const p = this.game.player.pos;
    if (lvl.segmentClear(this.pos.x, this.pos.z, p.x, p.z, 0.26)) {
      this.target.set(p.x, 0, p.z);
      return;
    }
    let cur = lvl.idx(Math.floor(this.pos.x), Math.floor(this.pos.z));
    let found = false;
    for (let k = 0; k < 6; k++) {
      const nb = lvl.bestNeighbor(cur);
      if (nb < 0) break;
      const nx = (nb % lvl.w) + 0.5, nz = Math.floor(nb / lvl.w) + 0.5;
      if (k === 0 || lvl.segmentClear(this.pos.x, this.pos.z, nx, nz, 0.26)) {
        this.target.set(nx, 0, nz);
        found = true;
        cur = nb;
      } else break;
    }
    if (!found) this.target.set(p.x, 0, p.z);
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
      // 被电网电住：原地抽搐
      this.stunT -= dt;
      this.model.animate(this.phase, this.type, 'idle', this.st);
      this.model.root.position.set(this.pos.x + (Math.random() - 0.5) * 0.05, this.pos.y, this.pos.z + (Math.random() - 0.5) * 0.05);
      this.model.root.rotation.y = this.yaw;
      return;
    }

    const p = g.player.pos;
    const pdx = p.x - this.pos.x, pdz = p.z - this.pos.z;
    const pDist = Math.hypot(pdx, pdz);
    let mode: 'move' | 'idle' | 'attack' | 'tear' | 'climb' | 'rise' = 'idle';
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
        const o = this.win.outside;
        const d = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
        if (d < 0.35) {
          this.setState('tearing');
          this.tearT = this.tearInterval * 0.6;
        } else this.moveToward(o.x, o.z, this.speed, dt);
        mode = 'move';
        break;
      }
      case 'tearing': {
        const w = this.win;
        mode = 'tear';
        this.faceToward(w.center.x - this.pos.x, w.center.z - this.pos.z, dt, 8);
        const o = w.outside;
        const off = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
        if (off > 0.9) {
          this.setState('approach');
          break;
        }
        if (off > 0.15) this.moveToward(o.x, o.z, 1, dt);
        const nb = g.level.boardCount(w);
        if (nb > 0) {
          this.tearT -= dt;
          if (this.tearT <= 0) {
            this.tearT = this.tearInterval;
            if (g.level.pullBoard(w, this)) break;
          }
        } else if (pDist < 2.0 && !g.player.dead) {
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
          this.pos.y = SILL * Math.sin((u * Math.PI) / 2);
        } else {
          const u = (t - 0.5) / 0.5;
          this.pos.lerpVectors(w.center, w.inside, u);
          this.pos.y = SILL * (1 - u * u);
        }
        this.faceToward(w.inside.x - w.center.x, w.inside.z - w.center.z, dt, 10);
        if (t >= 1) {
          this.pos.y = 0;
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
        if (pDist < 1.15 && !g.player.dead) {
          this.returnState = 'chasing';
          this.attackHit = false;
          this.setState('attacking');
        }
        // 长时间追不近就换个窗户重新出生，避免卡死
        if (pDist < this.bestDist - 0.5) {
          this.bestDist = pDist;
          this.progressT = 0;
        } else this.progressT += dt;
        if (this.progressT > 14 && pDist > 10) this.respawn();
        break;
      }
      case 'attacking': {
        mode = 'attack';
        animT = this.st / ATTACK_DUR;
        this.faceToward(pdx, pdz, dt, 10);
        if (this.returnState === 'chasing' && pDist > 0.75) this.moveToward(p.x, p.z, this.speed * 0.2, dt);
        if (!this.attackHit && this.st > ATTACK_DUR * 0.5) {
          this.attackHit = true;
          g.audio.zombieSwipe(this.headPos());
          const reach = this.returnState === 'tearing' ? 2.15 : 1.6;
          if (pDist < reach && !g.player.dead) g.player.damage(ATTACK_DMG, this.pos);
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

    this.model.decayFlinch(dt);
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

  /** 受击：身子后仰 / 爆头甩头，屋里的丧尸还会被轻微击退 */
  onHit(part: HitPart, dmg: number, dir: THREE.Vector3 | undefined, force: number) {
    this.model.hitReact(part, clamp((dmg / this.maxHealth) * 2.5 + 0.35, 0.35, 1), Math.random() < 0.5 ? -1 : 1);
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
    if (this.state === 'climbing') this.pos.y = 0;
    if (this.pos.y > -0.5) g.decals.bloodPool(this.pos.x + Math.sin(this.yaw) * this.deathDir * 0.8, this.pos.z + Math.cos(this.yaw) * this.deathDir * 0.8);
    this.setState('dying');
    this.model.root.rotation.z = rand(-0.3, 0.3);
  }

  private updateDying(dt: number) {
    if (this.deathVel.lengthSq() > 1e-4) {
      this.pos.addScaledVector(this.deathVel, dt);
      const f = Math.exp(-4.5 * dt);
      this.deathVel.x *= f;
      this.deathVel.z *= f;
      this.deathVel.y -= 14 * dt;
      if (this.pos.y <= 0 && this.deathVel.y < 0) {
        this.pos.y = 0;
        this.deathVel.y = 0;
      }
      this.game.level.collideCircle(this.pos, 0.25);
    }
    const t = Math.min(1, this.st / 0.65);
    this.model.root.rotation.x = this.deathDir * (Math.PI / 2) * t * t;
    this.model.lArm.rotation.x *= 0.9;
    this.model.rArm.rotation.x *= 0.9;
    this.model.root.position.set(this.pos.x, this.pos.y + 0.12 * t, this.pos.z);
    if (this.pos.y > 0) this.pos.y = Math.max(0, this.pos.y - dt * 3);
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
export function zombieHealth(r: number) {
  return r <= 9 ? 150 + 100 * (r - 1) : Math.round(950 * Math.pow(1.1, r - 9));
}
function speedFor(r: number): SpeedType {
  const pSprint = clamp((r - 5) * 0.12, 0, 0.85);
  const pRun = clamp((r - 2) * 0.25, 0, 1) * (1 - pSprint);
  const x = Math.random();
  if (x < pSprint) return 'sprint';
  if (x < pSprint + pRun) return 'run';
  return 'walk';
}

export class ZombieManager {
  list: Zombie[] = [];
  toSpawn = 0;
  round = 0;
  private spawnT = 0;
  private interval = 2;
  private health = 150;
  private maxAlive = 24;
  private hitMeshes: THREE.Mesh[] = [];
  private dirty = true;
  private killsSinceDrop = 0;
  private dropsThisRound = 0;

  constructor(private game: Game) {}

  beginRound(r: number) {
    this.round = r;
    this.toSpawn = zombieCount(r);
    this.health = zombieHealth(r);
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
    const pz = this.game.player.zone;
    const cands: [WindowRT, number][] = [];
    let total = 0;
    for (const w of lvl.windows) {
      if (!lvl.zoneActive[w.zone]) continue;
      const d = Math.hypot(w.inside.x - p.x, w.inside.z - p.z);
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
    return w.outside.clone().addScaledVector(out, rand(3, 6.5)).addScaledVector(lat, rand(-2.2, 2.2));
  }

  private spawnOne() {
    const w = this.pickWindow();
    if (!w) return;
    const z = new Zombie(this.game, w, this.spawnPoint(w), this.health, speedFor(this.round));
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
      // 自动机枪打中不给分，只有击杀给分，免得挂机刷分
      if (source !== 'turret') g.addPoints(10);
      z.onHit(part, dmg, dir, force);
      g.feedback.onDamage(z, dmg, part, source, false, opts.point, opts.kind);
      return false;
    }
    if (source !== 'nuke') {
      g.addPoints(source === 'melee' ? 130 : source === 'trap' || source === 'turret' ? 50 : part === 'head' ? 100 : 60);
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
        g.powerups.spawn(new THREE.Vector3(z.pos.x, 0, z.pos.z));
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
        if (!b.collides) continue;
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
    for (const z of L) {
      if (!z.collides) continue;
      const dx = z.pos.x - p.x, dz = z.pos.z - p.z;
      const min = z.radius + g.player.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = min - d;
        z.pos.x += (dx / d) * push * 0.75;
        z.pos.z += (dz / d) * push * 0.75;
        p.x -= (dx / d) * push * 0.25;
        p.z -= (dz / d) * push * 0.25;
      }
      g.turrets.collide(z.pos, z.radius);
      g.level.collideCircle(z.pos, z.radius);
      z.sync();
    }
    g.turrets.collide(p, g.player.radius);
    g.level.collideCircle(p, g.player.radius);

    for (let i = L.length - 1; i >= 0; i--) {
      if (L[i].remove) {
        L[i].dispose();
        L.splice(i, 1);
      }
    }
  }
}
