import * as THREE from 'three';
import { WEAPONS, type WeaponDef } from './defs';
import { buildGun, buildBottle, type GunModel } from './models';
import { MELEE, DEFAULT_MELEE, MELEE_ANIMS, HAND_IDLE, SHOULDER, buildMelee, buildSleeve, type MeleeDef, type MeleeAttack, type MeleeAnim, type MeleeKey } from './melee';
import type { Game } from '../game';
import type { HitPart } from '../entities/zombieModel';
import type { Zombie } from '../entities/zombies';
import type { RayHit } from '../world/level';
import { clamp, damp, lerp, rand, smoothstep } from '../core/util';
import * as TX from '../core/textures';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** 弹药无限：只有弹匣，打空了换弹即可 */
export interface Owned {
  def: WeaponDef;
  mag: number;
  model: GunModel;
  /** 买这把枪花的积分（神秘箱抽到的按抽箱价算），出售退一半 */
  paid: number;
}

/** 最多携带几把枪 */
export const MAX_GUNS = 4;
/** 按住 G 多久卖掉手上的枪 */
const SELL_HOLD = 0.6;

/** 各类枪的腰射位置：长枪要离镜头远一些，否则枪托会糊满屏幕 */
const HIP: Record<string, THREE.Vector3> = {
  pistol: new THREE.Vector3(0.11, -0.115, -0.33),
  wonder: new THREE.Vector3(0.11, -0.11, -0.33),
  smg: new THREE.Vector3(0.12, -0.13, -0.27),
  rifle: new THREE.Vector3(0.125, -0.14, -0.23),
  shotgun: new THREE.Vector3(0.125, -0.14, -0.23),
  sniper: new THREE.Vector3(0.125, -0.14, -0.2),
  lmg: new THREE.Vector3(0.13, -0.145, -0.24),
  launcher: new THREE.Vector3(0.16, -0.1, -0.2),
};
const ADS_Z: Record<string, number> = { pistol: -0.25, wonder: -0.27, smg: -0.2, rifle: -0.19, shotgun: -0.2, sniper: -0.17, lmg: -0.2, launcher: -0.22 };
const SWITCH_HALF = 0.22;
/** 右键按住超过这个时间再松开，算“按住瞄准”（松开就取消）；更短算“点一下”，保持瞄准直到再点一下 */
const AIM_HOLD = 0.3;
/** 致死一击的击飞力度 */
const FORCE: Record<string, number> = { pistol: 1, smg: 1, rifle: 1.5, shotgun: 3, lmg: 1.7, sniper: 3, launcher: 5, wonder: 2 };

export class WeaponSystem {
  owned: Owned[] = [];
  cur = 0;
  adsT = 0;
  vmRoot = new THREE.Group();
  private holder = new THREE.Group();
  /** 当前装备的近战武器、已经拥有的近战武器 */
  melee: MeleeDef = MELEE[DEFAULT_MELEE];
  meleeOwned = new Set<string>([DEFAULT_MELEE]);
  /** 手上拿的是近战武器 */
  meleeOut = false;
  /** 近战手臂：袖子从肩膀拉到手，手腕上是武器 */
  private meleeRoot = new THREE.Group();
  private meleeSleeve: THREE.Group;
  private meleeWrist = new THREE.Group();
  private meleeModel: THREE.Group | null = null;
  private meleeModels = new Map<string, THREE.Group>();
  /** 正在进行的近战攻击：t 是进度 0..1 */
  private swing: { atk: MeleeAttack; anim: MeleeAnim; t: number; hit: boolean; heavy: boolean } | null = null;
  /** 轻击左右交替 */
  private slashFlip = false;
  private switchToMelee = false;
  private bottle: { group: THREE.Group; glass: THREE.MeshStandardMaterial };
  private flash: THREE.Mesh;
  private flashT = 0;
  private muzzleLight: THREE.PointLight;
  private vmLights: THREE.Light[] = [];

  private cooldown = 0;
  private reloadT = -1;
  private reloadDur = 1;
  private reloadStage = 0;
  private switchT = -1;
  private switchTo = -1;
  private swapped = false;
  private drinkT = -1;
  private drinkDone: (() => void) | null = null;
  private triggerHeld = false;
  /** 松开左键之前不开火（左键刚被别的操作用掉时） */
  private holdFire = false;
  private burstLeft = 0;
  private sprintT = 0;
  /** 瞄准开关：右键点一下打开并保持，再点一下关掉 */
  private aimOn = false;
  /** 右键按下后的计时（区分点一下和按住），-1 表示没在计时 */
  private aimHoldT = -1;
  private carryT = 0;
  private kickV = 0;
  private swayX = 0;
  private swayY = 0;
  private bloom = 0;
  private raycaster = new THREE.Raycaster();
  private rayHit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0 };
  private tmpO = new THREE.Vector3();
  private tmpD = new THREE.Vector3();

  constructor(private game: Game) {
    game.vmCamera.add(this.vmRoot);
    this.vmRoot.add(this.holder);

    const amb = new THREE.AmbientLight(0xb0b8c8, 0.5);
    const key = new THREE.DirectionalLight(0xffe0c0, 1.5);
    key.position.set(-1, 2, 1);
    const hemi = new THREE.HemisphereLight(0xc0c8ff, 0x302418, 0.6);
    game.vmScene.add(amb, key, hemi);
    this.vmLights = [amb, key, hemi];
    // 金属枪身需要环境贴图才有反光，否则会是一团黑
    const pmrem = new THREE.PMREMGenerator(game.renderer);
    game.vmScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    game.vmScene.environmentIntensity = 0.6;

    const flashMat = new THREE.MeshBasicMaterial({
      map: TX.flashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
    this.flash.visible = false;

    this.meleeRoot.visible = false;
    this.vmRoot.add(this.meleeRoot);
    this.meleeSleeve = buildSleeve();
    this.meleeRoot.add(this.meleeSleeve, this.meleeWrist);
    this.equipMelee(DEFAULT_MELEE);
    this.bottle = buildBottle();
    this.bottle.group.visible = false;
    this.vmRoot.add(this.bottle.group);

    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 1.5);
    game.scene.add(this.muzzleLight);

    this.give('m1911');
  }

  get current() {
    return this.owned[this.cur];
  }
  get reloading() {
    return this.reloadT >= 0;
  }
  get busy() {
    return this.swing !== null || this.drinkT >= 0 || this.switchT >= 0 || this.carrying;
  }
  /** 正在挥近战武器 */
  get swinging() {
    return this.swing !== null;
  }
  /** 正在搬运自动机枪：不能开枪、开镜、拿刀 */
  get carrying() {
    return !!this.game.turrets?.carry;
  }
  get drinking() {
    return this.drinkT >= 0;
  }
  get canSprint() {
    return this.swing === null && this.drinkT < 0;
  }
  get moveMult() {
    if (this.meleeOut) return this.melee.move;
    return this.current?.def.move ?? 1;
  }
  /** 当前散布，HUD 准星用 */
  get spreadNow() {
    if (this.meleeOut) return 0;
    const d = this.current.def;
    const pl = this.game.player;
    return lerp(d.hipSpread, d.adsSpread, this.adsT) * (1 + (pl.speedNow / 6) * 0.9) * (pl.onGround ? 1 : 2) + this.bloom;
  }

  has(id: string) {
    return this.owned.some((o) => o.def.id === id);
  }

  /** 获得武器。满了就替换 slot 指定的槽位（默认手上这把）；已有同款就只补满弹匣。paid = 花了多少积分 */
  give(id: string, slot = this.cur, paid = WEAPONS[id].cost) {
    const def = WEAPONS[id];
    const existing = this.owned.findIndex((o) => o.def.id === id);
    if (existing >= 0) {
      this.owned[existing].mag = def.mag;
      return;
    }
    const model = buildGun(def.model, true);
    model.group.visible = false;
    this.holder.add(model.group);
    const w: Owned = { def, mag: def.mag, model, paid };
    let idx: number;
    if (this.owned.length < MAX_GUNS) {
      this.owned.push(w);
      idx = this.owned.length - 1;
    } else {
      idx = clamp(slot, 0, MAX_GUNS - 1);
      this.holder.remove(this.owned[idx].model.group);
      this.owned[idx] = w;
    }
    this.cur = idx;
    this.meleeOut = false;
    this.swing = null;
    this.showCurrent();
    // 从下方抬起
    this.switchT = SWITCH_HALF;
    this.switchTo = idx;
    this.swapped = true;
    this.reloadT = -1;
    this.burstLeft = 0;
  }

  sellPrice(o: Owned) {
    return Math.floor(o.paid / 2);
  }

  /** 卖掉第 idx 把枪，退一半积分。最后一把不能卖。成功返回 true */
  sell(idx: number) {
    if (this.owned.length <= 1 || idx < 0 || idx >= this.owned.length) return false;
    const o = this.owned[idx];
    this.holder.remove(o.model.group);
    this.owned.splice(idx, 1);
    if (idx < this.cur) this.cur--;
    else if (idx === this.cur) {
      // 卖掉手上这把：换成下一把，从下方抬起
      this.cur = Math.min(idx, this.owned.length - 1);
      this.switchT = SWITCH_HALF;
      this.switchTo = this.cur;
      this.swapped = true;
      this.reloadT = -1;
      this.burstLeft = 0;
    }
    this.showCurrent();
    this.game.refund(this.sellPrice(o));
    this.game.audio.purchase();
    return true;
  }

  private showCurrent() {
    this.owned.forEach((o, i) => (o.model.group.visible = !this.meleeOut && i === this.cur));
    this.current.model.muzzle.add(this.flash);
    this.meleeRoot.visible = this.meleeOut;
  }

  /** 装备一把近战武器（商店里买下或切换） */
  equipMelee(id: string) {
    const def = MELEE[id];
    if (!def) return;
    this.meleeOwned.add(id);
    this.melee = def;
    if (this.meleeModel) this.meleeWrist.remove(this.meleeModel);
    let m = this.meleeModels.get(id);
    if (!m) {
      m = buildMelee(id, true);
      this.meleeModels.set(id, m);
    }
    this.meleeModel = m;
    this.meleeWrist.add(m);
    this.swing = null;
  }

  private startReload() {
    const w = this.current;
    if (this.reloadT >= 0 || w.mag >= w.def.mag) return;
    this.reloadDur = w.def.reload * (this.game.player.perks.has('speed') ? 0.5 : 1);
    this.reloadT = this.reloadDur;
    this.reloadStage = 0;
  }

  private beginSwitch(i: number) {
    if ((i === this.cur && !this.meleeOut) || i < 0 || i >= this.owned.length || this.busy) return;
    this.switchToMelee = false;
    this.switchTo = i;
    this.switchT = 0;
    this.swapped = false;
    this.stopAim();
    this.reloadT = -1;
    this.burstLeft = 0;
  }

  /** 拿出近战武器 */
  private beginSwitchMelee() {
    if (this.meleeOut || this.busy) return;
    this.switchToMelee = true;
    this.switchTo = this.cur;
    this.switchT = 0;
    this.swapped = false;
    this.stopAim();
    this.reloadT = -1;
    this.burstLeft = 0;
  }

  private sellT = 0;
  /** 卖掉之后要松开 G 才能卖下一把 */
  private sellLock = false;
  /** 按住 G 时显示的出售提示和进度（交给交互提示栏显示） */
  sellPrompt: { text: string; frac: number | null } | null = null;

  private updateSell(dt: number) {
    const inp = this.game.input;
    if (!inp.down('KeyG') || this.game.player.dead) {
      this.sellT = 0;
      this.sellLock = false;
      this.sellPrompt = null;
      return;
    }
    if (this.sellLock) {
      this.sellPrompt = null;
      return;
    }
    if (this.meleeOut) {
      this.sellPrompt = { text: '近战武器不能出售（可以在商店里换别的）', frac: null };
      return;
    }
    if (this.owned.length <= 1) {
      this.sellPrompt = { text: '只剩这一把枪，不能出售', frac: null };
      return;
    }
    const w = this.current;
    const price = this.sellPrice(w);
    if (this.busy) {
      this.sellT = 0;
      this.sellPrompt = { text: `按住 G 出售 ${w.def.name}（+${price}）`, frac: 0 };
      return;
    }
    this.sellT += dt;
    this.sellPrompt = { text: `按住 G 出售 ${w.def.name}（+${price}）`, frac: Math.min(1, this.sellT / SELL_HOLD) };
    if (this.sellT >= SELL_HOLD) {
      this.sell(this.cur);
      this.sellT = 0;
      this.sellLock = true;
      this.sellPrompt = null;
    }
  }

  /** 这次按下的左键已经被用掉了，松开前不要开火 */
  /** 退出瞄准（换枪、喝饮料、冲刺、搬机枪、死亡时） */
  stopAim() {
    this.aimOn = false;
    this.aimHoldT = -1;
  }

  consumeTrigger() {
    this.holdFire = true;
    this.burstLeft = 0;
  }

  /** 挥一下近战武器：heavy = 右键重击 */
  private startSwing(heavy: boolean) {
    const atk = heavy ? this.melee.heavy : this.melee.light;
    let anim = atk.anim;
    if (anim === 'slash') {
      anim = this.slashFlip ? 'slashR' : 'slash';
      this.slashFlip = !this.slashFlip;
    }
    this.swing = { atk, anim, t: 0, hit: false, heavy };
    this.game.audio.knifeSwing(heavy);
  }

  drink(color: string, done: () => void) {
    this.stopAim();
    this.drinkT = 2.1;
    this.drinkDone = done;
    this.reloadT = -1;
    this.bottle.glass.color.set(color);
    this.bottle.glass.emissive.set(color).multiplyScalar(0.3);
    this.game.audio.perkDrink();
  }

  update(dt: number) {
    const g = this.game;
    const inp = g.input;
    const pl = g.player;
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.25);

    if (!pl.dead) {
      if (this.drinkT >= 0) {
        this.drinkT -= dt;
        if (this.drinkT < 0) {
          this.drinkDone?.();
          this.drinkDone = null;
        }
      }
      if (this.swing) {
        const sw = this.swing;
        sw.t += dt / sw.atk.time;
        if (!sw.hit && sw.t >= MELEE_ANIMS[sw.anim].hit) {
          sw.hit = true;
          this.meleeHit(sw.atk, sw.heavy);
        }
        if (sw.t >= 1) this.swing = null;
      }
      if (this.switchT >= 0) {
        this.switchT += dt;
        if (!this.swapped && this.switchT >= SWITCH_HALF) {
          this.swapped = true;
          this.cur = this.switchTo;
          this.meleeOut = this.switchToMelee;
          this.showCurrent();
        }
        if (this.switchT >= SWITCH_HALF * 2) this.switchT = -1;
      }
      if (this.reloadT >= 0) this.updateReload(dt);

      const busy = this.busy;
      this.updateAim(dt);
      // 带光学镜的枪换弹时要放下镜子
      const wantAds = this.aimOn && !this.meleeOut && !busy && !pl.sprinting && !(this.current.def.scope && this.reloadT >= 0);
      this.adsT += ((wantAds ? 1 : 0) - this.adsT) * damp(13, dt);
      this.sprintT += ((pl.sprinting ? 1 : 0) - this.sprintT) * damp(10, dt);

      if (!busy) {
        if (inp.wasPressed('KeyR') && !this.meleeOut) this.startReload();
        for (let i = 0; i < MAX_GUNS; i++) if (inp.wasPressed(`Digit${i + 1}`)) this.beginSwitch(i);
        // V / 5 拿出近战武器，再按一次收回到枪
        if (inp.wasPressed('KeyV') || inp.wasPressed('Digit5')) {
          if (this.meleeOut) this.beginSwitch(this.cur);
          else this.beginSwitchMelee();
        }
        // Q 上一把、E 下一把（枪 + 近战武器循环），滚轮同理
        const n = this.owned.length;
        const at = this.meleeOut ? n : this.cur;
        const go = (k: number) => (k === n ? this.beginSwitchMelee() : this.beginSwitch(k));
        if (inp.wasPressed('KeyE') || inp.wheel > 0) go((at + 1) % (n + 1));
        else if (inp.wasPressed('KeyQ') || inp.wheel < 0) go((at + n) % (n + 1));
      }
      this.updateSell(dt);

      if (!inp.mouseDown[0]) this.holdFire = false;
      if (this.meleeOut) {
        // 近战：左键轻击、右键重击，按住连续出招
        if (!this.busy) {
          if (inp.mouseDown[0] && !this.holdFire) this.startSwing(false);
          else if (inp.mouseDown[2]) this.startSwing(true);
        }
        this.updateViewmodel(dt);
        return;
      }
      const trig = inp.mouseDown[0] && !this.holdFire;
      if (!trig) this.triggerHeld = false;
      const w = this.current;
      const canShoot = !this.busy && this.reloadT < 0 && this.sprintT < 0.35 && this.cooldown <= 0;
      if (this.burstLeft > 0 && canShoot) {
        // 点射：扣一次扳机连发 N 发
        if (w.mag > 0) this.fire();
        else this.burstLeft = 0;
      } else if (trig && canShoot) {
        if (w.def.auto || !this.triggerHeld) {
          if (w.mag > 0) {
            if (w.def.burst) this.burstLeft = w.def.burst;
            this.fire();
          } else if (!this.triggerHeld) {
            g.audio.dryFire();
            this.startReload();
          }
        }
        this.triggerHeld = true;
      }
      if (w.mag === 0 && this.reloadT < 0 && !this.busy && this.cooldown <= 0) this.startReload();
    } else {
      this.stopAim();
      this.adsT += (0 - this.adsT) * damp(8, dt);
    }

    this.updateViewmodel(dt);
  }

  /**
   * 右键瞄准：点一下进入瞄准并保持（方便触控板），再点一下退出；
   * 按住超过 0.3 秒再松开则松开即退出（和原来的按住瞄准一样）。按 Shift 冲刺会退出瞄准。
   */
  private updateAim(dt: number) {
    const inp = this.game.input;
    if (this.carrying || this.meleeOut) {
      this.stopAim();
      return;
    }
    if (inp.mousePressed[2]) {
      if (this.aimOn) this.stopAim();
      else {
        this.aimOn = true;
        this.aimHoldT = 0;
      }
    }
    if (this.aimHoldT >= 0) {
      if (inp.mouseDown[2]) this.aimHoldT += dt;
      else {
        if (this.aimHoldT > AIM_HOLD) this.aimOn = false;
        this.aimHoldT = -1;
      }
    }
    if (inp.wasPressed('ShiftLeft') || inp.wasPressed('ShiftRight')) this.stopAim();
  }

  private updateReload(dt: number) {
    const p = 1 - this.reloadT / this.reloadDur;
    const a = this.game.audio;
    if (this.reloadStage === 0 && p > 0.15) {
      this.reloadStage = 1;
      a.reload(0);
    } else if (this.reloadStage === 1 && p > 0.62) {
      this.reloadStage = 2;
      a.reload(1);
    } else if (this.reloadStage === 2 && p > 0.86) {
      this.reloadStage = 3;
      a.reload(2);
    }
    this.reloadT -= dt;
    if (this.reloadT < 0) {
      this.current.mag = this.current.def.mag;
      this.reloadT = -1;
    }
  }

  private fire() {
    const g = this.game;
    const w = this.current;
    const def = w.def;
    w.mag--;
    const rate = g.player.perks.has('doubletap') ? 0.75 : 1;
    if (def.burst) {
      this.burstLeft--;
      this.cooldown = (this.burstLeft > 0 ? def.interval : def.burstDelay ?? 0.25) * rate;
    } else this.cooldown = def.interval * rate;
    g.stats.shots++;
    const origin = g.camera.getWorldPosition(this.tmpO);
    const fwd = g.camera.getWorldDirection(this.tmpD);
    const spread = this.spreadNow;
    if (def.projectile) {
      const dir = coneDir(fwd, spread);
      g.projectiles.fire(origin.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0, -0.08, 0)), dir, def);
    } else if (def.chain) {
      this.fireChain(origin, coneDir(fwd, spread), def);
    } else {
      let hitAny = false;
      let killAny = false;
      for (let i = 0; i < def.pellets; i++) {
        const r = this.hitscan(origin, coneDir(fwd, spread), def, i === 0);
        hitAny ||= r.hit;
        killAny ||= r.kill;
      }
      if (hitAny) {
        g.stats.hits++;
        g.hud.hitmarker(killAny);
      }
    }
    this.bloom = Math.min(def.hipSpread * 1.2, this.bloom + def.hipSpread * 0.22);
    g.audio.shot(def.sound);
    g.player.kick(def.recoil * (1 - this.adsT * 0.35));
    this.kickV = Math.min(1.5, this.kickV + 1);
    this.flashT = def.cls === 'wonder' ? 0 : 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(rand(0.8, 1.3) * (def.cls === 'shotgun' || def.cls === 'lmg' || def.cls === 'launcher' ? 1.5 : 1));
    this.muzzleLight.color.set(def.chain ? 0x80c8ff : def.cls === 'wonder' ? 0x60ff70 : 0xffb060);
    this.muzzleLight.intensity = def.cls === 'wonder' ? 5 : 10;
    this.muzzleLight.position.copy(origin).addScaledVector(fwd, 0.8);
  }

  private hitscan(origin: THREE.Vector3, dir: THREE.Vector3, def: WeaponDef, fx: boolean) {
    const g = this.game;
    const maxD = 120;
    const wallHit = g.level.raycast(origin, dir, maxD, this.rayHit);
    const wallT = wallHit ? this.rayHit.t : maxD;
    this.raycaster.set(origin, dir);
    this.raycaster.near = 0;
    this.raycaster.far = wallT;
    const hits = this.raycaster.intersectObjects(g.zombies.targets(), false);
    const seen = new Set<Zombie>();
    let pen = def.penetrate;
    let mult = 1;
    let stopped = false;
    let hit = false;
    let kill = false;
    for (const h of hits) {
      const z = h.object.userData.zombie as Zombie | undefined;
      if (!z || z.dead || seen.has(z)) continue;
      seen.add(z);
      const part = h.object.userData.part as HitPart;
      let dmg = def.damage * mult * (part === 'head' ? def.headMult : part === 'limb' ? 0.8 : 1);
      if (def.falloff) {
        const [a, b, m] = def.falloff;
        const t = clamp((h.distance - a) / (b - a), 0, 1);
        dmg *= 1 - t * (1 - m);
      }
      hit = true;
      if (g.zombies.damage(z, dmg, part, 'bullet', dir, { point: h.point, force: FORCE[def.cls] })) kill = true;
      g.particles.blood(h.point, dir.clone().negate(), def.pellets > 1 ? 4 : 9, 1);
      if (pen-- <= 0) {
        stopped = true;
        break;
      }
      mult *= 0.7;
    }
    if (!stopped && wallHit) {
      const p = origin.clone().addScaledVector(dir, wallT);
      const n = new THREE.Vector3(this.rayHit.nx, this.rayHit.ny, this.rayHit.nz);
      g.particles.impact(p, n, fx);
      g.decals.bulletHole(p, n);
    }
    return { hit, kill };
  }

  /** 连锁闪电：先打中准星方向的第一只，再跳到附近的丧尸 */
  private fireChain(origin: THREE.Vector3, dir: THREE.Vector3, def: WeaponDef) {
    const g = this.game;
    const chain = def.chain!;
    const maxD = 45;
    const wallHit = g.level.raycast(origin, dir, maxD, this.rayHit);
    const wallT = wallHit ? this.rayHit.t : maxD;
    this.raycaster.set(origin, dir);
    this.raycaster.near = 0;
    this.raycaster.far = wallT;
    const hits = this.raycaster.intersectObjects(g.zombies.targets(), false);
    // 枪模在第一人称场景里，闪电起点取镜头前下方近似枪口位置
    const start = origin.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.12, 0));
    let first: Zombie | null = null;
    for (const h of hits) {
      const z = h.object.userData.zombie as Zombie | undefined;
      if (z && !z.dead) {
        first = z;
        break;
      }
    }
    if (!first) {
      const end = origin.clone().addScaledVector(dir, wallT);
      g.lightning.bolt(start, end);
      g.particles.sparks(end, 0x9fd8ff);
      g.audio.lightning(end);
      return;
    }
    const hitSet = new Set<Zombie>();
    let from = start;
    let cur: Zombie | null = first;
    let dmg = def.damage;
    let kills = 0;
    while (cur && hitSet.size < chain.targets) {
      hitSet.add(cur);
      const chest = new THREE.Vector3(cur.pos.x, cur.pos.y + 1.2, cur.pos.z);
      g.lightning.bolt(from, chest);
      g.particles.sparks(chest, 0x9fd8ff);
      if (g.zombies.damage(cur, dmg, 'torso', 'bullet', dir, { point: chest, force: 2, kind: 'lightning' })) kills++;
      from = chest;
      dmg *= 0.92;
      // 找下一个最近的、没被电过的、中间没有墙的丧尸
      let next: Zombie | null = null;
      let bestD = chain.range;
      for (const z of g.zombies.list) {
        if (z.dead || hitSet.has(z)) continue;
        const d = Math.hypot(z.pos.x - chest.x, z.pos.y + 1.2 - chest.y, z.pos.z - chest.z);
        if (d >= bestD) continue;
        const to = new THREE.Vector3(z.pos.x - chest.x, z.pos.y + 1.2 - chest.y, z.pos.z - chest.z).normalize();
        if (g.level.raycast(chest, to, d, this.rayHit)) continue;
        bestD = d;
        next = z;
      }
      cur = next;
    }
    g.stats.hits++;
    g.hud.hitmarker(kills > 0);
    g.audio.lightning(from);
  }

  /** 近战命中判定：面前扇形内最近的几只；准星正对的那只打到头算爆头（×1.5） */
  private meleeHit(atk: MeleeAttack, heavy: boolean) {
    const g = this.game;
    const pl = g.player;
    const p = pl.pos;
    const gy = pl.groundY;
    const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
    const cosArc = Math.cos(atk.arc);
    const cands: [Zombie, number][] = [];
    for (const z of g.zombies.list) {
      if (z.dead || z.state === 'rising' || z.state === 'approach' || z.state === 'scaling') continue;
      if (Math.abs(z.pos.y - gy) > 1.3) continue;
      const dx = z.pos.x - p.x, dz = z.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > atk.range + z.radius) continue;
      if (d > 0.45 && (dx * fx + dz * fz) / d < cosArc) continue;
      // 隔着墙砍不到（窗户可以）
      const through = z.state === 'tearing' || z.state === 'attacking';
      if (d > 0.5 && !through && !g.level.segmentClear(p.x, p.z, z.pos.x - (dx / d) * 0.4, z.pos.z - (dz / d) * 0.4, 0.05, gy, z.pos.y)) continue;
      cands.push([z, d]);
    }
    cands.sort((a, b) => a[1] - b[1]);
    const cam = g.camera;
    const o = cam.getWorldPosition(this.tmpO);
    const look = cam.getWorldDirection(this.tmpD);
    this.raycaster.set(o, look);
    this.raycaster.near = 0;
    this.raycaster.far = atk.range + 0.6;
    const aimed = this.raycaster.intersectObjects(g.zombies.targets(), false).find((h) => !(h.object.userData.zombie as Zombie).dead);
    const dir = new THREE.Vector3(fx, 0, fz);
    let kill = false;
    let last: THREE.Vector3 | null = null;
    for (const [z] of cands.slice(0, atk.targets)) {
      const head = !!aimed && aimed.object.userData.zombie === z && aimed.object.userData.part === 'head';
      const pt = head ? aimed!.point.clone() : new THREE.Vector3(z.pos.x - fx * z.radius, z.pos.y + 1.2, z.pos.z - fz * z.radius);
      if (g.zombies.damage(z, atk.damage * (head ? 1.5 : 1), head ? 'head' : 'torso', 'melee', dir, { point: pt, force: atk.force })) kill = true;
      g.particles.blood(pt, dir.clone().negate(), heavy ? 18 : 12, 1.2);
      last = pt;
    }
    if (last) {
      g.audio.fleshHit(last, heavy);
      g.hud.hitmarker(kill);
      g.stats.hits++;
      pl.shakeFor(heavy ? 0.12 : 0.05);
    } else if (g.level.raycast(o, look, atk.range, this.rayHit)) {
      // 砍到墙上：溅火星
      const hp = o.clone().addScaledVector(look, this.rayHit.t);
      g.particles.impact(hp, new THREE.Vector3(this.rayHit.nx, this.rayHit.ny, this.rayHit.nz), true);
      g.audio.dryFire();
    }
  }

  /** 近战手臂当前的姿势：待机，或者按攻击进度在关键帧之间平滑插值 */
  private meleePose() {
    const idle: MeleeKey = { t: 0, hand: HAND_IDLE, wrist: this.melee.idle };
    const sw = this.swing;
    if (!sw) return idle;
    const keys = [idle, ...MELEE_ANIMS[sw.anim].keys, { ...idle, t: 1 }];
    let k = 0;
    while (k < keys.length - 2 && sw.t > keys[k + 1].t) k++;
    const a = keys[k], b = keys[k + 1];
    const u = smoothstep((sw.t - a.t) / Math.max(1e-4, b.t - a.t));
    const mix = (x: number[], y: number[]) => x.map((v, i) => lerp(v, y[i], u)) as [number, number, number];
    return { t: sw.t, hand: mix(a.hand, b.hand), wrist: mix(a.wrist, b.wrist) };
  }

  private updateViewmodel(dt: number) {
    const g = this.game;
    const inp = g.input;
    const pl = g.player;
    const w = this.current;
    const m = w.model;
    const ads = this.adsT;

    const cls = w.def.cls;
    const hip = w.def.vm ? new THREE.Vector3(...w.def.vm.hip) : HIP[cls];
    const adsZ = w.def.vm ? w.def.vm.adsZ : ADS_Z[cls];
    const pos = new THREE.Vector3().lerpVectors(hip, new THREE.Vector3(0, -m.sightY, adsZ), ads);
    // 光学镜开到底：藏起枪模，换成全屏镜头画面
    const scoped = !!w.def.scope && ads > 0.88 && !pl.dead;
    this.holder.visible = !scoped;
    g.hud.setScope(scoped ? w.def.scope! : null);
    // 腰射时枪口略微朝向准星
    let rx = 0, ry = 0.035 * (1 - ads), rz = 0;

    const { phase, amt } = pl.bobPhase();
    const bobS = amt * (1 - ads * 0.85) * (1 + this.sprintT * 0.8);
    pos.x += Math.sin(phase) * 0.012 * bobS;
    pos.y -= Math.abs(Math.cos(phase)) * 0.013 * bobS;
    rz += Math.sin(phase) * 0.02 * bobS;

    this.swayX += (clamp(-inp.mouseDX * 0.0005, -0.05, 0.05) - this.swayX) * damp(9, dt);
    this.swayY += (clamp(inp.mouseDY * 0.0005, -0.05, 0.05) - this.swayY) * damp(9, dt);
    const swayK = 1 - ads * 0.75;
    pos.x += this.swayX * swayK;
    pos.y += this.swayY * swayK;
    ry += this.swayX * 1.6 * swayK;
    rx -= this.swayY * 1.2 * swayK;

    const s = this.sprintT;
    pos.x += 0.03 * s;
    pos.y -= 0.05 * s;
    ry += 0.75 * s;
    rx -= 0.28 * s;
    rz += 0.2 * s;

    this.kickV *= Math.exp(-15 * dt);
    pos.z += this.kickV * 0.03;
    rx += this.kickV * 0.08 * (1 - ads * 0.6);

    if (this.reloadT >= 0) {
      const p = 1 - this.reloadT / this.reloadDur;
      const r = smoothstep(p / 0.2) * smoothstep((1 - p) / 0.2);
      pos.y -= 0.06 * r;
      pos.x -= 0.02 * r;
      rz += 0.55 * r;
      rx += 0.22 * r + Math.sin(p * Math.PI * 4) * 0.03 * r;
    }
    if (this.switchT >= 0) {
      const l = this.switchT < SWITCH_HALF ? this.switchT / SWITCH_HALF : 1 - (this.switchT - SWITCH_HALF) / SWITCH_HALF;
      pos.y -= 0.3 * l;
      rx -= 0.6 * l;
    }
    let dr = 0;
    if (this.drinkT >= 0) {
      const elapsed = 2.1 - this.drinkT;
      dr = smoothstep(elapsed / 0.3) * smoothstep(this.drinkT / 0.3);
      pos.y -= 0.4 * dr;
    }
    this.carryT += ((this.carrying ? 1 : 0) - this.carryT) * damp(10, dt);
    pos.y -= 0.35 * this.carryT;
    rx -= 0.5 * this.carryT;
    if (pl.dead) pos.y -= 0.5 * Math.min(1, pl.deathT);

    this.holder.position.copy(pos);
    this.holder.rotation.set(rx, ry, rz);

    // 近战手臂：跟枪一样的晃动 / 换武器 / 冲刺偏移，再叠上挥砍姿势
    if (this.meleeOut) {
      const pose = this.meleePose();
      const off = _off.copy(pos).sub(hip);
      const hand = _hand.set(...pose.hand).add(off);
      hand.x += 0.05 * s;
      hand.y -= 0.05 * s;
      this.meleeWrist.position.copy(hand);
      this.meleeWrist.rotation.set(pose.wrist[0] + 0.3 * s, pose.wrist[1], pose.wrist[2] - 0.4 * s + rz);
      // 袖子从肩膀拉到手
      const sh = _sh.set(...SHOULDER).addScaledVector(off, 0.5);
      const d = _dir.subVectors(hand, sh);
      const len = d.length();
      this.meleeSleeve.position.copy(sh);
      this.meleeSleeve.quaternion.setFromUnitVectors(_zAxis, d.divideScalar(len));
      this.meleeSleeve.scale.set(1, 1, len + 0.03);
    }

    // 饮料瓶：举到嘴边
    this.bottle.group.visible = this.drinkT >= 0;
    if (this.drinkT >= 0) {
      const elapsed = 2.1 - this.drinkT;
      const up = smoothstep((elapsed - 0.15) / 0.45) * smoothstep((this.drinkT - 0.05) / 0.35);
      this.bottle.group.position.set(lerp(0.2, 0.03, up), lerp(-0.4, -0.08, up), -0.25);
      this.bottle.group.rotation.set(lerp(0, 0.9, smoothstep((elapsed - 0.5) / 0.4)) * up, 0, lerp(-0.3, 0.2, up));
    }

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 200);

    // 按所处位置的亮度给枪模调光，避免暗处枪亮得突兀
    const lvl = g.level.lightLevelAt(pl.pos) + (this.muzzleLight.intensity > 0 ? 0.6 : 0);
    const k = clamp(lvl, 0.3, 1.1);
    (this.vmLights[0] as THREE.AmbientLight).intensity = 0.3 * k;
    (this.vmLights[1] as THREE.DirectionalLight).intensity = 1.0 * k;
    (this.vmLights[2] as THREE.HemisphereLight).intensity = 0.35 * k;
    g.vmScene.environmentIntensity = 0.35 * k;
  }
}

const _off = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** 在 fwd 周围的圆锥内随机一个方向 */
function coneDir(fwd: THREE.Vector3, spread: number) {
  _r.crossVectors(fwd, UP);
  if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
  _r.normalize();
  _u.crossVectors(_r, fwd).normalize();
  const a = spread * Math.sqrt(Math.random());
  const th = Math.random() * Math.PI * 2;
  const t = Math.tan(a);
  return new THREE.Vector3()
    .copy(fwd)
    .addScaledVector(_r, t * Math.cos(th))
    .addScaledVector(_u, t * Math.sin(th))
    .normalize();
}
