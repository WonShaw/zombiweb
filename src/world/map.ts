/**
 * 地图布局（俯视，x 向右，z 向下 = 南）。每格 1 米。
 *
 *   ┌───────────────── E 北侧长廊 ─────────────────┐
 *   │                    [5]                       │
 *   ├──[3]───┬──── C 饮料房（死路）────┬───[4]─────┤
 *   │        │                          │           │
 *   │ B 西翼 │                          │  D 东翼   │
 *   │ (神秘箱)├───────────────────────────┤ (快手可乐) │
 *   │       [1]      A 起始房间        [2]          │
 *   │        │                          │           │
 *   └────────┴──────────────────────────┴───────────┘
 *
 * 门 1/2 从起始房间通往两翼，3/4 再通往北廊，形成可以“绕圈”的环线；
 * 门 5 通往饮料房 C（Juggernog 和 Double Tap 都在这里，但只有一个出口）。
 */

export const T = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  DOOR: 3,
  WINDOW: 4,
  CRATE: 5,
  OBJECT: 6,
} as const;

export type PerkId = 'jugg' | 'speed' | 'doubletap';

export interface DoorDef {
  cost: number;
  cells: [number, number][];
}
export interface WallBuyDef {
  weapon: string;
  x: number;
  z: number;
  face: [number, number];
}
export interface PerkDef {
  perk: PerkId;
  x: number;
  z: number;
  face: [number, number];
}
export interface BoxDef {
  cells: [number, number][];
  face: [number, number];
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
}

export interface MapDef {
  w: number;
  h: number;
  grid: Uint8Array;
  doors: DoorDef[];
  windows: [number, number][];
  wallBuys: WallBuyDef[];
  perks: PerkDef[];
  box: BoxDef;
  lamps: LampDef[];
  crates: CrateDef[];
  start: { x: number; z: number; yaw: number };
}

export function buildMap(): MapDef {
  const W = 42;
  const H = 30;
  const grid = new Uint8Array(W * H);
  const set = (x: number, z: number, t: number) => (grid[z * W + x] = t);
  const fill = (x0: number, z0: number, x1: number, z1: number, t: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, t);
  };

  fill(1, 1, 40, 28, T.WALL);
  fill(2, 2, 39, 6, T.FLOOR); // E 北廊
  fill(2, 8, 13, 27, T.FLOOR); // B 西翼
  fill(15, 8, 26, 16, T.FLOOR); // C 饮料房
  fill(15, 18, 26, 27, T.FLOOR); // A 起始房间
  fill(28, 8, 39, 27, T.FLOOR); // D 东翼

  // 北廊里的柱子
  for (const x of [9, 16, 25, 32]) set(x, 4, T.WALL);

  const doors: DoorDef[] = [
    { cost: 750, cells: [[14, 22], [14, 23]] }, // A ↔ B
    { cost: 750, cells: [[27, 22], [27, 23]] }, // A ↔ D
    { cost: 1000, cells: [[7, 7], [8, 7]] }, // B ↔ E
    { cost: 1000, cells: [[33, 7], [34, 7]] }, // D ↔ E
    { cost: 1250, cells: [[20, 7], [21, 7]] }, // E ↔ C
  ];
  for (const d of doors) for (const [x, z] of d.cells) set(x, z, T.DOOR);

  const windows: [number, number][] = [
    // A 南墙
    [17, 28], [21, 28], [24, 28],
    // B
    [1, 11], [1, 17], [1, 24], [7, 28],
    // D
    [40, 11], [40, 17], [40, 24], [34, 28],
    // E
    [5, 1], [13, 1], [28, 1], [36, 1], [1, 4], [40, 4],
  ];
  for (const [x, z] of windows) set(x, z, T.WINDOW);

  const crates: CrateDef[] = [
    { x: 5, z: 20, h: 0.9 },
    { x: 6, z: 20, h: 1.8 },
    { x: 10, z: 10, h: 0.9 },
    { x: 11, z: 10, h: 0.9 },
    { x: 10, z: 25, h: 1.8 },
    { x: 31, z: 10, h: 1.8 },
    { x: 32, z: 10, h: 0.9 },
    { x: 36, z: 20, h: 0.9 },
    { x: 36, z: 21, h: 1.8 },
    { x: 31, z: 25, h: 0.9 },
    { x: 16, z: 26, h: 0.9 },
    { x: 25, z: 19, h: 0.9 },
    { x: 18, z: 15, h: 0.9 },
    { x: 23, z: 9, h: 1.8 },
  ];
  for (const c of crates) set(c.x, c.z, T.CRATE);

  const wallBuys: WallBuyDef[] = [
    { weapon: 'olympia', x: 14, z: 20, face: [1, 0] },
    { weapon: 'm14', x: 18, z: 17, face: [0, 1] },
    { weapon: 'mp40', x: 14, z: 11, face: [-1, 0] },
    { weapon: 'thompson', x: 27, z: 12, face: [1, 0] },
    { weapon: 'trench', x: 26, z: 7, face: [0, -1] },
    { weapon: 'bar', x: 11, z: 7, face: [0, -1] },
  ];

  const perks: PerkDef[] = [
    { perk: 'jugg', x: 15, z: 12, face: [1, 0] },
    { perk: 'doubletap', x: 26, z: 12, face: [-1, 0] },
    { perk: 'speed', x: 39, z: 14, face: [-1, 0] },
  ];
  for (const p of perks) set(p.x, p.z, T.OBJECT);

  const box: BoxDef = { cells: [[2, 14], [2, 15]], face: [1, 0] };
  for (const [x, z] of box.cells) set(x, z, T.OBJECT);

  const lamps: LampDef[] = [
    { x: 18, z: 23 },
    { x: 24, z: 23 },
    { x: 8, z: 12 },
    { x: 8, z: 23, flicker: true },
    { x: 21, z: 12 },
    { x: 34, z: 12, flicker: true },
    { x: 34, z: 23 },
    { x: 12.5, z: 4 },
    { x: 28.5, z: 4, flicker: true },
  ];

  return {
    w: W,
    h: H,
    grid,
    doors,
    windows,
    wallBuys,
    perks,
    box,
    lamps,
    crates,
    start: { x: 21, z: 24, yaw: 0 },
  };
}
