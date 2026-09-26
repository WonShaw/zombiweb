import * as THREE from 'three';
import { WEAPONS, type WeaponDef } from './defs';
import { buildGun, buildKnife, buildBottle, type GunModel } from './models';
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
}

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

export class WeaponSystem {
  owned: Owned[] = [];
  cur = 0;
  adsT = 0;
  vmRoot = new THREE.Group();
  private holder = new THREE.Group();
  private knifeModel: THREE.Group;
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
  private knifeT = -1;
  private knifeHit = false;
  private drinkT = -1;
  private drinkDone: (() => void) | null = null;
  private triggerHeld = false;
  private burstLeft = 0;
  private sprintT = 0;
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

    this.knifeModel = buildKnife();
    this.knifeModel.visible = false;
    this.vmRoot.add(this.knifeModel);
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
    return this.knifeT >= 0 || this.drinkT >= 0 || this.switchT >= 0;
  }
  get drinking() {
    return this.drinkT >= 0;
  }
  get canSprint() {
    return this.knifeT < 0 && this.drinkT < 0;
  }
  get moveMult() {
    return this.current?.def.move ?? 1;
  }
  /** 当前散布，HUD 准星用 */
  get spreadNow() {
    const d = this.current.def;
    const pl = this.game.player;
    return lerp(d.hipSpread, d.adsSpread, this.adsT) * (1 + (pl.speedNow / 6) * 0.9) * (pl.onGround ? 1 : 2) + this.bloom;
  }

  has(id: string) {
    return this.owned.some((o) => o.def.id === id);
  }

  /** 获得武器。两把满了就替换 slot 指定的槽位（默认手上这把）；已有同款就只补满弹匣 */
  give(id: string, slot = this.cur) {
    const def = WEAPONS[id];
    const existing = this.owned.findIndex((o) => o.def.id === id);
    if (existing >= 0) {
      this.owned[existing].mag = def.mag;
      return;
    }
    const model = buildGun(def.model, true);
    model.group.visible = false;
    this.holder.add(model.group);
    const w: Owned = { def, mag: def.mag, model };
    let idx: number;
    if (this.owned.length < 2) {
      this.owned.push(w);
      idx = this.owned.length - 1;
    } else {
      idx = clamp(slot, 0, 1);
      this.holder.remove(this.owned[idx].model.group);
      this.owned[idx] = w;
    }
    this.cur = idx;
    this.showCurrent();
    // 从下方抬起
    this.switchT = SWITCH_HALF;
    this.switchTo = idx;
    this.swapped = true;
    this.reloadT = -1;
    this.burstLeft = 0;
  }

  private showCurrent() {
    this.owned.forEach((o, i) => (o.model.group.visible = i === this.cur));
    this.current.model.muzzle.add(this.flash);
  }

  private startReload() {
    const w = this.current;
    if (this.reloadT >= 0 || w.mag >= w.def.mag) return;
    this.reloadDur = w.def.reload * (this.game.player.perks.has('speed') ? 0.5 : 1);
    this.reloadT = this.reloadDur;
    this.reloadStage = 0;
  }

  private beginSwitch(i: number) {
    if (i === this.cur || i < 0 || i >= this.owned.length || this.busy) return;
    this.switchTo = i;
    this.switchT = 0;
    this.swapped = false;
    this.reloadT = -1;
    this.burstLeft = 0;
  }

  startKnife() {
    if (this.knifeT >= 0 || this.drinkT >= 0) return;
    this.knifeT = 0;
    this.knifeHit = false;
    this.reloadT = -1;
    this.game.audio.knifeSwing();
  }

  drink(color: string, done: () => void) {
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
      if (this.knifeT >= 0) {
        this.knifeT += dt;
        if (!this.knifeHit && this.knifeT > 0.13) {
          this.knifeHit = true;
          this.knifeStrike();
        }
        if (this.knifeT > 0.5) this.knifeT = -1;
      }
      if (this.switchT >= 0) {
        this.switchT += dt;
        if (!this.swapped && this.switchT >= SWITCH_HALF) {
          this.swapped = true;
          this.cur = this.switchTo;
          this.showCurrent();
        }
        if (this.switchT >= SWITCH_HALF * 2) this.switchT = -1;
      }
      if (this.reloadT >= 0) this.updateReload(dt);

      const busy = this.busy;
      const wantAds = inp.mouseDown[2] && !busy && !pl.sprinting;
      this.adsT += ((wantAds ? 1 : 0) - this.adsT) * damp(13, dt);
      this.sprintT += ((pl.sprinting ? 1 : 0) - this.sprintT) * damp(10, dt);

      if (!busy) {
        if (inp.wasPressed('KeyR')) this.startReload();
        if (inp.wasPressed('Digit1')) this.beginSwitch(0);
        if (inp.wasPressed('Digit2')) this.beginSwitch(1);
        if ((inp.wheel !== 0 || inp.wasPressed('KeyQ')) && this.owned.length > 1) this.beginSwitch(1 - this.cur);
      }
      if (inp.wasPressed('KeyV') || inp.mousePressed[1]) this.startKnife();

      const trig = inp.mouseDown[0];
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
      this.adsT += (0 - this.adsT) * damp(8, dt);
    }

    this.updateViewmodel(dt);
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
        g.audio.hitmarker();
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
      if (g.zombies.damage(z, dmg, part, 'bullet', dir)) kill = true;
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
      if (g.zombies.damage(cur, dmg, 'torso', 'bullet', dir)) kills++;
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

  private knifeStrike() {
    const g = this.game;
    const p = g.player.pos;
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    let best: Zombie | null = null;
    let bestD = 1.75;
    for (const z of g.zombies.list) {
      if (z.dead || z.state === 'rising' || z.state === 'approach') continue;
      const dx = z.pos.x - p.x, dz = z.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      if (d > 0.5 && (dx * fx + dz * fz) / d < 0.55) continue;
      // 隔着墙砍不到（窗户可以）
      if (d > 0.5 && !g.level.segmentClear(p.x, p.z, z.pos.x - dx / d * 0.4, z.pos.z - dz / d * 0.4, 0.05) && z.state !== 'tearing' && z.state !== 'attacking') continue;
      best = z;
      bestD = d;
    }
    if (!best) return;
    const hp = new THREE.Vector3(best.pos.x, best.pos.y + 1.3, best.pos.z);
    const dir = new THREE.Vector3(fx, 0, fz);
    const killed = g.zombies.damage(best, 150, 'torso', 'melee', dir);
    g.particles.blood(hp, dir.clone().negate(), 14, 1.2);
    g.audio.fleshHit(hp, true);
    g.hud.hitmarker(killed);
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
    let kn = 0;
    if (this.knifeT >= 0) {
      kn = Math.sin(clamp(this.knifeT / 0.5, 0, 1) * Math.PI);
      pos.y -= 0.14 * kn;
      pos.x += 0.06 * kn;
      rz -= 0.3 * kn;
    }
    let dr = 0;
    if (this.drinkT >= 0) {
      const elapsed = 2.1 - this.drinkT;
      dr = smoothstep(elapsed / 0.3) * smoothstep(this.drinkT / 0.3);
      pos.y -= 0.4 * dr;
    }
    if (pl.dead) pos.y -= 0.5 * Math.min(1, pl.deathT);

    this.holder.position.copy(pos);
    this.holder.rotation.set(rx, ry, rz);

    // 刀：从右下方向前刺
    this.knifeModel.visible = this.knifeT >= 0;
    if (this.knifeT >= 0) {
      const t = clamp(this.knifeT / 0.5, 0, 1);
      const stab = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
      this.knifeModel.position.set(lerp(0.22, 0.02, stab), lerp(-0.25, -0.07, stab), lerp(-0.18, -0.42, stab));
      this.knifeModel.rotation.set(lerp(0.3, -0.1, stab), lerp(0.5, 0.1, stab), lerp(-0.6, -1.3, stab));
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
