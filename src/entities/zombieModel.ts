import * as THREE from 'three';
import { pick, rand } from '../core/util';

export type HitPart = 'head' | 'torso' | 'limb';

/**
 * 丧尸的固定姿势：出生时随机选一种，一直保持到死，挨枪不会变。
 * 数值都是叠加在基础动画上的偏移（弧度）。姿势是静态的；走路时上半身不晃，方便瞄准。
 */
interface Pose {
  name: string;
  weight: number;
  torsoX: number; // + 前倾，- 后仰
  torsoZ: number; // 侧倾
  torsoY: number; // 扭身（静态）
  headX: number; // + 低头，- 仰头
  headZ: number; // 歪头
  armL: number; // 叠加到肩部旋转：负数把手抬得更高，正数往下垂
  armR: number;
  armLZ: number; // 手臂向外张开
  armRZ: number;
  foreL: number;
  foreR: number;
  limp: number; // 拖腿程度 0..1
}

const P = (p: Partial<Pose> & { name: string; weight: number }): Pose => ({
  torsoX: 0, torsoZ: 0, torsoY: 0, headX: 0, headZ: 0,
  armL: 0, armR: 0, armLZ: 0, armRZ: 0, foreL: 0, foreR: 0, limp: 0,
  ...p,
});

const POSES: Pose[] = [
  P({ name: '经典伸手', weight: 3 }),
  P({ name: '佝偻驼背', weight: 1.5, torsoX: 0.38, headX: -0.3, armL: 0.6, armR: 0.5, foreL: -0.3, foreR: -0.2 }),
  P({ name: '后仰', weight: 1.5, torsoX: -0.32, torsoZ: 0.12, headX: -0.45, headZ: 0.3, armL: 0.5, armR: 0.35, armLZ: -0.2, armRZ: 0.15 }),
  P({ name: '单手垂下', weight: 1.5, torsoZ: 0.12, headZ: 0.28, armL: 1.3, foreL: 0.2, armR: -0.1 }),
  P({ name: '歪脖扭身', weight: 1.5, torsoY: 0.35, torsoZ: 0.15, headX: 0.15, headZ: 0.7, armL: -0.2, armR: 0.3 }),
  P({ name: '高举双手', weight: 1, torsoX: -0.1, headX: -0.2, armL: -0.75, armR: -0.85, foreL: -0.4, foreR: -0.3 }),
  P({ name: '拖腿', weight: 1.5, torsoZ: 0.2, headZ: 0.2, armL: 0.3, armR: -0.1, limp: 1 }),
];

function pickPose(): Pose {
  const total = POSES.reduce((a, p) => a + p.weight, 0);
  let x = Math.random() * total;
  let pose = POSES[0];
  for (const p of POSES) {
    x -= p.weight;
    if (x <= 0) {
      pose = p;
      break;
    }
  }
  // 随机左右镜像，让同一种姿势也有左右之分
  if (Math.random() < 0.5) return pose;
  return {
    ...pose,
    torsoZ: -pose.torsoZ,
    torsoY: -pose.torsoY,
    headZ: -pose.headZ,
    armL: pose.armR,
    armR: pose.armL,
    armLZ: -pose.armRZ,
    armRZ: -pose.armLZ,
    foreL: pose.foreR,
    foreR: pose.foreL,
  };
}
export type SpeedType = 'walk' | 'run' | 'sprint';
/** 丧尸种类：普通 / 精英 / 超精英，外观和属性各不相同 */
export type ZombieTier = 'normal' | 'elite' | 'super';

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
const metalCache = new Map<number, THREE.MeshStandardMaterial>();
function metal(color: number) {
  let m = metalCache.get(color);
  if (!m) {
    // 场景里没有环境贴图，金属度太高会发黑，这里只给一点金属感
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
    metalCache.set(color, m);
  }
  return m;
}
const glow = (color: number) => new THREE.MeshBasicMaterial({ color, fog: false });
const EYES: Record<ZombieTier, THREE.MeshBasicMaterial> = {
  normal: glow(0xffa21a),
  elite: glow(0xff2a14),
  super: glow(0xc45bff),
};
const veinMat = glow(0x9a3cff);

const SKINS = [0x7b876a, 0x8a8a6e, 0x6e7a66, 0x908070, 0x7a7060];
const SHIRTS = [0x4a4238, 0x3b4556, 0x5a5a4a, 0x6d6152, 0x2f3a2f, 0x55433a, 0x404a3a];
const PANTS = [0x2b2a28, 0x3a3226, 0x26303a, 0x34342c];
/** 精英：灰白皮肤 + 野战灰军装；超精英：焦黑皮肤 + 破布裤子 */
const ELITE_SKINS = [0xa2aaa2, 0x96a09c, 0xa8a496];
const SUPER_SKINS = [0x6a4c46, 0x5e4540];

const ACC = {
  helmet: new THREE.BoxGeometry(0.3, 0.11, 0.32),
  brim: new THREE.BoxGeometry(0.35, 0.025, 0.37),
  belt: new THREE.BoxGeometry(0.46, 0.055, 0.28),
  pouch: new THREE.BoxGeometry(0.08, 0.07, 0.05),
  strap: new THREE.BoxGeometry(0.04, 0.5, 0.01),
  chest: new THREE.BoxGeometry(0.48, 0.4, 0.3),
  plateLine: new THREE.BoxGeometry(0.49, 0.015, 0.305),
  mask: new THREE.BoxGeometry(0.27, 0.23, 0.05),
  slit: new THREE.BoxGeometry(0.19, 0.022, 0.012),
  rivet: new THREE.BoxGeometry(0.02, 0.02, 0.012),
  shoulder: new THREE.BoxGeometry(0.2, 0.1, 0.2),
  vein: new THREE.BoxGeometry(0.012, 0.16, 0.012),
};

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
  /** 每只丧尸固定的姿势 + 细微的随机差异 */
  readonly pose = pickPose();
  private quirk = { armL: rand(-0.2, 0.12), armR: rand(-0.2, 0.12), headTilt: rand(-0.2, 0.2), limp: rand(0, 0.4) };

  constructor(owner: object, tier: ZombieTier) {
    const skin = mat(pick(tier === 'elite' ? ELITE_SKINS : tier === 'super' ? SUPER_SKINS : SKINS));
    const shirt = mat(tier === 'elite' ? 0x555a48 : tier === 'super' ? 0x2a2624 : pick(SHIRTS));
    const pants = mat(tier === 'elite' ? 0x3a3c32 : tier === 'super' ? 0x241f1d : pick(PANTS));
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
    const em = EYES[tier];
    if (tier !== 'super') {
      add(this.head, GEO.eye, em, null, -0.06, 0.17, 0.137);
      add(this.head, GEO.eye, em, null, 0.06, 0.17, 0.137);
    }

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

    if (tier === 'elite') {
      // 钢盔 + 腰带弹药包 + 背带
      const steel = metal(0x4b5046);
      add(this.head, ACC.helmet, steel, 'head', 0, 0.3, -0.005);
      add(this.head, ACC.brim, steel, 'head', 0, 0.255, -0.005);
      const leather = mat(0x2e241a, 0.8);
      add(this.torso, ACC.belt, leather, 'torso', 0, 0.05, 0);
      for (const x of [-0.14, 0, 0.14]) add(this.torso, ACC.pouch, leather, 'torso', x, 0.06, 0.155);
      for (const x of [-0.12, 0.12]) add(this.torso, ACC.strap, leather, null, x, 0.32, 0.133);
    } else if (tier === 'super') {
      // 铁面具（发光的眼缝）+ 胸甲 + 肩甲 + 手臂腿上发光的裂纹
      const iron = metal(0x5a5e68);
      add(this.head, ACC.mask, iron, 'head', 0, 0.13, 0.15);
      add(this.head, ACC.slit, em, null, 0, 0.175, 0.176);
      for (const x of [-0.1, 0.1]) for (const y of [0.05, 0.22]) add(this.head, ACC.rivet, metal(0x5a5c60), null, x, y, 0.178);
      add(this.torso, ACC.chest, iron, 'torso', 0, 0.33, 0);
      for (const y of [0.2, 0.34, 0.48]) add(this.torso, ACC.plateLine, metal(0x2a2c30), null, 0, y, 0);
      // 胸甲正中一道发光的裂缝
      add(this.torso, ACC.vein, veinMat, null, 0.02, 0.33, 0.152).rotation.z = 0.25;
      add(this.torso, ACC.vein, veinMat, null, -0.06, 0.12, 0.152).rotation.z = -0.4;
      for (const arm of [this.lArm, this.rArm]) add(arm, ACC.shoulder, iron, 'limb', 0, 0.01, 0);
      for (const fore of [this.lFore, this.rFore]) {
        add(fore, ACC.vein, veinMat, null, 0.051, -0.14, 0.01).rotation.z = 0.15;
        add(fore, ACC.vein, veinMat, null, -0.02, -0.18, 0.051).rotation.z = -0.2;
      }
      for (const leg of [this.lLeg, this.rLeg]) add(leg, ACC.vein, veinMat, null, 0, -0.2, 0.096).rotation.z = 0.3;
      add(this.torso, ACC.vein, veinMat, null, 0.12, 0.57, 0.11).rotation.z = 0.5;
    }

    // 同一种丧尸体型固定（普通丧尸有一点点高矮胖瘦的差别）
    if (tier === 'normal') {
      const s = rand(0.93, 1.07);
      this.root.scale.set(s, s * rand(0.97, 1.05), s);
    } else {
      this.root.scale.setScalar(tier === 'elite' ? 1.1 : 1.25);
    }
  }

  /**
   * 程序化动画。phase 为步态相位，mode 描述当前动作。
   * 约定：模型正面朝 +z；绕 x 轴负旋转让手臂/腿向前抬。
   */
  animate(phase: number, type: SpeedType, mode: 'move' | 'idle' | 'attack' | 'tear' | 'climb' | 'rise', t: number) {
    const q = this.quirk;
    const pose = this.pose;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const amp = type === 'walk' ? 0.42 : type === 'run' ? 0.75 : 0.95;
    const lean = type === 'walk' ? 0.14 : type === 'run' ? 0.3 : 0.42;
    const limp = Math.max(q.limp, pose.limp);

    // 腿（拖腿的丧尸左腿几乎不抬，膝盖打弯拖在后面）
    if (mode === 'move') {
      this.lLeg.rotation.x = -s * amp * (1 - limp * 0.6);
      this.rLeg.rotation.x = s * amp;
      this.lShin.rotation.x = Math.max(0, c) * amp * 1.2 * (1 - limp * 0.5) + limp * 0.35;
      this.rShin.rotation.x = Math.max(0, -c) * amp * 1.2;
      // 上半身保持稳定：只留很小的上下起伏，不左右晃、不扭腰
      this.hips.position.y = 0.96 - Math.abs(c) * 0.012 * amp - limp * 0.03;
      this.hips.rotation.z = 0;
      this.hips.rotation.y = 0;
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
      this.hips.rotation.z = 0;
      this.hips.rotation.y = 0;
    }

    // 躯干与头
    this.torso.rotation.x = lean + (mode === 'climb' ? 0.5 : 0);
    this.torso.rotation.y = 0;
    this.torso.rotation.z = 0;
    this.head.rotation.z = q.headTilt;
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

    // 叠加固定姿势。攻击、拆板、爬出地面时手臂动作要看得清，姿势对手臂只保留一小部分
    const action = mode === 'attack' || mode === 'tear' || mode === 'rise';
    const armK = action ? 0.25 : type === 'sprint' && mode === 'move' ? 0.4 : 1;
    this.torso.rotation.x += pose.torsoX;
    this.torso.rotation.z += pose.torsoZ;
    this.torso.rotation.y += pose.torsoY;
    this.head.rotation.x += pose.headX;
    this.head.rotation.z += pose.headZ;
    this.lArm.rotation.x += pose.armL * armK;
    this.rArm.rotation.x += pose.armR * armK;
    this.lArm.rotation.z += pose.armLZ * armK;
    this.rArm.rotation.z += pose.armRZ * armK;
    this.lFore.rotation.x += pose.foreL * armK;
    this.rFore.rotation.x += pose.foreR * armK;
  }
}
