/**
 * 地图布局（俯视，x 向右，z 向下 = 南）。每格 1 米。
 *
 *   ┌─────────────────── G 北侧长廊（2 窗）───────────────────┐
 *   ├───[5]───┬──────────────[7]──────────────┬───[6]───┤
 *   │ C 西北  │                                │ E 东北  │
 *   │ DoubleTap│   F 饮料房（Juggernog，死路）   │ （2 窗） │
 *   │（2 窗）  ├────────────────────────────────┤         │
 *   ├───[3]───┤                                ├───[4]───┤
 *   │ B 西南  [1]      A 起始房间（3 窗）      [2] D 东南  │
 *   │ 神秘箱   │                                │SpeedCola│
 *   │（2 窗）  │                                │（2 窗）  │
 *   └─────────┴────────────────────────────────┴─────────┘
 *
 * 每开一扇门只多出 0～2 扇窗，越往里门越贵：
 *   A(3 窗) → 门 1/2 (750) 西南 B / 东南 D 各 +2 → 门 3/4 (1000) 西北 C / 东北 E 各 +2
 *   → 门 5/6 (1000) 北廊 G +2 → 门 7 (1250) 饮料房 F（没有窗，但只有一个入口）。
 * 两边都开通后可以沿 A–B–C–G–E–D 绕一大圈。
 */

export const T = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  DOOR: 3,
  WINDOW: 4,
  CRATE: 5,
  OBJECT: 6,
  /** 楼梯：上下两层网格里同一格都标成 STAIR，地面高度按斜坡算 */
  STAIR: 7,
  /** 二楼的挑空（中庭上方的空气）：不能走，子弹能穿过 */
  OPEN: 8,
  /** 玻璃墙：和墙一样挡人挡子弹，只是画成玻璃 */
  GLASS: 9,
} as const;

export type PerkId = 'jugg' | 'speed' | 'doubletap';
export type MapId = 'manor' | 'lab';
/** 0 一楼，1 二楼 */
export type Layer = 0 | 1;

export interface DoorDef {
  cost: number;
  cells: [number, number][];
  layer?: Layer;
  /** 门上方的房间牌：[坐标较小一侧的房间名, 较大一侧的房间名]（从一侧看到的是另一侧的名字） */
  names?: [string, string];
}
export interface PerkDef {
  perk: PerkId;
  x: number;
  z: number;
  face: [number, number];
  layer?: Layer;
}
export interface BoxDef {
  cells: [number, number][];
  face: [number, number];
  layer?: Layer;
}
export interface LampDef {
  x: number;
  z: number;
  flicker?: boolean;
}
export interface CrateDef {
  x: number;
  z: number;
  h: number;
  layer?: Layer;
}
/** 窗户：x, z, 楼层（默认一楼） */
export type WindowDef = [number, number] | [number, number, Layer];
/** 楼梯：矩形区域沿 dir 方向从一楼地面升到二楼地面 */
export interface StairDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  dir: [number, number];
}
/** 研究中心的家具 / 设备：占的格子按 h 高度挡人挡子弹，外观由场景按 kind 画 */
export interface PropDef {
  kind: string;
  x: number;
  z: number;
  /** 占几格（x 方向 × z 方向），默认 1×1 */
  w?: number;
  d?: number;
  h: number;
  layer?: Layer;
  /** 朝向（正面法线），默认 [0, 1] */
  face?: [number, number];
}

export interface MapDef {
  id: MapId;
  name: string;
  /** night 夜晚庄园（点光源 + 雾），day 白天研究中心（太阳 + 阴影） */
  theme: 'night' | 'day';
  w: number;
  h: number;
  grid: Uint8Array;
  /** 二楼网格（单层地图没有） */
  grid2?: Uint8Array;
  /** 层高：二楼地面的高度；单层地图等于墙高 */
  storey: number;
  doors: DoorDef[];
  windows: WindowDef[];
  perks: PerkDef[];
  box: BoxDef;
  lamps: LampDef[];
  crates: CrateDef[];
  stairs?: StairDef[];
  props?: PropDef[];
  start: { x: number; z: number; yaw: number };
}

export const MAP_LIST: { id: MapId; name: string; desc: string }[] = [
  { id: 'manor', name: '死亡之夜 · 废弃庄园', desc: '月夜下的单层庄园，七个房间绕成一圈。' },
  { id: 'lab', name: '白昼危机 · 城市研究中心', desc: '白天的两层研究大楼：中庭大楼梯、二楼回廊，丧尸还会顺着脚手架爬上二楼窗户。' },
];

export function buildManor(): MapDef {
  const W = 42;
  const H = 30;
  const grid = new Uint8Array(W * H);
  const set = (x: number, z: number, t: number) => (grid[z * W + x] = t);
  const fill = (x0: number, z0: number, x1: number, z1: number, t: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, t);
  };

  fill(1, 1, 40, 28, T.WALL);
  fill(2, 2, 39, 6, T.FLOOR); // G 北廊
  fill(2, 8, 13, 17, T.FLOOR); // C 西北
  fill(2, 19, 13, 27, T.FLOOR); // B 西南
  fill(15, 8, 26, 16, T.FLOOR); // F 饮料房
  fill(15, 18, 26, 27, T.FLOOR); // A 起始房间
  fill(28, 8, 39, 17, T.FLOOR); // E 东北
  fill(28, 19, 39, 27, T.FLOOR); // D 东南

  // 北廊里的柱子
  for (const x of [9, 16, 25, 32]) set(x, 4, T.WALL);

  const doors: DoorDef[] = [
    { cost: 750, cells: [[14, 22], [14, 23]] }, // 1: A ↔ B
    { cost: 750, cells: [[27, 22], [27, 23]] }, // 2: A ↔ D
    { cost: 1000, cells: [[7, 18], [8, 18]] }, // 3: B ↔ C
    { cost: 1000, cells: [[33, 18], [34, 18]] }, // 4: D ↔ E
    { cost: 1000, cells: [[7, 7], [8, 7]] }, // 5: C ↔ G
    { cost: 1000, cells: [[33, 7], [34, 7]] }, // 6: E ↔ G
    { cost: 1250, cells: [[20, 7], [21, 7]] }, // 7: G ↔ F
  ];
  for (const d of doors) for (const [x, z] of d.cells) set(x, z, T.DOOR);

  const windows: [number, number][] = [
    // A 南墙
    [17, 28], [21, 28], [24, 28],
    // B
    [1, 25], [9, 28],
    // D
    [40, 25], [33, 28],
    // C
    [1, 10], [1, 15],
    // E
    [40, 10], [40, 16],
    // G
    [11, 1], [30, 1],
  ];
  for (const [x, z] of windows) set(x, z, T.WINDOW);

  const crates: CrateDef[] = [
    // B
    { x: 5, z: 20, h: 0.9 },
    { x: 6, z: 20, h: 1.8 },
    { x: 11, z: 24, h: 1.8 },
    // C
    { x: 9, z: 11, h: 0.9 },
    { x: 10, z: 11, h: 0.9 },
    { x: 5, z: 16, h: 1.8 },
    // D
    { x: 31, z: 25, h: 0.9 },
    { x: 36, z: 20, h: 1.8 },
    // E
    { x: 31, z: 10, h: 1.8 },
    { x: 32, z: 10, h: 0.9 },
    { x: 36, z: 14, h: 0.9 },
    // A
    { x: 16, z: 26, h: 0.9 },
    { x: 25, z: 19, h: 0.9 },
    // F
    { x: 18, z: 15, h: 0.9 },
    { x: 23, z: 9, h: 1.8 },
    // G
    { x: 20, z: 2, h: 0.9 },
  ];
  for (const c of crates) set(c.x, c.z, T.CRATE);

  const perks: PerkDef[] = [
    { perk: 'jugg', x: 15, z: 12, face: [1, 0] },
    { perk: 'doubletap', x: 13, z: 13, face: [-1, 0] },
    { perk: 'speed', x: 39, z: 21, face: [-1, 0] },
  ];
  for (const p of perks) set(p.x, p.z, T.OBJECT);

  const box: BoxDef = { cells: [[2, 21], [2, 22]], face: [1, 0] };
  for (const [x, z] of box.cells) set(x, z, T.OBJECT);

  const lamps: LampDef[] = [
    { x: 18, z: 23 },
    { x: 24, z: 23 },
    { x: 8, z: 12.5, flicker: true },
    { x: 8, z: 23 },
    { x: 21, z: 12 },
    { x: 34, z: 12.5, flicker: true },
    { x: 34, z: 23 },
    { x: 12.5, z: 4 },
    { x: 28.5, z: 4, flicker: true },
  ];

  return {
    id: 'manor',
    name: '废弃庄园',
    theme: 'night',
    w: W,
    h: H,
    grid,
    storey: 3,
    doors,
    windows,
    perks,
    box,
    lamps,
    crates,
    start: { x: 21, z: 24, yaw: 0 },
  };
}
