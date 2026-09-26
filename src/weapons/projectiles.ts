import * as THREE from 'three';
import type { Game } from '../game';
import type { WeaponDef } from './defs';
import type { Zombie } from '../entities/zombies';
import type { HitPart } from '../entities/zombieModel';
import type { RayHit } from '../world/level';
import * as TX from '../core/textures';

interface Bolt {
  group: THREE.Group;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  life: number;
  def: WeaponDef;
  trailT: number;
}

/** 射线枪能量弹、火箭弹：飞行、命中、范围爆炸 */
export class Projectiles {
  private list: Bolt[] = [];
  private rayGeo = new THREE.CapsuleGeometry(0.035, 0.35, 4, 8);
  private rayMat = new THREE.MeshBasicMaterial({ color: 0xaaffb0 });
  private rayGlow: THREE.SpriteMaterial;
  private rocketBody: THREE.BufferGeometry;
  private rocketHead: THREE.BufferGeometry;
  private rocketMat = new THREE.MeshStandardMaterial({ color: 0x4b5231, roughness: 0.6, metalness: 0.4 });
  private flameGlow: THREE.SpriteMaterial;
  private raycaster = new THREE.Raycaster();
  private hit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0 };

  constructor(private game: Game) {
    this.rayGeo.rotateX(Math.PI / 2);
    const glowTex = TX.glowTexture();
    this.rayGlow = new THREE.SpriteMaterial({ map: glowTex, color: 0x40ff60, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flameGlow = new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.rocketBody = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 10);
    this.rocketBody.rotateX(Math.PI / 2);
    this.rocketHead = new THREE.ConeGeometry(0.045, 0.16, 10);
    this.rocketHead.rotateX(-Math.PI / 2);
    this.rocketHead.translate(0, 0, -0.25);
  }

  fire(origin: THREE.Vector3, dir: THREE.Vector3, def: WeaponDef) {
    const group = new THREE.Group();
    if (def.projectile!.kind === 'rocket') {
      group.add(new THREE.Mesh(this.rocketBody, this.rocketMat));
      group.add(new THREE.Mesh(this.rocketHead, this.rocketMat));
      const flame = new THREE.Sprite(this.flameGlow);
      flame.position.z = 0.25;
      flame.scale.setScalar(0.45);
      group.add(flame);
      this.game.audio.rocketLaunch();
    } else {
      group.add(new THREE.Mesh(this.rayGeo, this.rayMat));
      const glow = new THREE.Sprite(this.rayGlow);
      glow.scale.setScalar(0.7);
      group.add(glow);
    }
    group.position.copy(origin);
    group.lookAt(origin.clone().sub(dir));
    this.game.scene.add(group);
    this.list.push({ group, pos: origin.clone(), dir: dir.clone(), life: 3, def, trailT: 0 });
  }

  update(dt: number) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const pr = b.def.projectile!;
      const step = pr.speed * dt;
      let hitT = Infinity;
      let target: { z: Zombie; part: HitPart } | null = null;
      if (g.level.raycast(b.pos, b.dir, step, this.hit)) hitT = this.hit.t;
      this.raycaster.set(b.pos, b.dir);
      this.raycaster.far = Math.min(step, hitT);
      const hits = this.raycaster.intersectObjects(g.zombies.targets(), false);
      for (const h of hits) {
        const z = h.object.userData.zombie as Zombie;
        if (z && !z.dead) {
          hitT = h.distance;
          target = { z, part: h.object.userData.part };
          break;
        }
      }
      b.life -= dt;
      if (hitT < Infinity) {
        const p = b.pos.clone().addScaledVector(b.dir, hitT);
        if (target) {
          g.stats.hits++;
          const killed = g.zombies.damage(target.z, b.def.damage, target.part, 'bullet', b.dir);
          g.hud.hitmarker(killed);
          g.audio.hitmarker();
        }
        // 爆炸点稍微往回退一点，避免贴墙时爆炸被墙挡住
        this.explode(p.addScaledVector(b.dir, -0.15), b.def);
        this.kill(i);
        continue;
      }
      b.pos.addScaledVector(b.dir, step);
      b.group.position.copy(b.pos);
      if (pr.kind === 'rocket') {
        b.trailT -= dt;
        if (b.trailT <= 0) {
          b.trailT = 0.015;
          g.particles.smoke(b.pos.clone().addScaledVector(b.dir, -0.3));
        }
      }
      if (b.life <= 0) {
        if (pr.kind === 'rocket') this.explode(b.pos, b.def);
        this.kill(i);
      }
    }
  }

  private explode(p: THREE.Vector3, def: WeaponDef) {
    const g = this.game;
    const pr = def.projectile!;
    g.zombies.explode(p, pr.splash, pr.splashDamage);
    if (pr.kind === 'rocket') {
      g.particles.explosion(p);
      g.audio.explosion(p, true);
      // 离爆点太近会伤到自己
      const pl = g.player;
      const d = Math.hypot(pl.pos.x - p.x, pl.pos.y + 1 - p.y, pl.pos.z - p.z);
      if (pr.selfDamage && d < pr.splash * 0.75) pl.damage(pr.selfDamage * (1 - d / (pr.splash * 0.75)) + 10, p);
      if (d < 12) pl.shakeFor(0.35 * (1 - d / 12));
    } else {
      g.particles.raygunBurst(p);
      g.audio.explosion(p, false);
    }
  }

  private kill(i: number) {
    this.game.scene.remove(this.list[i].group);
    this.list.splice(i, 1);
  }
}
