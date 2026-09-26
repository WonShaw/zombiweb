import * as THREE from 'three';
import type { Game } from '../game';
import { WEAPONS, BOX_POOL, PERKS, type WeaponDef } from '../weapons/defs';
import { buildGun, type GunModel } from '../weapons/models';
import type { PerkId } from './map';
import type { DoorRT, WindowRT } from './level';
import * as TX from '../core/textures';
import { pick } from '../core/util';

export interface Interactable {
  pos: THREE.Vector3;
  range: number;
  hold?: boolean;
  prompt(): string | null;
  use(): void;
}

const BOX_COST = 950;
const FIRE_SALE_COST = 10;
const REPAIR_CAP = 500;

export class Interactables {
  private list: Interactable[] = [];
  private current: Interactable | null = null;
  private holdT = 0;
  box: MysteryBox;
  private perkGlows: { sprite: THREE.Sprite; floor: THREE.Mesh; t: number }[] = [];
  repairPoints = 0;

  constructor(private game: Game) {
    const lvl = game.level;
    for (const d of lvl.doors) this.list.push(this.door(d));
    for (const w of lvl.windows) this.list.push(this.windowRepair(w));
    for (const p of lvl.def.perks) this.list.push(this.perk(p.perk, p.x, p.z, p.face));
    this.box = new MysteryBox(game);
    this.list.push(this.box);
  }

  private door(d: DoorRT): Interactable {
    const g = this.game;
    return {
      pos: new THREE.Vector3(d.center.x, 1.2, d.center.z),
      range: 2.4,
      prompt: () => (d.open ? null : `按 F 打开门 [花费: ${d.def.cost}]`),
      use: () => {
        if (g.spend(d.def.cost)) g.level.openDoor(d);
      },
    };
  }

  private windowRepair(w: WindowRT): Interactable {
    const g = this.game;
    return {
      pos: new THREE.Vector3(w.inside.x, 1, w.inside.z),
      range: 1.45,
      hold: true,
      prompt: () => (g.level.needsRepair(w) && !w.occupant ? '按住 F 修复路障' : null),
      use: () => {
        if (w.occupant) return;
        if (g.level.repairBoard(w) && this.repairPoints < REPAIR_CAP) {
          this.repairPoints += 10;
          g.addPoints(10);
        }
      },
    };
  }

  private perk(id: PerkId, x: number, z: number, face: [number, number]): Interactable {
    const g = this.game;
    const info = PERKS[id];
    const color = new THREE.Color(info.color);
    const group = new THREE.Group();
    group.position.set(x + 0.5, 0, z + 0.5);
    group.rotation.y = Math.atan2(face[0], face[1]);
    const bodyMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.35, metalness: 0.4 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.5, metalness: 0.6 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(px, py, pz);
      group.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.86, 1.9, 0.7), bodyMat, 0, 1.0, -0.05);
    add(new THREE.BoxGeometry(0.92, 0.1, 0.76), trimMat, 0, 0.05, -0.05);
    add(new THREE.BoxGeometry(0.92, 0.1, 0.76), trimMat, 0, 1.98, -0.05);
    const sign = add(
      new THREE.PlaneGeometry(0.84, 0.21),
      new THREE.MeshBasicMaterial({ map: TX.perkSignTexture(info.name, info.color) }),
      0, 1.72, 0.305,
    );
    sign.renderOrder = 1;
    // 发光的饮料展示窗
    add(new THREE.PlaneGeometry(0.5, 0.62), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.85) }), 0, 1.15, 0.305);
    const bottleMat = new THREE.MeshBasicMaterial({ color: 0x220a06 });
    for (let i = -1; i <= 1; i++) {
      const b = add(new THREE.CylinderGeometry(0.045, 0.05, 0.22, 10), bottleMat, i * 0.14, 1.1, 0.31);
      b.scale.z = 0.2;
    }
    add(new THREE.BoxGeometry(0.3, 0.12, 0.08), trimMat, 0, 0.55, 0.3);
    g.scene.add(group);
    // 用发光精灵和地面光斑假装机器照亮了周围
    const glowTex = TX.glowTexture();
    const front = new THREE.Vector3(x + 0.5 + face[0] * 0.75, 1.2, z + 0.5 + face[1] * 0.75);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.position.copy(front);
    sprite.scale.setScalar(2.6);
    g.scene.add(sprite);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(front.x, 0.01, front.z);
    g.scene.add(floor);
    this.perkGlows.push({ sprite, floor, t: Math.random() * 5 });

    return {
      pos: new THREE.Vector3(x + 0.5 + face[0] * 0.9, 1.2, z + 0.5 + face[1] * 0.9),
      range: 1.7,
      prompt: () => (g.player.perks.has(id) || g.weapons.drinking ? null : `按 F 购买 ${info.name} [花费: ${info.cost}] — ${info.desc}`),
      use: () => {
        if (g.player.perks.has(id) || g.weapons.busy) return;
        if (!g.spend(info.cost)) return;
        g.weapons.drink(info.color, () => {
          g.player.perks.add(id);
          if (id === 'jugg') {
            g.player.maxHealth = 250;
            g.player.health = 250;
          }
          g.hud.setPerks([...g.player.perks]);
        });
      },
    };
  }

  /** 固定的交互点 + 玩家放下的自动机枪 */
  private *candidates(): Generator<Interactable> {
    yield* this.list;
    for (const t of this.game.turrets.list) yield t.interact;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player.pos;
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    let best: Interactable | null = null;
    let bestScore = Infinity;
    let bestPrompt: string | null = null;
    if (!g.player.dead) {
      for (const it of this.candidates()) {
        const dx = it.pos.x - p.x, dz = it.pos.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > it.range) continue;
        const dot = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
        if (d > 0.9 && dot < 0.2) continue;
        const pr = it.prompt();
        if (!pr) continue;
        const score = d - dot * 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = it;
          bestPrompt = pr;
        }
      }
    }
    if (best !== this.current) this.holdT = 0.3;
    this.current = best;
    g.hud.setPrompt(bestPrompt);

    if (best) {
      if (best.hold) {
        if (g.input.down('KeyF')) {
          this.holdT += dt;
          if (this.holdT >= 0.5) {
            this.holdT = 0;
            best.use();
          }
        } else this.holdT = 0.3;
      } else if (g.input.wasPressed('KeyF')) best.use();
    }

    this.box.update(dt);
    for (const pg of this.perkGlows) {
      pg.t += dt;
      const k = 0.85 + Math.sin(pg.t * 3) * 0.08 + (Math.random() < 0.01 ? -0.4 : 0);
      pg.sprite.material.opacity = 0.22 * k;
      (pg.floor.material as THREE.MeshBasicMaterial).opacity = 0.3 * k;
    }
  }
}

/** 神秘箱：花 950 分，转 4 秒，随机给一把枪 */
class MysteryBox implements Interactable {
  pos: THREE.Vector3;
  range = 1.9;
  private state: 'idle' | 'rolling' | 'ready' | 'closing' = 'idle';
  private t = 0;
  private lid = new THREE.Group();
  private holder = new THREE.Group();
  private models = new Map<string, GunModel>();
  private shown: GunModel | null = null;
  private final: WeaponDef | null = null;
  private cycleT = 0;
  private glow: THREE.Sprite;

  constructor(private game: Game) {
    const def = game.level.def.box;
    const [a, b] = def.cells;
    const cx = (a[0] + b[0]) / 2 + 0.5, cz = (a[1] + b[1]) / 2 + 0.5;
    const face = def.face;
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.rotation.y = Math.atan2(face[0], face[1]);
    const { map, emissive } = TX.boxTextures();
    const sideMat = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: 0x66ccff, emissiveIntensity: 1.2, roughness: 0.8 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3e2a1c, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 0.78), [woodMat, woodMat, woodMat, woodMat, sideMat, sideMat]);
    body.position.y = 0.31;
    group.add(body);
    this.lid.position.set(0, 0.62, -0.39);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.09, 0.8), woodMat);
    lidMesh.position.set(0, 0.045, 0.39);
    this.lid.add(lidMesh);
    group.add(this.lid);
    this.holder.position.set(0, 0.5, 0.05);
    group.add(this.holder);
    game.scene.add(group);

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: TX.glowTexture(), color: 0x7fd8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.glow.position.set(cx, 1.1, cz);
    this.glow.scale.set(2.4, 1.8, 1);
    game.scene.add(this.glow);

    this.pos = new THREE.Vector3(cx + face[0] * 0.9, 1, cz + face[1] * 0.9);
  }

  private model(id: string) {
    let m = this.models.get(id);
    if (!m) {
      m = buildGun(WEAPONS[id].model, false);
      m.group.rotation.y = Math.PI / 2;
      m.group.scale.setScalar(1.5);
      this.models.set(id, m);
    }
    return m;
  }

  private show(id: string | null) {
    if (this.shown) this.holder.remove(this.shown.group);
    this.shown = id ? this.model(id) : null;
    if (this.shown) this.holder.add(this.shown.group);
  }

  get cost() {
    return this.game.powerups.firesale > 0 ? FIRE_SALE_COST : BOX_COST;
  }

  prompt() {
    if (this.state === 'idle') return `按 F 购买随机武器 [花费: ${this.cost}]`;
    if (this.state === 'ready' && this.final) return `按 F 拿取 ${this.final.name}`;
    return null;
  }

  use() {
    const g = this.game;
    if (this.state === 'idle') {
      if (g.weapons.busy) return;
      if (!g.spend(this.cost)) return;
      const pool = BOX_POOL.filter((w) => !g.weapons.has(w.id));
      this.final = pick(pool.length ? pool : BOX_POOL);
      this.state = 'rolling';
      this.t = 0;
      this.cycleT = 0;
      g.audio.boxJingle(4.2);
    } else if (this.state === 'ready' && this.final) {
      if (g.weapons.busy) return;
      g.weapons.give(this.final.id);
      g.audio.purchase();
      this.close();
    }
  }

  private close() {
    this.state = 'closing';
    this.t = 0;
    this.show(null);
  }

  update(dt: number) {
    this.t += dt;
    const g = this.game;
    this.glow.material.opacity = 0.3 + Math.sin(g.time * 2) * 0.06;
    switch (this.state) {
      case 'idle':
        this.lid.rotation.x = 0;
        break;
      case 'rolling': {
        this.lid.rotation.x = -Math.min(1, this.t / 0.4) * 1.9;
        this.holder.position.y = 0.5 + Math.min(1, this.t / 4) * 0.55;
        this.cycleT -= dt;
        if (this.cycleT <= 0) {
          this.show(pick(BOX_POOL).id);
          this.cycleT = 0.06 + (this.t / 4.2) ** 2 * 0.3;
        }
        if (this.t >= 4.2) {
          this.state = 'ready';
          this.t = 0;
          this.show(this.final!.id);
        }
        break;
      }
      case 'ready':
        this.holder.position.y = 1.05 + Math.sin(this.t * 2) * 0.03;
        // 超时后枪沉回箱子
        if (this.t > 9) this.holder.position.y = 1.05 - (this.t - 9) * 0.5;
        if (this.t > 11) this.close();
        break;
      case 'closing':
        this.lid.rotation.x = -Math.max(0, 1 - this.t / 0.5) * 1.9;
        if (this.t > 0.6) this.state = 'idle';
        break;
    }
  }
}
