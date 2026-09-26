import * as THREE from 'three';
import { pick, rand } from '../core/util';

export type HitPart = 'head' | 'torso' | 'limb';
export type SpeedType = 'walk' | 'run' | 'sprint';

/** 几何体按“关节在顶部”平移，方便绕关节旋转 */
function limb(w: number, h: number, d: number, pivotTop = true) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, pivotTop ? -h / 2 : h / 2, 0);
  return g;
}

const GEO = {
  torso: limb(0.44, 0.58, 0.26, false),
  head: limb(0.25, 0.29, 0.27, false),
  jaw: limb(0.2, 0.08, 0.2),
  upperArm: limb(0.12, 0.33, 0.12),
  foreArm: limb(0.1, 0.31, 0.1),
  hand: limb(0.09, 0.12, 0.11),
  thigh: limb(0.17, 0.46, 0.19),
  shin: limb(0.14, 0.44, 0.15),
  foot: (() => {
    const g = new THREE.BoxGeometry(0.14, 0.08, 0.26);
    g.translate(0, -0.04, 0.05);
    return g;
  })(),
  eye: new THREE.BoxGeometry(0.055, 0.03, 0.02),
  stain: new THREE.BoxGeometry(0.22, 0.26, 0.01),
  rib: new THREE.BoxGeometry(0.3, 0.1, 0.02),
};

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number, rough = 0.9) {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough });
    matCache.set(color, m);
  }
  return m;
}
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffa21a, fog: false });
const eyeMatRed = new THREE.MeshBasicMaterial({ color: 0xff3a1a, fog: false });

const SKINS = [0x7b876a, 0x8a8a6e, 0x6e7a66, 0x908070, 0x7a7060];
const SHIRTS = [0x4a4238, 0x3b4556, 0x5a5a4a, 0x6d6152, 0x2f3a2f, 0x55433a, 0x404a3a];
const PANTS = [0x2b2a28, 0x3a3226, 0x26303a, 0x34342c];

export class ZombieModel {
  root = new THREE.Group();
  hips = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  lArm = new THREE.Group();
  rArm = new THREE.Group();
  lFore = new THREE.Group();
  rFore = new THREE.Group();
  lLeg = new THREE.Group();
  rLeg = new THREE.Group();
  lShin = new THREE.Group();
  rShin = new THREE.Group();
  meshes: THREE.Mesh[] = [];
  /** 受击后仰 / 甩头的幅度，随时间衰减 */
  private flinch = 0;
  private headFlinch = 0;
  private flinchSide = 1;
  /** 每只丧尸的姿态差异 */
  private quirk = { armL: rand(-0.25, 0.15), armR: rand(-0.25, 0.15), headTilt: rand(-0.3, 0.3), limp: rand(0, 0.5) };

  constructor(owner: object, fastEyes: boolean) {
    const skin = mat(pick(SKINS));
    const shirt = mat(pick(SHIRTS));
    const pants = mat(pick(PANTS));
    const blood = mat(0x4a0a08, 0.5);

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, part: HitPart | null, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      if (part) {
        mesh.userData.zombie = owner;
        mesh.userData.part = part;
        this.meshes.push(mesh);
      }
      return mesh;
    };

    this.root.add(this.hips);
    this.hips.position.y = 0.96;

    this.hips.add(this.torso);
    add(this.torso, GEO.torso, shirt, 'torso');
    add(this.torso, GEO.stain, blood, null, rand(-0.1, 0.1), rand(0.15, 0.35), 0.135);
    if (Math.random() < 0.5) add(this.torso, GEO.rib, blood, null, 0, 0.42, 0.135);

    this.head.position.y = 0.58;
    this.torso.add(this.head);
    add(this.head, GEO.head, skin, 'head');
    add(this.head, GEO.jaw, skin, 'head', 0, 0.04, 0.02).rotation.x = 0.25;
    const em = fastEyes ? eyeMatRed : eyeMat;
    add(this.head, GEO.eye, em, null, -0.06, 0.17, 0.137);
    add(this.head, GEO.eye, em, null, 0.06, 0.17, 0.137);

    for (const [arm, fore, side] of [
      [this.lArm, this.lFore, -1],
      [this.rArm, this.rFore, 1],
    ] as [THREE.Group, THREE.Group, number][]) {
      arm.position.set(side * 0.29, 0.52, 0);
      this.torso.add(arm);
      add(arm, GEO.upperArm, shirt, 'limb');
      fore.position.y = -0.33;
      arm.add(fore);
      add(fore, GEO.foreArm, skin, 'limb');
      add(fore, GEO.hand, skin, 'limb', 0, -0.31, 0);
    }

    for (const [leg, shin, side] of [
      [this.lLeg, this.lShin, -1],
      [this.rLeg, this.rShin, 1],
    ] as [THREE.Group, THREE.Group, number][]) {
      leg.position.set(side * 0.12, 0, 0);
      this.hips.add(leg);
      add(leg, GEO.thigh, pants, 'limb');
      shin.position.y = -0.46;
      leg.add(shin);
      add(shin, GEO.shin, pants, 'limb');
      add(shin, GEO.foot, mat(0x1c1a18), 'limb', 0, -0.44, 0);
    }

    const s = rand(0.93, 1.07);
    this.root.scale.set(s, s * rand(0.97, 1.05), s);
  }

  /**
   * 程序化动画。phase 为步态相位，mode 描述当前动作。
   * 约定：模型正面朝 +z；绕 x 轴负旋转让手臂/腿向前抬。
   */
  animate(phase: number, type: SpeedType, mode: 'move' | 'idle' | 'attack' | 'tear' | 'climb' | 'rise', t: number) {
    const q = this.quirk;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const amp = type === 'walk' ? 0.42 : type === 'run' ? 0.75 : 0.95;
    const lean = type === 'walk' ? 0.14 : type === 'run' ? 0.3 : 0.42;

    // 腿
    if (mode === 'move') {
      this.lLeg.rotation.x = -s * amp * (1 - q.limp * 0.5);
      this.rLeg.rotation.x = s * amp;
      this.lShin.rotation.x = Math.max(0, c) * amp * 1.2;
      this.rShin.rotation.x = Math.max(0, -c) * amp * 1.2;
      this.hips.position.y = 0.96 - Math.abs(c) * 0.04 * amp;
      this.hips.rotation.z = s * 0.06;
      this.hips.rotation.y = s * 0.08;
    } else if (mode === 'climb') {
      this.lLeg.rotation.x = -1.2;
      this.rLeg.rotation.x = -0.3;
      this.lShin.rotation.x = 1.4;
      this.rShin.rotation.x = 0.8;
      this.hips.position.y = 0.96;
    } else {
      this.lLeg.rotation.x *= 0.85;
      this.rLeg.rotation.x *= 0.85;
      this.lShin.rotation.x *= 0.85;
      this.rShin.rotation.x *= 0.85;
      this.hips.position.y = 0.96;
      this.hips.rotation.z *= 0.9;
    }

    // 躯干与头
    this.torso.rotation.x = lean + (mode === 'move' ? Math.abs(c) * 0.05 : 0) + (mode === 'climb' ? 0.5 : 0);
    this.torso.rotation.y = mode === 'move' ? -s * 0.1 : 0;
    this.head.rotation.z = q.headTilt + Math.sin(phase * 0.5) * 0.08;
    this.head.rotation.x = -lean * 0.6;

    // 手臂
    let la: number, ra: number;
    let lf = -0.25, rf = -0.25;
    if (mode === 'attack') {
      // t: 0..1 挥击进度
      const up = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
      la = -1.3 - up * 1.3;
      ra = -1.1 - up * 1.5;
      if (t > 0.45) {
        la = -2.4 + (t - 0.45) * 3.5;
        ra = -2.6 + (t - 0.45) * 3.8;
      }
      lf = -0.6;
      rf = -0.6;
    } else if (mode === 'tear') {
      la = -1.6 + Math.sin(t * 7) * 0.5;
      ra = -1.6 - Math.sin(t * 7) * 0.5;
      lf = -0.7 + Math.cos(t * 7) * 0.3;
      rf = -0.7 - Math.cos(t * 7) * 0.3;
    } else if (mode === 'rise') {
      la = -2.7 + Math.sin(t * 9) * 0.3;
      ra = -2.5 - Math.sin(t * 9) * 0.3;
    } else if (type === 'sprint' && mode === 'move') {
      la = -0.8 + s * 1.1;
      ra = -0.8 - s * 1.1;
      lf = -1.0;
      rf = -1.0;
    } else {
      la = -1.35 + s * 0.12;
      ra = -1.35 - s * 0.12;
    }
    this.lArm.rotation.x = la + q.armL;
    this.rArm.rotation.x = ra + q.armR;
    this.lArm.rotation.z = -0.08;
    this.rArm.rotation.z = 0.08;
    this.lFore.rotation.x = lf;
    this.rFore.rotation.x = rf;

    // 叠加受击动作
    const f = this.flinch, hf = this.headFlinch;
    this.torso.rotation.x -= f * 0.5;
    this.torso.rotation.z += this.flinchSide * f * 0.22;
    this.head.rotation.x -= hf * 0.9;
    this.head.rotation.z += this.flinchSide * hf * 0.45;
    this.lArm.rotation.x += f * 0.7;
    this.rArm.rotation.x += f * 0.55;
  }

  hitReact(part: HitPart, amount: number, side: number) {
    this.flinchSide = side;
    if (part === 'head') {
      this.headFlinch = Math.min(1.2, this.headFlinch + amount * 1.2);
      this.flinch = Math.min(1.2, this.flinch + amount * 0.35);
    } else this.flinch = Math.min(1.2, this.flinch + amount);
  }

  decayFlinch(dt: number) {
    this.flinch *= Math.exp(-9 * dt);
    this.headFlinch *= Math.exp(-7 * dt);
  }

  setEyesRed() {
    this.head.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === eyeMat) o.material = eyeMatRed;
    });
  }
}
