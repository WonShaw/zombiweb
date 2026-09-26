import * as THREE from 'three';
import type { Game } from '../game';
import type { PerkId } from '../world/map';
import { clamp, damp, rand } from '../core/util';

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = 100;
  maxHealth = 100;
  radius = 0.3;
  eye = 1.62;
  onGround = true;
  /** 脚下地面的高度（一楼 0、二楼层高、楼梯上按斜坡） */
  groundY = 0;
  sprinting = false;
  dead = false;
  deathT = 0;
  zone = 0;
  perks = new Set<PerkId>();
  sensitivity = 1;
  hurtFlash = 0;
  /** 最近一次受伤来源的方位（相对视角，弧度），HUD 用 */
  hurtAngle = 0;
  hurtDirT = 0;
  speedNow = 0;

  private kickP = 0;
  private kickY = 0;
  private shake = 0;
  private bob = 0;
  private bobAmt = 0;
  private lastHurt = -99;
  private heartT = 0;
  private lastStep = 0;

  constructor(private game: Game) {
    const s = game.level.def.start;
    this.pos.set(s.x, 0, s.z);
    this.yaw = s.yaw;
    this.zone = game.level.startZone;
  }

  forward(out: THREE.Vector3) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  /** 后坐力：一部分永久抬高准星，一部分是会回弹的视觉抖动 */
  kick(amount: number) {
    this.pitch = clamp(this.pitch + amount * 0.55, -1.5, 1.5);
    this.yaw += rand(-0.35, 0.35) * amount;
    this.kickP += amount * 0.45;
    this.kickY += rand(-0.2, 0.2) * amount;
  }

  update(dt: number) {
    const g = this.game;
    const inp = g.input;
    if (this.dead) {
      this.deathT += dt;
      return;
    }
    const ads = g.weapons.adsT;
    // 开镜降低灵敏度；倍率越高降得越多（狙击镜下不至于一甩就飞）
    const zoom = Math.min(0.55, g.weapons.current.def.adsFov / 75);
    const sens = 0.0022 * this.sensitivity * (1 - ads * (1 - zoom));
    this.yaw -= inp.mouseDX * sens;
    this.pitch = clamp(this.pitch - inp.mouseDY * sens, -1.52, 1.52);

    let fx = 0, fz = 0;
    if (inp.down('KeyW')) fz -= 1;
    if (inp.down('KeyS')) fz += 1;
    if (inp.down('KeyA')) fx -= 1;
    if (inp.down('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      fx /= len;
      fz /= len;
    }
    this.sprinting =
      (inp.down('ShiftLeft') || inp.down('ShiftRight')) && fz < 0 && ads < 0.3 && this.onGround && g.weapons.canSprint;
    const speed = (this.sprinting ? 6.3 : 4.3) * g.weapons.moveMult * (1 - ads * 0.4);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // 前 = (-sin, -cos)，右 = (cos, -sin)
    const wx = cy * fx - sy * -fz;
    const wz = -sy * fx - cy * -fz;
    const k = damp(this.onGround ? 14 : 2.5, dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;

    if (inp.wasPressed('Space') && this.onGround) {
      this.vel.y = 6.2;
      this.onGround = false;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    g.turrets.collide(this.pos, this.radius, this.groundY);
    g.level.collideCircle(this.pos, this.radius, this.pos.y, this.groundY);

    // 竖直方向：站着时贴地（上下楼梯），跳起来或走下台阶才受重力
    const ground = g.level.groundAt(this.pos.x, this.pos.z, this.groundY);
    if (this.onGround) {
      if (this.pos.y - ground > 0.45) this.onGround = false;
      else {
        this.pos.y = ground;
        this.vel.y = 0;
      }
    }
    if (!this.onGround) {
      this.vel.y -= 20 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        if (this.vel.y < -4) g.audio.jumpLand();
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      }
    }
    this.groundY = ground;

    const z = g.level.zoneAt(this.pos.x, this.groundY, this.pos.z);
    if (z >= 0) this.zone = z;

    // 走路晃动 + 脚步声
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speedNow = hs;
    if (this.onGround && hs > 0.6) {
      this.bob += dt * hs * 1.85;
      this.bobAmt += (1 - this.bobAmt) * damp(8, dt);
      const step = Math.floor(this.bob / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        g.audio.footstep();
      }
    } else this.bobAmt += (0 - this.bobAmt) * damp(6, dt);

    // 回血
    if (g.time - this.lastHurt > 2.5) this.health = Math.min(this.maxHealth, this.health + 70 * dt);
    if (this.health < this.maxHealth * 0.4) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        g.audio.heartbeat();
        this.heartT = 0.85;
      }
    }

    this.kickP *= Math.exp(-11 * dt);
    this.kickY *= Math.exp(-11 * dt);
    this.shake = Math.max(0, this.shake - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
    this.hurtDirT = Math.max(0, this.hurtDirT - dt);
  }

  shakeFor(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  damage(n: number, from?: THREE.Vector3) {
    if (this.dead) return;
    const g = this.game;
    this.health -= n;
    this.lastHurt = g.time;
    this.shake = 0.3;
    this.hurtFlash = 1;
    g.audio.playerHurt();
    if (from) {
      const a = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      // 相对视角的角度：0 = 正前方
      this.hurtAngle = a - Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw));
      this.hurtDirT = 1.2;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathT = 0;
      g.gameOver();
    }
  }

  applyCamera(cam: THREE.PerspectiveCamera) {
    const bobY = Math.sin(this.bob * 2) * 0.035 * this.bobAmt * (this.sprinting ? 1.5 : 1);
    const bobRoll = Math.sin(this.bob) * 0.006 * this.bobAmt;
    const sh = this.shake > 0 ? this.shake * 0.05 : 0;
    let eye = this.eye;
    let roll = bobRoll;
    if (this.dead) {
      const t = Math.min(1, this.deathT / 1.2);
      eye = this.eye - (this.eye - 0.3) * t * t;
      roll = t * 0.9;
    }
    cam.position.set(this.pos.x, this.pos.y + eye + bobY, this.pos.z);
    cam.rotation.set(
      this.pitch + this.kickP + rand(-sh, sh),
      this.yaw + this.kickY + rand(-sh, sh),
      roll,
      'YXZ',
    );
  }

  bobPhase() {
    return { phase: this.bob, amt: this.bobAmt };
  }
}
