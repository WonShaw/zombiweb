import * as THREE from 'three';
import { M, V, side, box, rbox, latheY, cylY, ringZ, tube, finalize } from './parts';

/**
 * 近战武器（仿 CF）：单独占一个位置，按 V / 5 拿出来，左键轻击、右键重击。
 * 模型约定：握把中心在原点，刀身 / 斧头沿 +y 伸出，刃口朝 -z（向前）。
 */

/** 挥砍动作：slash 从右往左横扫，slashR 从左往右，chop 高举劈下，stab 向前突刺 */
export type MeleeAnim = 'slash' | 'slashR' | 'chop' | 'stab';

export interface MeleeAttack {
  damage: number;
  /** 一次攻击的总时长（秒），也就是攻速 */
  time: number;
  /** 攻击距离（米） */
  range: number;
  /** 命中扇形的半角（弧度） */
  arc: number;
  /** 一次最多砍中几只 */
  targets: number;
  anim: MeleeAnim;
  /** 击飞力度 */
  force: number;
}

export interface MeleeDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  light: MeleeAttack;
  heavy: MeleeAttack;
  /** 拿着时的移动速度倍率 */
  move: number;
  /** 待机时刀尖的姿势（手腕旋转 x, y, z） */
  idle: [number, number, number];
  /** 手握在模型的哪个高度（长柄武器不握在最底端：日本刀握在护手下面，斧头、撬棍往上握一段） */
  grip: number;
}

const A = (damage: number, time: number, range: number, arc: number, targets: number, anim: MeleeAnim, force: number): MeleeAttack => ({
  damage, time, range, arc, targets, anim, force,
});

export const MELEE: Record<string, MeleeDef> = {
  knife: {
    id: 'knife', name: '军刀', desc: '开局配发的 M9 军刀，出手快、跑得快。', cost: 0,
    light: A(150, 0.42, 1.8, 0.7, 1, 'slash', 1.4), heavy: A(350, 0.85, 1.75, 0.35, 1, 'stab', 2),
    move: 1.1, idle: [-0.35, 0.1, 0.35], grip: 0,
  },
  karambit: {
    id: 'karambit', name: '爪刀', desc: '弯钩形的爪刀，攻速最快。', cost: 1200,
    light: A(160, 0.32, 1.75, 0.7, 1, 'slash', 1.3), heavy: A(380, 0.72, 1.75, 0.4, 1, 'stab', 2),
    move: 1.12, idle: [-0.4, 0.1, 0.4], grip: 0,
  },
  crowbar: {
    id: 'crowbar', name: '撬棍', desc: '一根实心钢撬棍，砸起来很结实。', cost: 800,
    light: A(200, 0.62, 2.0, 0.7, 1, 'slash', 2), heavy: A(460, 1.1, 2.0, 0.55, 2, 'chop', 3),
    move: 1.03, idle: [0.35, 0, 0.3], grip: 0.1,
  },
  bat: {
    id: 'bat', name: '棒球棍', desc: '木制球棒，横扫能一次打中两只。', cost: 900,
    light: A(190, 0.6, 2.2, 0.8, 2, 'slash', 2.4), heavy: A(480, 1.15, 2.2, 0.6, 2, 'chop', 3.5),
    move: 1.02, idle: [0.5, 0, 0.25], grip: 0.045,
  },
  shovel: {
    id: 'shovel', name: '工兵铲', desc: '折叠工兵铲，劈砍兼拍击。', cost: 1000,
    light: A(210, 0.62, 2.1, 0.75, 2, 'slash', 2), heavy: A(520, 1.15, 2.1, 0.55, 2, 'chop', 3),
    move: 1.03, idle: [0.4, 0, 0.3], grip: 0.06,
  },
  kukri: {
    id: 'kukri', name: '尼泊尔刀', desc: '廓尔喀弯刀，刀头沉，砍得又快又深。', cost: 1500,
    light: A(240, 0.48, 2.0, 0.75, 2, 'slash', 1.8), heavy: A(560, 0.95, 2.0, 0.55, 2, 'chop', 2.6),
    move: 1.08, idle: [-0.1, 0.1, 0.4], grip: 0,
  },
  axe: {
    id: 'axe', name: '消防斧', desc: '沉重的消防斧，重击能劈开一小群。', cost: 2200,
    light: A(320, 0.72, 2.3, 0.75, 2, 'slash', 2.5), heavy: A(900, 1.3, 2.3, 0.6, 3, 'chop', 4.5),
    move: 0.97, idle: [0.5, 0, 0.25], grip: 0.17,
  },
  katana: {
    id: 'katana', name: '日本刀', desc: '长刀横扫范围最大，一刀能砍三只。', cost: 3000,
    light: A(300, 0.48, 2.6, 0.9, 3, 'slash', 2.2), heavy: A(800, 0.95, 2.7, 0.7, 3, 'chop', 3.2),
    move: 1.06, idle: [0.5, 0, 0.2], grip: 0.145,
  },
};
export const DEFAULT_MELEE = 'knife';

const red = new THREE.MeshStandardMaterial({ color: 0xa3261c, roughness: 0.45, metalness: 0.35 });
const yellow = new THREE.MeshStandardMaterial({ color: 0xd6a51c, roughness: 0.55, metalness: 0.1 });
const wrap = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 });

/** 各把近战武器的模型（不含手） */
const MODELS: Record<string, (g: THREE.Group) => void> = {
  knife(g) {
    rbox(g, 0.022, 0.12, 0.03, 0, -0.005, 0, M.poly, 0.006);
    for (let i = 0; i < 5; i++) box(g, 0.0232, 0.003, 0.031, 0, -0.045 + i * 0.018, 0, M.dark);
    rbox(g, 0.052, 0.009, 0.022, 0, 0.058, 0, M.dark, 0.002);
    side(g, [[0.012, 0.062], [0.012, 0.2], [-0.002, 0.232], [-0.014, 0.19], [-0.014, 0.062]], 0.0045, M.blade, 0, 0.0012);
    box(g, 0.0048, 0.1, 0.0025, 0, 0.13, 0.004, M.dark);
    for (let i = 0; i < 6; i++) box(g, 0.0047, 0.004, 0.003, 0, 0.16 + i * 0.006, 0.0125, M.blade, 0, 0, 0.5);
  },
  karambit(g) {
    rbox(g, 0.022, 0.11, 0.03, 0, -0.005, 0, M.poly, 0.006);
    ringZ(g, 0.018, 0.005, 0, -0.075, 0, M.bright).rotation.y = Math.PI / 2;
    side(g, [[0.013, 0.05], [0.012, 0.1], [-0.006, 0.15], [-0.05, 0.172], [-0.03, 0.14], [-0.013, 0.1], [-0.014, 0.05]], 0.0045, M.blade, 0, 0.0012);
    box(g, 0.0047, 0.06, 0.003, 0, 0.09, 0.006, M.dark, 0.25);
  },
  crowbar(g) {
    cylY(g, 0.011, 0.011, 0.56, 0, 0.18, 0, red, 6);
    tube(g, [V(0, 0.44, 0), V(0, 0.5, -0.012), V(0, 0.525, -0.05), V(0, 0.515, -0.09), V(0, 0.49, -0.108)], 0.011, red);
    box(g, 0.016, 0.02, 0.012, 0, 0.482, -0.113, M.dark, 0.3);
    box(g, 0.026, 0.05, 0.008, 0, -0.12, 0.004, M.dark, -0.15);
  },
  bat(g) {
    latheY(g, [[0, -0.1], [0.022, -0.1], [0.022, -0.088], [0.014, -0.08], [0.0135, 0.12], [0.018, 0.25], [0.03, 0.48], [0.034, 0.62], [0.031, 0.66], [0.02, 0.675], [0, 0.678]], 0, 0, M.woodLight, 20);
    latheY(g, [[0.0152, -0.08], [0.0152, 0.1], [0.0138, 0.1], [0.0138, -0.08]], 0, 0, wrap, 16);
  },
  shovel(g) {
    latheY(g, [[0, -0.1], [0.018, -0.1], [0.016, -0.08], [0.0145, 0.4], [0, 0.4]], 0, 0, M.olive, 12);
    latheY(g, [[0.0155, -0.03], [0.0155, 0.14], [0.0148, 0.14], [0.0148, -0.03]], 0, 0, wrap, 12);
    rbox(g, 0.04, 0.05, 0.032, 0, 0.415, 0, M.dark, 0.004);
    side(g, [[-0.075, 0.43], [0.075, 0.43], [0.08, 0.52], [0.05, 0.6], [0, 0.63], [-0.05, 0.6], [-0.08, 0.52]], 0.004, M.olive, 0, 0.001);
    box(g, 0.008, 0.16, 0.008, 0, 0.51, 0, M.dark);
  },
  kukri(g) {
    rbox(g, 0.024, 0.11, 0.032, 0, -0.005, 0, M.woodDark, 0.007);
    rbox(g, 0.03, 0.014, 0.036, 0, 0.056, 0, M.brass, 0.003);
    side(g, [[0.012, 0.062], [0.016, 0.12], [0.01, 0.2], [-0.02, 0.28], [-0.05, 0.312], [-0.056, 0.282], [-0.036, 0.222], [-0.03, 0.15], [-0.016, 0.1], [-0.014, 0.062]], 0.006, M.blade, 0, 0.0015);
    box(g, 0.0062, 0.004, 0.006, 0, 0.068, -0.014, M.dark);
  },
  axe(g) {
    latheY(g, [[0, -0.12], [0.02, -0.12], [0.018, -0.1], [0.016, 0.64], [0, 0.64]], 0, 0, yellow, 12);
    latheY(g, [[0.0172, 0.08], [0.0172, 0.26], [0.0165, 0.26], [0.0165, 0.08]], 0, 0, wrap, 12);
    side(g, [[0.04, 0.54], [0.04, 0.625], [-0.02, 0.635], [-0.1, 0.685], [-0.132, 0.65], [-0.132, 0.5], [-0.1, 0.47], [-0.02, 0.535]], 0.022, red, 0, 0.004);
    side(g, [[0.035, 0.56], [0.14, 0.585], [0.035, 0.615]], 0.016, red, 0, 0.003);
    side(g, [[-0.118, 0.48], [-0.136, 0.5], [-0.136, 0.652], [-0.118, 0.676]], 0.0232, M.blade, 0, 0.002);
  },
  katana(g) {
    rbox(g, 0.026, 0.27, 0.032, 0, 0.055, 0, wrap, 0.008);
    for (let i = 0; i < 9; i++) box(g, 0.0268, 0.006, 0.02, 0, -0.065 + i * 0.03, 0, M.dial, 0.6);
    rbox(g, 0.028, 0.01, 0.034, 0, -0.085, 0, M.brass, 0.003);
    cylY(g, 0.034, 0.034, 0.007, 0, 0.196, 0, M.dark, 18);
    rbox(g, 0.012, 0.02, 0.036, 0, 0.21, 0, M.brass, 0.002);
    side(g, [[0.013, 0.2], [0.016, 0.5], [0.024, 0.8], [0.03, 0.9], [0.014, 0.935], [0.004, 0.86], [-0.008, 0.5], [-0.014, 0.2]], 0.005, M.blade, 0, 0.0013);
    side(g, [[0.004, 0.22], [0.008, 0.5], [0.016, 0.8], [0.02, 0.88], [0.012, 0.88], [0.005, 0.8], [-0.002, 0.5], [-0.004, 0.22]], 0.0052, M.bright, 0, 0.0008);
  },
};

/** 建一把近战武器；withHand 时加上握着它的拳头 */
export function buildMelee(id: string, withHand: boolean) {
  const g = new THREE.Group();
  // 整把武器往下挪 grip，让手（原点）正好握在该握的位置
  const body = new THREE.Group();
  body.position.y = -(MELEE[id]?.grip ?? 0);
  (MODELS[id] ?? MODELS.knife)(body);
  g.add(body);
  if (withHand) box(g, 0.056, 0.078, 0.086, 0.002, -0.004, 0.006, M.skin);
  finalize(g);
  return g;
}

/** 第一人称：待机时手（握把）的位置，肩膀位置（相机空间） */
export const HAND_IDLE: [number, number, number] = [0.17, -0.21, -0.34];
export const SHOULDER: [number, number, number] = [0.3, -0.44, 0.08];

/** 袖子：沿 +z 的单位长方条，每帧从肩膀拉伸到手 */
export function buildSleeve() {
  const g = new THREE.Group();
  box(g, 0.075, 0.075, 1, 0, 0, 0.5, M.sleeve);
  finalize(g);
  return g;
}

type V3 = [number, number, number];
export interface MeleeKey {
  t: number;
  /** 手（握把）在相机空间的位置 */
  hand: V3;
  /** 手腕旋转：x 负 = 刀尖向前，z 正 = 刀尖向左 */
  wrist: V3;
}

/** 各动作的关键帧（t 是攻击进度 0..1，前后自动补上待机姿势），hit 是判定命中的时刻 */
export const MELEE_ANIMS: Record<MeleeAnim, { hit: number; keys: MeleeKey[] }> = {
  // 从右上往左下横扫
  slash: {
    hit: 0.38,
    keys: [
      { t: 0.22, hand: [0.26, -0.08, -0.3], wrist: [0.2, 0, -0.5] },
      { t: 0.5, hand: [-0.2, -0.2, -0.36], wrist: [-0.5, 0, 1.5] },
    ],
  },
  // 从左上往右下反手扫回来
  slashR: {
    hit: 0.38,
    keys: [
      { t: 0.22, hand: [-0.12, -0.07, -0.32], wrist: [-0.2, 0, 1.1] },
      { t: 0.5, hand: [0.25, -0.24, -0.34], wrist: [-0.6, 0, -1.0] },
    ],
  },
  // 高举过头劈下
  chop: {
    hit: 0.52,
    keys: [
      { t: 0.35, hand: [0.2, -0.02, -0.36], wrist: [0.8, 0, 0.3] },
      { t: 0.56, hand: [0.06, -0.24, -0.4], wrist: [-0.7, -1.2, 0.5] },
    ],
  },
  // 收回来再向前突刺
  stab: {
    hit: 0.45,
    keys: [
      { t: 0.32, hand: [0.15, -0.2, -0.24], wrist: [-0.9, 0, 0.4] },
      { t: 0.48, hand: [0.05, -0.1, -0.48], wrist: [-1.05, 0, 0.35] },
    ],
  },
};
