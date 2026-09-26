import type { ShotSound } from '../core/audio';

export type WeaponClass = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'lmg' | 'sniper' | 'launcher' | 'wonder';

export const CLASS_NAMES: Record<WeaponClass, string> = {
  pistol: '手枪',
  smg: '冲锋枪',
  rifle: '步枪',
  shotgun: '霰弹枪',
  lmg: '机枪',
  sniper: '狙击枪',
  launcher: '爆破',
  wonder: '奇迹武器',
};

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  model: string;
  desc: string;
  damage: number;
  headMult: number;
  pellets: number;
  hipSpread: number; // 腰射散布（弧度）
  adsSpread: number;
  interval: number; // 射击间隔（秒）；点射武器为点射内的间隔
  auto: boolean;
  burst?: number; // 点射发数
  burstDelay?: number; // 两次点射之间的间隔
  mag: number;
  reload: number;
  recoil: number; // 每发后坐力（弧度）
  penetrate: number; // 可穿透的额外丧尸数
  falloff?: [number, number, number]; // [开始衰减距离, 完全衰减距离, 最低倍率]
  move: number; // 移动速度倍率
  adsFov: number;
  sound: ShotSound;
  cost: number; // 商店价格
  shop: boolean; // false = 神秘箱专属
  inBox: boolean;
  projectile?: { kind: 'ray' | 'rocket'; speed: number; splash: number; splashDamage: number; selfDamage?: number };
  chain?: { targets: number; range: number };
  /** 第一人称枪模位置覆盖 */
  vm?: { hip: [number, number, number]; adsZ: number };
}

const W = (d: WeaponDef) => d;
const snd = (freq: number, decay: number, thump: number, vol: number): ShotSound => ({ freq, decay, thump, vol });

export const WEAPONS: Record<string, WeaponDef> = {
  // ---------------- 手枪 ----------------
  m1911: W({
    id: 'm1911', name: 'M1911', cls: 'pistol', model: 'pistol', desc: '开局配枪，.45 口径半自动手枪。',
    damage: 45, headMult: 3, pellets: 1, hipSpread: 0.028, adsSpread: 0.004,
    interval: 0.14, auto: false, mag: 8, reload: 1.5,
    recoil: 0.014, penetrate: 0, move: 1, adsFov: 62,
    sound: snd(2600, 0.2, 140, 0.55), cost: 300, shop: true, inBox: false,
  }),
  c96: W({
    id: 'c96', name: 'Mauser C96', cls: 'pistol', model: 'c96', desc: '毛瑟“驳壳枪”，可以全自动连射的手枪。',
    damage: 42, headMult: 3, pellets: 1, hipSpread: 0.035, adsSpread: 0.008,
    interval: 0.075, auto: true, mag: 20, reload: 2.0,
    recoil: 0.011, penetrate: 0, move: 1, adsFov: 62,
    sound: snd(2900, 0.16, 150, 0.5), cost: 600, shop: true, inBox: true,
  }),
  python: W({
    id: 'python', name: 'Python', cls: 'pistol', model: 'revolver', desc: '.357 左轮，威力巨大，子弹能穿透。',
    damage: 300, headMult: 2, pellets: 1, hipSpread: 0.03, adsSpread: 0.003,
    interval: 0.35, auto: false, mag: 6, reload: 3.0,
    recoil: 0.05, penetrate: 1, move: 1, adsFov: 60,
    sound: snd(1800, 0.45, 90, 0.85), cost: 1200, shop: true, inBox: true,
  }),

  // ---------------- 冲锋枪 ----------------
  mp40: W({
    id: 'mp40', name: 'MP40', cls: 'smg', model: 'mp40', desc: '德军制式冲锋枪，稳定可靠。',
    damage: 55, headMult: 2.5, pellets: 1, hipSpread: 0.045, adsSpread: 0.012,
    interval: 0.1, auto: true, mag: 32, reload: 2.2,
    recoil: 0.009, penetrate: 0, move: 1, adsFov: 60,
    sound: snd(3000, 0.15, 150, 0.45), cost: 1000, shop: true, inBox: true,
  }),
  type100: W({
    id: 'type100', name: 'Type 100', cls: 'smg', model: 'type100', desc: '百式冲锋枪，射速高、换弹快，但单发伤害低。',
    damage: 45, headMult: 2.5, pellets: 1, hipSpread: 0.045, adsSpread: 0.012,
    interval: 0.075, auto: true, mag: 30, reload: 1.8,
    recoil: 0.008, penetrate: 0, move: 1, adsFov: 60,
    sound: snd(3200, 0.13, 160, 0.42), cost: 900, shop: true, inBox: true,
  }),
  thompson: W({
    id: 'thompson', name: 'Thompson', cls: 'smg', model: 'thompson', desc: '“芝加哥打字机”，射速快、手感扎实。',
    damage: 60, headMult: 2.5, pellets: 1, hipSpread: 0.045, adsSpread: 0.012,
    interval: 0.08, auto: true, mag: 30, reload: 2.3,
    recoil: 0.011, penetrate: 0, move: 1, adsFov: 60,
    sound: snd(2600, 0.16, 130, 0.5), cost: 1200, shop: true, inBox: true,
  }),
  mp5k: W({
    id: 'mp5k', name: 'MP5K', cls: 'smg', model: 'mp5k', desc: '紧凑型冲锋枪，射速极快，移动灵活。',
    damage: 50, headMult: 2.5, pellets: 1, hipSpread: 0.04, adsSpread: 0.011,
    interval: 0.06, auto: true, mag: 30, reload: 2.0,
    recoil: 0.008, penetrate: 0, move: 1.05, adsFov: 60,
    sound: snd(3300, 0.12, 170, 0.42), cost: 1400, shop: true, inBox: true,
  }),
  ak74u: W({
    id: 'ak74u', name: 'AK-74u', cls: 'smg', model: 'ak74u', desc: '短突击步枪，近距离火力凶猛。',
    damage: 75, headMult: 2.5, pellets: 1, hipSpread: 0.045, adsSpread: 0.01,
    interval: 0.075, auto: true, mag: 30, reload: 2.2,
    recoil: 0.012, penetrate: 0, move: 1, adsFov: 58,
    sound: snd(2700, 0.2, 130, 0.55), cost: 1600, shop: true, inBox: true,
  }),
  ppsh: W({
    id: 'ppsh', name: 'PPSh-41', cls: 'smg', model: 'ppsh', desc: '“波波沙”，71 发弹鼓，火力压制之王。',
    damage: 55, headMult: 2.5, pellets: 1, hipSpread: 0.05, adsSpread: 0.015,
    interval: 0.055, auto: true, mag: 71, reload: 2.9,
    recoil: 0.008, penetrate: 0, move: 1, adsFov: 60,
    sound: snd(3200, 0.13, 160, 0.42), cost: 2200, shop: true, inBox: true,
  }),

  // ---------------- 步枪 ----------------
  m14: W({
    id: 'm14', name: 'M14', cls: 'rifle', model: 'm14', desc: '半自动步枪，精准且能穿透。',
    damage: 110, headMult: 2.5, pellets: 1, hipSpread: 0.04, adsSpread: 0.002,
    interval: 0.13, auto: false, mag: 8, reload: 1.9,
    recoil: 0.022, penetrate: 1, move: 0.95, adsFov: 55,
    sound: snd(2100, 0.32, 105, 0.72), cost: 500, shop: true, inBox: false,
  }),
  gewehr43: W({
    id: 'gewehr43', name: 'Gewehr 43', cls: 'rifle', model: 'gewehr43', desc: '德制半自动步枪，10 发弹匣。',
    damage: 125, headMult: 2.5, pellets: 1, hipSpread: 0.04, adsSpread: 0.002,
    interval: 0.14, auto: false, mag: 10, reload: 2.1,
    recoil: 0.024, penetrate: 1, move: 0.95, adsFov: 55,
    sound: snd(2000, 0.34, 100, 0.75), cost: 700, shop: true, inBox: true,
  }),
  m16: W({
    id: 'm16', name: 'M16', cls: 'rifle', model: 'm16', desc: '三连发突击步枪，点射又快又准。',
    damage: 100, headMult: 2.5, pellets: 1, hipSpread: 0.035, adsSpread: 0.003,
    interval: 0.06, auto: false, burst: 3, burstDelay: 0.26, mag: 30, reload: 2.3,
    recoil: 0.012, penetrate: 1, move: 0.97, adsFov: 55,
    sound: snd(2600, 0.22, 120, 0.6), cost: 1200, shop: true, inBox: true,
  }),
  stg44: W({
    id: 'stg44', name: 'STG-44', cls: 'rifle', model: 'stg44', desc: '世界上第一款突击步枪，全能选手。',
    damage: 105, headMult: 2.5, pellets: 1, hipSpread: 0.045, adsSpread: 0.006,
    interval: 0.1, auto: true, mag: 30, reload: 2.4,
    recoil: 0.013, penetrate: 1, move: 0.95, adsFov: 55,
    sound: snd(2300, 0.28, 115, 0.65), cost: 1800, shop: true, inBox: true,
  }),
  bar: W({
    id: 'bar', name: 'BAR', cls: 'rifle', model: 'bar', desc: '勃朗宁自动步枪，高伤害全自动。',
    damage: 130, headMult: 2.5, pellets: 1, hipSpread: 0.05, adsSpread: 0.006,
    interval: 0.15, auto: true, mag: 20, reload: 2.6,
    recoil: 0.02, penetrate: 1, move: 0.9, adsFov: 55,
    sound: snd(1900, 0.35, 100, 0.75), cost: 1800, shop: true, inBox: true,
  }),
  fg42: W({
    id: 'fg42', name: 'FG42', cls: 'rifle', model: 'fg42', desc: '伞兵步枪，全自动、射速高。',
    damage: 115, headMult: 2.5, pellets: 1, hipSpread: 0.05, adsSpread: 0.007,
    interval: 0.075, auto: true, mag: 20, reload: 2.3,
    recoil: 0.016, penetrate: 1, move: 0.95, adsFov: 55,
    sound: snd(2200, 0.3, 110, 0.7), cost: 2000, shop: true, inBox: true,
  }),
  galil: W({
    id: 'galil', name: 'Galil', cls: 'rifle', model: 'galil', desc: '35 发大弹匣突击步枪，均衡耐用。',
    damage: 120, headMult: 2.5, pellets: 1, hipSpread: 0.045, adsSpread: 0.005,
    interval: 0.085, auto: true, mag: 35, reload: 2.5,
    recoil: 0.013, penetrate: 1, move: 0.95, adsFov: 55,
    sound: snd(2400, 0.27, 115, 0.66), cost: 2500, shop: true, inBox: true,
  }),

  // ---------------- 霰弹枪 ----------------
  olympia: W({
    id: 'olympia', name: 'Olympia', cls: 'shotgun', model: 'doublebarrel', desc: '双管猎枪，近距离一枪一大片。',
    damage: 42, headMult: 1.5, pellets: 8, hipSpread: 0.085, adsSpread: 0.06,
    interval: 0.26, auto: false, mag: 2, reload: 2.4,
    recoil: 0.05, penetrate: 0, falloff: [5, 16, 0.3], move: 0.95, adsFov: 64,
    sound: snd(1500, 0.5, 85, 0.9), cost: 500, shop: true, inBox: false,
  }),
  trench: W({
    id: 'trench', name: 'Trench Gun', cls: 'shotgun', model: 'trench', desc: '泵动式战壕霰弹枪，六发弹仓。',
    damage: 55, headMult: 1.5, pellets: 8, hipSpread: 0.075, adsSpread: 0.055,
    interval: 0.7, auto: false, mag: 6, reload: 3.0,
    recoil: 0.06, penetrate: 0, falloff: [6, 18, 0.35], move: 0.95, adsFov: 64,
    sound: snd(1400, 0.55, 80, 0.95), cost: 1500, shop: true, inBox: true,
  }),
  spas12: W({
    id: 'spas12', name: 'SPAS-12', cls: 'shotgun', model: 'spas12', desc: '半自动霰弹枪，可以连续轰击。',
    damage: 50, headMult: 1.5, pellets: 8, hipSpread: 0.07, adsSpread: 0.05,
    interval: 0.3, auto: false, mag: 8, reload: 3.2,
    recoil: 0.05, penetrate: 0, falloff: [6, 18, 0.35], move: 0.93, adsFov: 64,
    sound: snd(1450, 0.5, 82, 0.9), cost: 2000, shop: true, inBox: true,
  }),

  // ---------------- 机枪 ----------------
  m1919: W({
    id: 'm1919', name: 'M1919', cls: 'lmg', model: 'm1919', desc: '勃朗宁机枪，125 发弹链持续输出。',
    damage: 125, headMult: 2, pellets: 1, hipSpread: 0.065, adsSpread: 0.012,
    interval: 0.09, auto: true, mag: 125, reload: 5.2,
    recoil: 0.013, penetrate: 1, move: 0.85, adsFov: 56,
    sound: snd(1900, 0.32, 105, 0.72), cost: 2800, shop: true, inBox: true,
  }),
  rpk: W({
    id: 'rpk', name: 'RPK', cls: 'lmg', model: 'rpk', desc: '轻机枪，75 发弹鼓，机动性好。',
    damage: 120, headMult: 2.2, pellets: 1, hipSpread: 0.055, adsSpread: 0.01,
    interval: 0.085, auto: true, mag: 75, reload: 3.8,
    recoil: 0.012, penetrate: 1, move: 0.9, adsFov: 56,
    sound: snd(2200, 0.3, 110, 0.7), cost: 3000, shop: true, inBox: true,
  }),
  mg42: W({
    id: 'mg42', name: 'MG42', cls: 'lmg', model: 'mg42', desc: '射速惊人的通用机枪，“撕布机”。',
    damage: 120, headMult: 2, pellets: 1, hipSpread: 0.06, adsSpread: 0.012,
    interval: 0.05, auto: true, mag: 125, reload: 5.0,
    recoil: 0.012, penetrate: 1, move: 0.85, adsFov: 56,
    sound: snd(2000, 0.3, 110, 0.7), cost: 3500, shop: true, inBox: true,
  }),

  // ---------------- 狙击枪 ----------------
  kar98k: W({
    id: 'kar98k', name: 'Kar98k', cls: 'sniper', model: 'kar98k', desc: '栓动步枪，开镜一枪爆头，可穿透两只。',
    damage: 450, headMult: 3, pellets: 1, hipSpread: 0.05, adsSpread: 0.0008,
    interval: 1.0, auto: false, mag: 5, reload: 2.6,
    recoil: 0.05, penetrate: 2, move: 0.95, adsFov: 38,
    sound: snd(1900, 0.5, 95, 0.9), cost: 900, shop: true, inBox: true,
  }),
  ptrs: W({
    id: 'ptrs', name: 'PTRS-41', cls: 'sniper', model: 'ptrs', desc: '反坦克步枪，一发贯穿一整排丧尸。',
    damage: 1200, headMult: 2, pellets: 1, hipSpread: 0.06, adsSpread: 0.0008,
    interval: 0.9, auto: false, mag: 5, reload: 3.4,
    recoil: 0.07, penetrate: 6, move: 0.85, adsFov: 34,
    sound: snd(1300, 0.7, 70, 1.0), cost: 2500, shop: true, inBox: true,
    vm: { hip: [0.13, -0.15, -0.16], adsZ: -0.15 },
  }),

  // ---------------- 爆破 ----------------
  panzerschreck: W({
    id: 'panzerschreck', name: 'Panzerschreck', cls: 'launcher', model: 'panzerschreck', desc: '火箭筒，大范围爆炸——离远点，会炸到自己。',
    damage: 600, headMult: 1, pellets: 1, hipSpread: 0.02, adsSpread: 0.004,
    interval: 0.6, auto: false, mag: 1, reload: 2.6,
    recoil: 0.06, penetrate: 0, move: 0.85, adsFov: 58,
    sound: { freq: 900, decay: 0.8, thump: 60, vol: 1 }, cost: 3000, shop: true, inBox: true,
    projectile: { kind: 'rocket', speed: 26, splash: 4.5, splashDamage: 1800, selfDamage: 60 },
    vm: { hip: [0.21, -0.135, -0.27], adsZ: -0.24 },
  }),

  // ---------------- 奇迹武器（神秘箱专属） ----------------
  raygun: W({
    id: 'raygun', name: 'Ray Gun', cls: 'wonder', model: 'raygun', desc: '射出绿色能量弹，命中后范围杀伤。',
    damage: 1000, headMult: 1, pellets: 1, hipSpread: 0.012, adsSpread: 0.002,
    interval: 0.3, auto: false, mag: 20, reload: 2.8,
    recoil: 0.015, penetrate: 0, move: 1, adsFov: 62,
    sound: { freq: 0, decay: 0, thump: 0, vol: 1, zap: true }, cost: 0, shop: false, inBox: true,
    projectile: { kind: 'ray', speed: 55, splash: 2.6, splashDamage: 450 },
  }),
  wunderwaffe: W({
    id: 'wunderwaffe', name: 'Wunderwaffe DG-2', cls: 'wonder', model: 'wunderwaffe', desc: '发射连锁闪电，一次电倒一整群丧尸。',
    damage: 3000, headMult: 1, pellets: 1, hipSpread: 0.01, adsSpread: 0.002,
    interval: 0.7, auto: false, mag: 3, reload: 3.6,
    recoil: 0.04, penetrate: 0, move: 0.95, adsFov: 60,
    sound: { freq: 0, decay: 0, thump: 0, vol: 1, zap: true }, cost: 0, shop: false, inBox: true,
    chain: { targets: 10, range: 7 },
    vm: { hip: [0.13, -0.145, -0.3], adsZ: -0.24 },
  }),
};

export const BOX_POOL = Object.values(WEAPONS).filter((w) => w.inBox);

export const PERKS = {
  jugg: { name: 'Juggernog', cost: 2500, color: '#ff3b2f', hud: '#d62a20', icon: '✚', desc: '生命值提升到 250' },
  speed: { name: 'Speed Cola', cost: 3000, color: '#3dff6a', hud: '#1f9e3c', icon: '⚡', desc: '换弹速度翻倍' },
  doubletap: { name: 'Double Tap', cost: 2000, color: '#ffb02e', hud: '#d9861a', icon: '»', desc: '射速提升 33%' },
} as const;

/** 路障升级：三条线，每条两级 */
export type UpgradeId = 'armor' | 'shock' | 'repair';
export const UPGRADES: Record<UpgradeId, { name: string; icon: string; levels: { cost: number; name: string; desc: string }[]; base: string }> = {
  armor: {
    name: '路障材质',
    icon: '🛡',
    base: '普通木板：丧尸拉一下就掉一块。',
    levels: [
      { cost: 800, name: '厚木板', desc: '换成更厚的木板，每块要拉 2 下才会掉。' },
      { cost: 1500, name: '带铆钉厚木板', desc: '厚木板钉上铁条和铆钉，每块要拉 3 下。' },
      { cost: 2500, name: '普通钢板', desc: '换成钢板，每块要拉 4 下。' },
      { cost: 3500, name: '加厚钢板', desc: '加厚的焊接钢板，每块要拉 5 下。' },
      { cost: 5000, name: '带铆钉加厚钢板', desc: '加厚钢板再打上一圈铆钉，每块要拉 6 下。' },
      { cost: 7000, name: '带铁丝网的铆钉加厚钢板', desc: '在铆钉加厚钢板上缠满带刺铁丝网（耐久不变），丧尸每拉一下被扎掉 20 点生命值（反伤）。' },
    ],
  },
  shock: {
    name: '电网',
    icon: '⚡',
    base: '没有电网。',
    levels: [
      { cost: 2000, name: '电击陷阱', desc: '每扇窗每 8 秒充能一次，电击正在拆板的丧尸，造成 300 伤害并定住 0.8 秒（普通丧尸一下电死）。' },
      { cost: 4000, name: '高压电网', desc: '每 5 秒充能一次，每次 800 伤害并定住 0.8 秒（普通和精英一下电死，超精英要 4 下）。' },
    ],
  },
  repair: {
    name: '自动修复',
    icon: '🔨',
    base: '只能手动按住 F 修复。',
    levels: [
      { cost: 1000, name: '修理工具', desc: '每扇窗每 12 秒自动补回一块木板。' },
      { cost: 2500, name: '自动钉枪', desc: '每扇窗每 6 秒自动补回一块木板。' },
    ],
  },
};
