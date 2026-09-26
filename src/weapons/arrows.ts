import * as THREE from 'three';
import type { Game } from '../game';
import type { WeaponDef } from './defs';
import type { Zombie } from '../entities/zombies';
import type { HitPart } from '../entities/zombieModel';
import type { RayHit } from '../world/level';

interface Arrow {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  def: WeaponDef;
  /** 拉弓力度 0..1（弩恒为 1） */
  power: number;
  /** 还能再穿透几只 */
  pierce: number;
  mult: number;
  hit: Set<Zombie>;
  life: number;
  /** 插在墙上 / 丧尸身上后还能留多久 */
  stuck: number;
}

const MAX_STUCK = 24;

/** 箭 / 弩箭：真实飞行、受重力下坠，射中丧尸会插在它身上（跟着肢体动），射中墙插在墙上 */
export class Arrows {
  private list: Arrow[] = [];
  private stuckList: Arrow[] = [];
  private raycaster = new THREE.Raycaster();
  private hit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0 };
  private templates = new Map<number, THREE.Group>();
  private shaft = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.5, metalness: 0.3 });
  private tipMat = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.25, metalness: 0.9 });
  private vane = new THREE.MeshStandardMaterial({ color: 0xd8401c, roughness: 0.6, side: THREE.DoubleSide });
  private vane2 = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.6, side: THREE.DoubleSide });

  constructor(private game: Game) {}

  /** 一支箭的模型：箭尖朝 -z，原点在箭尖 */
  private model(len: number) {
    let t = this.templates.get(len);
    if (!t) {
      t = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, len - 0.03, 6), this.shaft);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.z = 0.03 + (len - 0.03) / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0075, 0.035, 8), this.tipMat);
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = 0.017;
      t.add(shaft, tip);
      for (let k = 0; k < 3; k++) {
        const v = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.07), k ? this.vane2 : this.vane);
        v.rotation.set(Math.PI / 2, 0, (k * Math.PI * 2) / 3);
        v.position.z = len - 0.06;
        v.translateY(0.0075);
        t.add(v);
      }
      this.templates.set(len, t);
    }
    return t.clone();
  }

  fire(origin: THREE.Vector3, dir: THREE.Vector3, def: WeaponDef, power: number) {
    const a = def.arrow!;
    const mesh = this.model(a.len);
    const speed = a.speed * (0.45 + 0.55 * power);
    const arrow: Arrow = {
      mesh,
      pos: origin.clone(),
      vel: dir.clone().multiplyScalar(speed),
      def,
      power,
      pierce: power > 0.95 ? def.penetrate : 0,
      mult: 1,
      hit: new Set(),
      life: 4,
      stuck: 0,
    };
    mesh.position.copy(origin);
    mesh.lookAt(origin.clone().sub(dir));
    this.game.scene.add(mesh);
    this.list.push(arrow);
  }

  update(dt: number) {
    const g = this.game;
    const tmp = new THREE.Vector3();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      a.life -= dt;
      a.vel.y -= a.def.arrow!.gravity * dt;
      const step = a.vel.length() * dt;
      const dir = tmp.copy(a.vel).normalize();
      let wallT = Infinity;
      if (g.level.raycast(a.pos, dir, step, this.hit)) wallT = this.hit.t;
      this.raycaster.set(a.pos, dir);
      this.raycaster.near = 0;
      this.raycaster.far = Math.min(step, wallT);
      let stuckTo: THREE.Object3D | null = null;
      let stopAt = Infinity;
      for (const h of this.raycaster.intersectObjects(g.zombies.targets(), false)) {
        const z = h.object.userData.zombie as Zombie | undefined;
        if (!z || z.dead || a.hit.has(z)) continue;
        a.hit.add(z);
        const part = h.object.userData.part as HitPart;
        const d = a.def;
        const dmg = d.damage * (0.3 + 0.7 * a.power) * a.mult * (part === 'head' ? d.headMult : part === 'limb' ? 0.8 : 1);
        const killed = g.zombies.damage(z, dmg, part, 'bullet', dir.clone(), { point: h.point.clone(), force: 1.5 + a.power * 1.5 });
        g.particles.blood(h.point, dir.clone().negate(), 10, 1);
        g.audio.fleshHit(h.point, true);
        g.stats.hits++;
        g.hud.hitmarker(killed, part === 'head');
        if (a.pierce > 0) {
          a.pierce--;
          a.mult *= 0.75;
          continue;
        }
        stuckTo = h.object;
        stopAt = h.distance;
        break;
      }
      if (stuckTo) {
        // 插进丧尸身上：挂到被射中的那块肢体上，跟着一起动
        a.pos.addScaledVector(dir, stopAt + 0.08);
        a.mesh.position.copy(a.pos);
        a.mesh.lookAt(a.pos.clone().sub(dir));
        stuckTo.attach(a.mesh);
        this.stick(i, 30);
        continue;
      }
      if (wallT < Infinity) {
        // 插在墙上 / 地上
        a.pos.addScaledVector(dir, wallT + 0.04);
        a.mesh.position.copy(a.pos);
        a.mesh.lookAt(a.pos.clone().sub(dir));
        const p = a.pos.clone();
        g.particles.impact(p, new THREE.Vector3(this.hit.nx, this.hit.ny, this.hit.nz), false);
        g.audio.dryFire();
        this.stick(i, 12);
        continue;
      }
      a.pos.addScaledVector(dir, step);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.pos.clone().sub(dir));
      if (a.life <= 0) this.remove(a), this.list.splice(i, 1);
    }
    for (let i = this.stuckList.length - 1; i >= 0; i--) {
      const a = this.stuckList[i];
      a.stuck -= dt;
      if (a.stuck <= 0 || !a.mesh.parent) {
        this.remove(a);
        this.stuckList.splice(i, 1);
      }
    }
  }

  private stick(i: number, seconds: number) {
    const a = this.list[i];
    this.list.splice(i, 1);
    a.stuck = seconds;
    this.stuckList.push(a);
    // 插着的箭太多就把最早的收掉
    if (this.stuckList.length > MAX_STUCK) this.remove(this.stuckList.shift()!);
  }

  private remove(a: Arrow) {
    a.mesh.removeFromParent();
  }
}
