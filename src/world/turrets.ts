import * as THREE from 'three';
import type { Game } from '../game';
import type { Zombie } from '../entities/zombies';
import type { HitPart } from '../entities/zombieModel';
import type { RayHit } from './level';
import type { Interactable } from './interactables';
import * as TX from '../core/textures';
import { angleDiff, damp, rand } from '../core/util';

export const TURRET = {
  cost: 4000,
  ammo: 200,
  interval: 0.1, // 600 发/分
  damage: 110,
  range: 20,
  reload: 2.5,
  turnSpeed: 5, // 弧度/秒
  radius: 0.35, // 碰撞半径
  carryDist: 1.4, // 搬运时虚影在玩家前方的距离
  pickupHold: 0.8, // 按住 F 多久搬起
};

/** 自动机枪升级：对所有机枪（包括以后买的）生效 */
export const TURRET_UPGRADES = {
  name: '弹匣扩容',
  icon: '⛓',
  base: `每台机枪一次装 ${TURRET.ammo} 发。`,
  levels: [
    {
      cost: 3000,
      name: '双倍弹匣',
      desc: `所有自动机枪的弹匣容量翻倍，一次装 ${TURRET.ammo * 2} 发。已部署的机枪不会自动补满，打空后上弹时装满。`,
    },
  ],
};

interface Turret {
  id: number;
  pos: THREE.Vector3;
  group: THREE.Group;
  head: THREE.Group;
  muzzle: THREE.Object3D;
  yaw: number;
  pitch: number;
  ammo: number;
  cooldown: number;
  reloadT: number;
  target: Zombie | null;
  retargetT: number;
  flash: THREE.Sprite;
  flashT: number;
  lamp: THREE.MeshBasicMaterial;
  barBg: THREE.Sprite;
  barFill: THREE.Sprite;
  interact: Interactable;
  carried: boolean;
}

/** 正在搬运的机枪：turret 为 null 表示刚买的新机枪 */
interface Carry {
  turret: Turret | null;
  spot: THREE.Vector3;
  yaw: number;
  valid: boolean;
}

const MUZZLE_Y = 1.02;

const TM = {
  metal: new THREE.MeshStandardMaterial({ color: 0x2c2e32, roughness: 0.45, metalness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.5, metalness: 0.7 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x4b5231, roughness: 0.7, metalness: 0.3 }),
};

/** 三脚架 + 可旋转的枪身（枪口朝 -z）。商店缩略图也用它 */
export function buildTurretModel() {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.8, 10), TM.dark);
  post.position.y = 0.45;
  group.add(post);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.75, 8), TM.metal);
    leg.position.set(Math.cos(a) * 0.2, 0.33, Math.sin(a) * 0.2);
    leg.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
    group.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.07), TM.dark);
    foot.position.set(Math.cos(a) * 0.4, 0.01, Math.sin(a) * 0.4);
    group.add(foot);
  }
  const head = new THREE.Group();
  head.position.y = MUZZLE_Y - 0.02;
  head.rotation.order = 'YXZ';
  group.add(head);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    head.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(0.13, 0.14, 0.46), TM.dark, 0, 0.02, 0.02);
  const jacket = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 12);
  jacket.rotateX(Math.PI / 2);
  add(jacket, TM.metal, 0, 0.02, -0.45);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.085, 0.085, 0.015), TM.dark, 0, 0.02, -0.28 - i * 0.08);
  const barrel = new THREE.CylinderGeometry(0.022, 0.026, 0.1, 10);
  barrel.rotateX(Math.PI / 2);
  add(barrel, TM.dark, 0, 0.02, -0.74);
  add(new THREE.BoxGeometry(0.14, 0.17, 0.22), TM.olive, -0.14, -0.02, 0.02);
  add(new THREE.BoxGeometry(0.5, 0.32, 0.02), TM.olive, 0, 0.05, -0.2);
  add(new THREE.BoxGeometry(0.03, 0.1, 0.03), TM.dark, 0.05, -0.06, 0.26);
  add(new THREE.BoxGeometry(0.03, 0.1, 0.03), TM.dark, -0.05, -0.06, 0.26);
  const lamp = new THREE.MeshBasicMaterial({ color: 0x3dff6a });
  add(new THREE.SphereGeometry(0.025, 10, 8), lamp, 0, 0.11, 0.18);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.8);
  head.add(muzzle);
  return { group, head, muzzle, lamp };
}

/** 可部署的自动机枪：自动索敌扫射，打空后需要玩家走过去按 F 上弹 */
export class Turrets {
  list: Turret[] = [];
  private nextId = 1;
  private raycaster = new THREE.Raycaster();
  private rayHit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0 };
  private tracers: { mesh: THREE.Mesh; t: number }[] = [];
  private tracerIdx = 0;
  private flashTex = TX.flashTexture();
  private barTex: THREE.Texture;
  private sound = { freq: 2300, decay: 0.22, thump: 120, vol: 0.5 };
  carry: Carry | null = null;
  /** 弹匣扩容升级的等级 */
  magLevel = 0;
  private ghost: THREE.Group;
  /** 左上角的“机枪没子弹”提示，每台一行 */
  private alertEl = document.getElementById('turret-alert')!;
  private alertTip: HTMLDivElement;
  private alertRows = new Map<number, { el: HTMLDivElement; arr: HTMLElement; txt: HTMLElement; text: string }>();
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x6ee06a, transparent: true, opacity: 0.4, depthWrite: false });

  constructor(private game: Game) {
    // 弹药条用的白色小方块贴图，颜色由材质决定
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const g2 = c.getContext('2d')!;
    g2.fillStyle = '#fff';
    g2.fillRect(0, 0, 4, 4);
    this.barTex = new THREE.CanvasTexture(c);

    const tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1);
    tracerGeo.translate(0, 0, -0.5);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat);
      m.visible = false;
      game.scene.add(m);
      this.tracers.push({ mesh: m, t: 0 });
    }

    // 搬运时显示的半透明虚影 + 地面占位圈
    this.ghost = buildTurretModel().group;
    this.ghost.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = this.ghostMat;
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(TURRET.radius, TURRET.radius + 0.07, 32), this.ghostMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.ghost.add(ring);
    this.ghost.visible = false;
    game.scene.add(this.ghost);

    this.alertTip = document.createElement('div');
    this.alertTip.className = 'ta-tip';
    this.alertTip.textContent = '走到机枪旁按 F 上弹';
    this.alertEl.appendChild(this.alertTip);
  }

  /** 当前每台机枪的弹匣容量 */
  get maxAmmo() {
    return TURRET.ammo * 2 ** this.magLevel;
  }

  /** 买下一级升级：只提高容量，不给已部署的机枪补子弹 */
  upgradeMag() {
    this.magLevel++;
  }

  /** 已放下的 + 正在搬运的新机枪 */
  get count() {
    return this.list.length + (this.carry && !this.carry.turret ? 1 : 0);
  }

  /** 买下新机枪：进入搬运模式，由玩家自己挑位置放 */
  startCarryNew() {
    this.carry = { turret: null, spot: new THREE.Vector3(), yaw: 0, valid: false };
    this.ghost.visible = true;
  }

  /** 按住 F 把已放下的机枪搬起来 */
  pickUp(t: Turret) {
    if (this.carry || t.reloadT >= 0) return;
    t.carried = true;
    t.group.visible = false;
    t.target = null;
    this.carry = { turret: t, spot: new THREE.Vector3(), yaw: t.yaw, valid: false };
    this.ghost.visible = true;
    this.game.audio.reload(0, t.pos);
  }

  private updateCarry() {
    const c = this.carry;
    if (!c) return;
    const g = this.game;
    const p = g.player.pos;
    const yaw = g.player.yaw;
    const x = p.x - Math.sin(yaw) * TURRET.carryDist;
    const z = p.z - Math.cos(yaw) * TURRET.carryDist;
    c.spot.set(x, 0, z);
    c.yaw = yaw;
    c.valid =
      !g.level.circleBlocked(x, z, TURRET.radius + 0.05) &&
      g.level.segmentClear(p.x, p.z, x, z, 0.05) &&
      !this.list.some((t) => !t.carried && Math.hypot(t.pos.x - x, t.pos.z - z) < TURRET.radius * 2 + 0.15);
    this.ghost.position.copy(c.spot);
    this.ghost.rotation.y = yaw;
    this.ghostMat.color.set(c.valid ? 0x6ee06a : 0xff4a3a);
    this.ghostMat.opacity = 0.32 + Math.sin(g.time * 6) * 0.08;

    const inp = g.input;
    if (inp.mousePressed[0] || inp.wasPressed('KeyF')) {
      g.weapons.consumeTrigger();
      this.placeCarried();
    } else if (inp.mousePressed[2]) this.cancelCarry();
  }

  private placeCarried() {
    const c = this.carry!;
    const g = this.game;
    if (!c.valid) {
      g.audio.denied();
      return;
    }
    if (c.turret) {
      const t = c.turret;
      t.pos.copy(c.spot);
      t.group.position.copy(c.spot);
      t.yaw = c.yaw;
      t.pitch = 0;
      t.head.rotation.set(0, c.yaw, 0);
      t.interact.pos.set(c.spot.x, 1, c.spot.z);
      t.carried = false;
      t.group.visible = true;
    } else {
      this.list.push(this.build(c.spot.clone(), c.yaw));
    }
    this.carry = null;
    this.ghost.visible = false;
    g.audio.hammer(new THREE.Vector3(c.spot.x, 0.8, c.spot.z));
  }

  /** 右键取消：搬起的机枪回到原位；刚买的新机枪退还积分 */
  cancelCarry() {
    const c = this.carry;
    if (!c) return;
    if (c.turret) {
      c.turret.carried = false;
      c.turret.group.visible = true;
    } else {
      this.game.refund(TURRET.cost);
    }
    this.carry = null;
    this.ghost.visible = false;
  }

  carryPrompt() {
    const c = this.carry;
    if (!c) return null;
    const cancel = c.turret ? '右键取消' : '右键取消（退还积分）';
    return c.valid ? `左键或 F 放下自动机枪 · ${cancel}` : `这里放不下 · ${cancel}`;
  }

  private build(pos: THREE.Vector3, yaw: number): Turret {
    const g = this.game;
    const { group, head, muzzle, lamp } = buildTurretModel();
    group.position.copy(pos);
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffd090, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flash.scale.setScalar(0.4);
    flash.visible = false;
    muzzle.add(flash);

    // 头顶弹药条
    const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, color: 0x111111, transparent: true, opacity: 0.75, depthWrite: false }));
    barBg.center.set(0, 0.5);
    barBg.scale.set(0.62, 0.07, 1);
    barBg.position.set(-0.31, 1.45, 0);
    group.add(barBg);
    const barFill = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, color: 0x6ee06a, depthWrite: false }));
    barFill.center.set(0, 0.5);
    barFill.scale.set(0.6, 0.05, 1);
    barFill.position.set(-0.3, 1.45, 0.001);
    group.add(barFill);

    g.scene.add(group);

    const t: Turret = {
      id: this.nextId++,
      pos: pos.clone(),
      group, head, muzzle,
      yaw, pitch: 0,
      ammo: this.maxAmmo,
      cooldown: 0,
      reloadT: -1,
      target: null,
      retargetT: 0,
      flash, flashT: 0,
      lamp, barBg, barFill,
      interact: null as unknown as Interactable,
      carried: false,
    };
    t.interact = {
      pos: new THREE.Vector3(pos.x, 1, pos.z),
      range: 1.6,
      prompt: () => {
        if (t.reloadT >= 0) return '自动机枪上弹中…';
        if (t.ammo <= 0) return '按 F 上弹 · 按住 F 搬走';
        return `自动机枪 · 弹药 ${t.ammo}/${this.maxAmmo} · 按住 F 搬走`;
      },
      use: () => this.reload(t),
      holdAction: {
        time: TURRET.pickupHold,
        enabled: () => t.reloadT < 0 && !this.carry,
        run: () => this.pickUp(t),
      },
    };
    head.rotation.y = yaw;
    return t;
  }

  private reload(t: Turret) {
    if (t.ammo > 0 || t.reloadT >= 0) return;
    t.reloadT = TURRET.reload;
    this.game.audio.reload(0, t.pos);
  }

  /** 把圆推出所有机枪（玩家和丧尸都要绕开机枪） */
  collide(p: { x: number; z: number }, r: number) {
    for (const t of this.list) {
      if (t.carried) continue;
      const dx = p.x - t.pos.x, dz = p.z - t.pos.z;
      const min = r + TURRET.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        p.x += min;
        continue;
      }
      p.x = t.pos.x + (dx / d) * min;
      p.z = t.pos.z + (dz / d) * min;
    }
  }

  /** 找射程内、视线不被墙挡住的最近丧尸 */
  private findTarget(t: Turret): Zombie | null {
    const g = this.game;
    const from = new THREE.Vector3(t.pos.x, MUZZLE_Y, t.pos.z);
    let best: Zombie | null = null;
    let bestD = TURRET.range;
    for (const z of g.zombies.list) {
      if (z.dead || z.pos.y < -0.6) continue;
      const to = new THREE.Vector3(z.pos.x, z.pos.y + 1.25, z.pos.z);
      const d = from.distanceTo(to);
      if (d >= bestD) continue;
      const dir = to.clone().sub(from).normalize();
      if (g.level.raycast(from, dir, d, this.rayHit)) continue;
      best = z;
      bestD = d;
    }
    return best;
  }

  private fire(t: Turret) {
    const g = this.game;
    t.ammo--;
    t.cooldown = TURRET.interval;
    const origin = t.muzzle.getWorldPosition(new THREE.Vector3());
    const z = t.target!;
    const aim = new THREE.Vector3(z.pos.x, z.pos.y + 1.25, z.pos.z);
    const dir = aim.sub(origin).normalize();
    dir.x += rand(-0.02, 0.02);
    dir.y += rand(-0.02, 0.02);
    dir.z += rand(-0.02, 0.02);
    dir.normalize();
    const maxD = TURRET.range + 5;
    const wall = g.level.raycast(origin, dir, maxD, this.rayHit);
    const wallT = wall ? this.rayHit.t : maxD;
    this.raycaster.set(origin, dir);
    this.raycaster.far = wallT;
    let endT = wallT;
    let hitZombie = false;
    for (const h of this.raycaster.intersectObjects(g.zombies.targets(), false)) {
      const hz = h.object.userData.zombie as Zombie | undefined;
      if (!hz || hz.dead) continue;
      const part = h.object.userData.part as HitPart;
      const dmg = TURRET.damage * (part === 'head' ? 2 : part === 'limb' ? 0.8 : 1);
      g.zombies.damage(hz, dmg, part, 'turret', dir, { point: h.point });
      g.particles.blood(h.point, dir.clone().negate(), 6, 0.9);
      endT = h.distance;
      hitZombie = true;
      break;
    }
    if (!hitZombie && wall) {
      const p = origin.clone().addScaledVector(dir, wallT);
      const n = new THREE.Vector3(this.rayHit.nx, this.rayHit.ny, this.rayHit.nz);
      g.particles.impact(p, n, true);
      g.decals.bulletHole(p, n);
    }
    // 曳光弹
    const tr = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    tr.mesh.visible = true;
    tr.t = 0.05;
    tr.mesh.position.copy(origin);
    tr.mesh.lookAt(origin.clone().sub(dir));
    tr.mesh.scale.set(1, 1, Math.max(0.1, endT));
    t.flashT = 0.04;
    t.flash.material.rotation = Math.random() * Math.PI;
    g.audio.shot(this.sound, origin);
    if (t.ammo === 0) g.audio.dryFire();
  }

  /** 可交互（没被搬起来）的机枪 */
  get placed() {
    return this.list.filter((t) => !t.carried);
  }

  update(dt: number) {
    const g = this.game;
    this.updateCarry();
    for (const t of this.list) {
      if (t.carried) continue;
      t.cooldown -= dt;
      if (t.reloadT >= 0) {
        t.reloadT -= dt;
        if (t.reloadT < 0) {
          t.ammo = this.maxAmmo;
          g.audio.reload(1, t.pos);
        }
      }
      t.retargetT -= dt;
      if (t.retargetT <= 0 || (t.target && t.target.dead)) {
        t.retargetT = 0.2;
        t.target = t.ammo > 0 && t.reloadT < 0 ? this.findTarget(t) : null;
      }
      if (t.target) {
        const z = t.target;
        const dx = z.pos.x - t.pos.x, dz = z.pos.z - t.pos.z;
        const dy = z.pos.y + 1.25 - MUZZLE_Y;
        const wantYaw = Math.atan2(-dx, -dz);
        const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        const dYaw = angleDiff(t.yaw, wantYaw);
        const step = TURRET.turnSpeed * dt;
        t.yaw += Math.max(-step, Math.min(step, dYaw));
        t.pitch += (wantPitch - t.pitch) * damp(10, dt);
        if (Math.abs(dYaw) < 0.12 && t.cooldown <= 0 && t.ammo > 0 && t.reloadT < 0) {
          t.head.rotation.set(t.pitch, t.yaw, 0);
          t.group.updateMatrixWorld(true);
          this.fire(t);
        }
      } else {
        t.pitch += (0 - t.pitch) * damp(4, dt);
      }
      t.head.rotation.set(t.pitch, t.yaw, 0);

      t.flashT -= dt;
      t.flash.visible = t.flashT > 0;

      // 弹药条与状态灯：空了就闪红
      const frac = Math.min(1, t.ammo / this.maxAmmo);
      const empty = t.ammo <= 0 && t.reloadT < 0;
      const blink = Math.floor(g.time * 4) % 2 === 0;
      if (t.reloadT >= 0) {
        const r = 1 - t.reloadT / TURRET.reload;
        t.barFill.scale.x = 0.6 * r;
        t.barFill.material.color.set(0x7fc8ff);
        t.lamp.color.set(0x7fc8ff);
      } else {
        t.barFill.scale.x = 0.6 * Math.max(frac, 0.001);
        t.barFill.material.color.set(frac > 0.5 ? 0x6ee06a : frac > 0.2 ? 0xffc83a : 0xff4a3a);
        t.lamp.color.set(empty ? (blink ? 0xff2a1a : 0x220000) : 0x3dff6a);
      }
      t.barFill.visible = !empty;
      t.barBg.material.color.set(empty && blink ? 0x8a0f0a : 0x111111);
    }
    for (const tr of this.tracers) {
      if (!tr.mesh.visible) continue;
      tr.t -= dt;
      if (tr.t <= 0) tr.mesh.visible = false;
    }
    this.updateAlert();
  }

  /** 左上角列出没子弹 / 正在上弹的机枪，带距离和指向箭头 */
  private updateAlert() {
    const g = this.game;
    const p = g.player.pos;
    const seen = new Set<number>();
    let needF = false;
    this.list.forEach((t, i) => {
      if (t.carried || (t.ammo > 0 && t.reloadT < 0)) return;
      seen.add(t.id);
      let row = this.alertRows.get(t.id);
      if (!row) {
        const el = document.createElement('div');
        el.className = 'ta';
        el.innerHTML = '<i class="arr">▲</i><span></span>';
        this.alertEl.insertBefore(el, this.alertTip);
        row = { el, arr: el.firstElementChild as HTMLElement, txt: el.lastElementChild as HTMLElement, text: '' };
        this.alertRows.set(t.id, row);
      }
      const dx = t.pos.x - p.x, dz = t.pos.z - p.z;
      const reloading = t.reloadT >= 0;
      if (!reloading) needF = true;
      const text = reloading ? `自动机枪 #${i + 1} 上弹中` : `自动机枪 #${i + 1} 没子弹 · ${Math.round(Math.hypot(dx, dz))} 米`;
      if (text !== row.text) {
        row.text = text;
        row.txt.textContent = text;
        row.el.classList.toggle('rl', reloading);
      }
      const rel = angleDiff(g.player.yaw, Math.atan2(-dx, -dz));
      row.arr.style.transform = `rotate(${Math.round((-rel * 180) / Math.PI)}deg)`;
    });
    for (const [id, row] of this.alertRows) {
      if (seen.has(id)) continue;
      row.el.remove();
      this.alertRows.delete(id);
    }
    this.alertTip.style.display = needF ? '' : 'none';
  }
}
