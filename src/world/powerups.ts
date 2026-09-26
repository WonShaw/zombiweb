import * as THREE from 'three';
import type { Game } from '../game';
import * as TX from '../core/textures';
import type { PowerupKind } from '../core/textures';
import { pick } from '../core/util';

interface Drop {
  kind: PowerupKind;
  group: THREE.Group;
  pos: THREE.Vector3;
  t: number;
}

export const POWERUP_INFO: Record<PowerupKind, { name: string; announce: string }> = {
  carpenter: { name: 'Carpenter', announce: '木匠！所有路障已修复' },
  instakill: { name: 'Insta-Kill', announce: '一击必杀！' },
  double: { name: 'Double Points', announce: '双倍积分！' },
  nuke: { name: 'Nuke', announce: '核弹！' },
  firesale: { name: 'Fire Sale', announce: '箱子特卖！神秘箱只要 10 分' },
};

const KINDS: PowerupKind[] = ['carpenter', 'instakill', 'double', 'nuke', 'firesale'];

export class Powerups {
  drops: Drop[] = [];
  instakill = 0;
  double = 0;
  firesale = 0;
  private icons: Record<PowerupKind, THREE.MeshBasicMaterial>;
  private glowMat: THREE.SpriteMaterial;
  private planeGeo = new THREE.PlaneGeometry(0.62, 0.62);

  constructor(private game: Game) {
    this.icons = {} as Record<PowerupKind, THREE.MeshBasicMaterial>;
    for (const k of KINDS) {
      this.icons[k] = new THREE.MeshBasicMaterial({
        map: TX.powerupTexture(k),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
    }
    this.glowMat = new THREE.SpriteMaterial({
      map: TX.glowTexture(),
      color: 0x3dff5a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  }

  spawn(pos: THREE.Vector3, kind?: PowerupKind) {
    const k = kind ?? pick(KINDS);
    const group = new THREE.Group();
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(1.5);
    group.add(glow);
    const icon = new THREE.Mesh(this.planeGeo, this.icons[k]);
    group.add(icon);
    group.position.set(pos.x, 1.0, pos.z);
    this.game.scene.add(group);
    this.drops.push({ kind: k, group, pos: pos.clone(), t: 0 });
    this.game.audio.powerupSpawn(group.position);
  }

  update(dt: number) {
    const g = this.game;
    this.instakill = Math.max(0, this.instakill - dt);
    this.double = Math.max(0, this.double - dt);
    this.firesale = Math.max(0, this.firesale - dt);
    const p = g.player.pos;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      d.group.position.y = 1.0 + Math.sin(d.t * 2.5) * 0.12;
      d.group.children[1].rotation.y += dt * 1.8;
      // 快消失时闪烁
      d.group.visible = d.t < 20 || Math.floor(d.t * (d.t > 24 ? 10 : 5)) % 2 === 0;
      if (Math.hypot(d.pos.x - p.x, d.pos.z - p.z) < 1.1 && !g.player.dead) {
        this.apply(d.kind);
        this.remove(i);
        continue;
      }
      if (d.t > 27) this.remove(i);
    }
  }

  private remove(i: number) {
    this.game.scene.remove(this.drops[i].group);
    this.drops.splice(i, 1);
  }

  private apply(k: PowerupKind) {
    const g = this.game;
    g.audio.powerupGrab();
    g.hud.announce(POWERUP_INFO[k].announce, POWERUP_INFO[k].name);
    switch (k) {
      case 'carpenter':
        g.level.repairAll();
        g.addPoints(200);
        g.audio.carpenter();
        break;
      case 'firesale':
        this.firesale = 30;
        g.audio.fireSale();
        break;
      case 'instakill':
        this.instakill = 30;
        break;
      case 'double':
        this.double = 30;
        break;
      case 'nuke':
        g.zombies.nuke();
        g.addPoints(400);
        g.hud.flash();
        g.audio.explosion(null, true);
        break;
    }
  }
}
