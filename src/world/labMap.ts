import { T, type MapDef, type DoorDef, type PerkDef, type BoxDef, type PropDef, type StairDef, type WindowDef, type Layer } from './map';

/** 研究中心的层高：二楼地面在 3.6 米 */
export const LAB_STOREY = 3.6;

/**
 * 城市研究中心（白天，两层）。俯视，x 向右，z 向下 = 南。
 *
 * 一楼：
 *   ┌──────────────── C 北侧后勤走廊（2 窗，Double Tap）────────────────┐
 *   ├─[3]──────┬──────────────────────────────────────┬──────[4]─┤
 *   │ B 生物   │  A 大厅（起点）                        │ D 员工    │
 *   │ 实验室   [1]      ┌──大楼梯──┐（中庭挑空到屋顶） [2] 餐厅    │
 *   │（2 窗，   │        └─────────┘                     │（2 窗，   │
 *   │ 神秘箱）  │                                         │ Speed Cola）│
 *   │ [8]侧楼梯 │  南面玻璃幕墙（2 窗）                   │ 侧楼梯[9] │
 *   └──────────┴──────────────────────────────────────┴──────────┘
 *
 * 二楼：
 *   ┌──────────────┬──── F 主任实验室（Juggernog，没有窗）────┬──────────┐
 *   │   （实心）   ├──────────────[7]──────────────────────┤  （实心）│
 *   │ G 计算机房  [5]  二楼回廊（绕着中庭，和大厅同一区域， [6] H 办公区 │
 *   │（2 窗）      │  南面 1 扇窗）                         │（2 窗）   │
 *   └──────────────┴──────────────────────────────────────┴──────────┘
 *
 * 起点大厅 + 回廊一共 3 扇窗（一楼 2、二楼 1）。开门顺序：
 *   A → 门 1/2 (750) B / D 各 +2 → 门 3/4 (1000) 北廊 C +2
 *     → 门 5/6 (1000) 二楼 G / H 各 +2（也可以从 B / D 里的侧楼梯门 8/9 (1000) 上去）
 *     → 门 7 (1250) 主任实验室 F（没有窗）。
 * 二楼的窗户外面搭着脚手架，丧尸会先爬上脚手架再拆板翻窗。
 */
export function buildLab(): MapDef {
  const W = 44;
  const H = 27;
  const g0 = new Uint8Array(W * H);
  const g1 = new Uint8Array(W * H);
  const grids = [g0, g1];
  const set = (l: Layer, x: number, z: number, t: number) => (grids[l][z * W + x] = t);
  const fill = (l: Layer, x0: number, z0: number, x1: number, z1: number, t: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(l, x, z, t);
  };

  // ---------- 一楼 ----------
  fill(0, 1, 1, 42, 25, T.WALL);
  fill(0, 2, 2, 41, 5, T.FLOOR); // C 北廊
  fill(0, 2, 7, 11, 24, T.FLOOR); // B 生物实验室
  fill(0, 13, 7, 30, 24, T.FLOOR); // A 大厅
  fill(0, 32, 7, 41, 24, T.FLOOR); // D 员工餐厅
  // B / D 里的侧楼梯间（四面是墙，南面一扇门）
  fill(0, 9, 16, 11, 23, T.WALL);
  fill(0, 32, 16, 34, 23, T.WALL);
  // 大厅两侧和南面的玻璃
  for (const z of [8, 9, 10, 14, 15]) {
    set(0, 12, z, T.GLASS);
    set(0, 31, z, T.GLASS);
  }
  fill(0, 13, 25, 30, 25, T.GLASS);

  // ---------- 二楼 ----------
  fill(1, 1, 1, 42, 25, T.WALL);
  fill(1, 13, 2, 30, 8, T.FLOOR); // F 主任实验室
  fill(1, 13, 10, 30, 24, T.FLOOR); // 回廊
  fill(1, 16, 13, 27, 21, T.OPEN); // 中庭挑空
  fill(1, 2, 10, 11, 24, T.FLOOR); // G 计算机房
  fill(1, 32, 10, 41, 24, T.FLOOR); // H 办公区
  // 主任实验室朝回廊的玻璃墙、回廊南面的玻璃幕墙、G / H 朝回廊的玻璃
  for (const x of [15, 16, 17, 18, 25, 26, 27, 28]) set(1, x, 9, T.GLASS);
  fill(1, 13, 25, 30, 25, T.GLASS);
  for (const z of [19, 20, 21, 22]) {
    set(1, 12, z, T.GLASS);
    set(1, 31, z, T.GLASS);
  }

  // ---------- 楼梯（两层网格里都标成 STAIR） ----------
  const stairs: StairDef[] = [
    { x0: 20, z0: 13, x1: 23, z1: 18, dir: [0, -1] }, // 中庭大楼梯，从南往北上到二楼北回廊
    { x0: 10, z0: 17, x1: 11, z1: 22, dir: [0, -1] }, // B → G 侧楼梯
    { x0: 32, z0: 17, x1: 33, z1: 22, dir: [0, -1] }, // D → H 侧楼梯
  ];
  for (const s of stairs) {
    fill(0, s.x0, s.z0, s.x1, s.z1, T.STAIR);
    fill(1, s.x0, s.z0, s.x1, s.z1, T.STAIR);
  }

  // ---------- 门 ----------
  const N = {
    A: '大厅|LOBBY',
    B: '生物实验室|BIO LAB',
    C: '后勤通道|SERVICE',
    D: '员工餐厅|CAFETERIA',
    M: '二楼回廊|MEZZANINE',
    G: '计算机房|SERVER ROOM',
    H: '办公区|OFFICES',
    F: '主任实验室|DIRECTOR',
    S: '楼梯 · 二楼|STAIRS · 2F',
  };
  const doors: DoorDef[] = [
    { cost: 750, cells: [[12, 12], [12, 13]], names: [N.B, N.A] }, // 1: A ↔ B
    { cost: 750, cells: [[31, 12], [31, 13]], names: [N.A, N.D] }, // 2: A ↔ D
    { cost: 1000, cells: [[3, 6], [4, 6]], names: [N.C, N.B] }, // 3: B ↔ C
    { cost: 1000, cells: [[39, 6], [40, 6]], names: [N.C, N.D] }, // 4: D ↔ C
    { cost: 1000, cells: [[12, 13], [12, 14]], layer: 1, names: [N.G, N.M] }, // 5: 回廊 ↔ G
    { cost: 1000, cells: [[31, 13], [31, 14]], layer: 1, names: [N.M, N.H] }, // 6: 回廊 ↔ H
    { cost: 1250, cells: [[21, 9], [22, 9]], layer: 1, names: [N.F, N.M] }, // 7: 回廊 ↔ F
    { cost: 1000, cells: [[10, 23], [11, 23]], names: [N.S, N.B] }, // 8: B → 侧楼梯 → G
    { cost: 1000, cells: [[32, 23], [33, 23]], names: [N.S, N.D] }, // 9: D → 侧楼梯 → H
  ];
  for (const d of doors) for (const [x, z] of d.cells) set(d.layer ?? 0, x, z, T.DOOR);

  // ---------- 窗 ----------
  const windows: WindowDef[] = [
    // A 大厅南面（一楼 2 扇 + 回廊 1 扇）
    [15, 25], [28, 25], [21, 25, 1],
    // B 西墙
    [1, 10], [1, 20],
    // D 东墙
    [42, 10], [42, 20],
    // C 北墙
    [8, 1], [35, 1],
    // G 西墙（二楼）
    [1, 13, 1], [1, 22, 1],
    // H 东墙（二楼）
    [42, 13, 1], [42, 22, 1],
  ];
  for (const [x, z, l] of windows) set(l ?? 0, x, z, T.WINDOW);

  // ---------- 家具 / 设备 ----------
  const props: PropDef[] = [
    // A 大厅
    { kind: 'reception', x: 14, z: 19, w: 3, h: 1.1, face: [0, 1] },
    { kind: 'sofa', x: 26, z: 22, w: 2, h: 0.8, face: [0, -1] },
    { kind: 'sofa', x: 26, z: 19, w: 2, h: 0.8, face: [0, 1] },
    { kind: 'tree', x: 17, z: 14, h: 0.9 },
    { kind: 'tree', x: 26, z: 14, h: 0.9 },
    { kind: 'plant', x: 13, z: 24, h: 1.2 },
    { kind: 'plant', x: 30, z: 24, h: 1.2 },
    { kind: 'plant', x: 13, z: 7, h: 1.2 },
    { kind: 'plant', x: 30, z: 7, h: 1.2 },
    { kind: 'bench', x: 16, z: 9, w: 2, h: 0.5 },
    { kind: 'bench', x: 26, z: 9, w: 2, h: 0.5 },
    { kind: 'kiosk', x: 24, z: 11, h: 1.5, face: [0, 1] },
    // B 生物实验室
    { kind: 'labbench', x: 4, z: 9, w: 3, h: 0.95 },
    { kind: 'labbench', x: 4, z: 13, w: 3, h: 0.95 },
    { kind: 'labbench', x: 4, z: 21, w: 3, h: 0.95 },
    { kind: 'hood', x: 8, z: 7, h: 2.2, face: [0, 1] },
    { kind: 'hood', x: 9, z: 7, h: 2.2, face: [0, 1] },
    { kind: 'cabinet', x: 11, z: 7, h: 1.9, face: [0, 1] },
    { kind: 'tank', x: 8, z: 11, h: 2.4 },
    { kind: 'tank', x: 8, z: 14, h: 2.4 },
    { kind: 'cabinet', x: 2, z: 24, h: 1.9, face: [1, 0] },
    // D 员工餐厅
    { kind: 'vending', x: 33, z: 7, h: 1.9, face: [0, 1] },
    { kind: 'vending', x: 34, z: 7, h: 1.9, face: [0, 1] },
    { kind: 'counter', x: 36, z: 7, w: 3, h: 1.05, face: [0, 1] },
    { kind: 'table', x: 36, z: 12, h: 0.75 },
    { kind: 'table', x: 39, z: 12, h: 0.75 },
    { kind: 'table', x: 36, z: 15, h: 0.75 },
    { kind: 'table', x: 39, z: 15, h: 0.75 },
    { kind: 'table', x: 37, z: 19, h: 0.75 },
    { kind: 'table', x: 39, z: 22, h: 0.75 },
    { kind: 'plant', x: 41, z: 24, h: 1.2 },
    // C 北廊
    { kind: 'locker', x: 11, z: 2, w: 4, h: 2.0, face: [0, 1] },
    { kind: 'locker', x: 28, z: 2, w: 4, h: 2.0, face: [0, 1] },
    { kind: 'case', x: 2, z: 2, w: 2, h: 0.9 },
    { kind: 'case', x: 40, z: 2, w: 2, h: 0.9 },
    { kind: 'case', x: 18, z: 5, h: 0.9 },
    // G 计算机房（二楼）
    { kind: 'rack', x: 3, z: 11, w: 4, h: 2.1, face: [0, 1], layer: 1 },
    { kind: 'rack', x: 3, z: 15, w: 4, h: 2.1, face: [0, -1], layer: 1 },
    { kind: 'rack', x: 3, z: 19, w: 4, h: 2.1, face: [0, 1], layer: 1 },
    { kind: 'desk', x: 8, z: 11, h: 0.76, face: [0, 1], layer: 1 },
    { kind: 'desk', x: 9, z: 11, h: 0.76, face: [0, 1], layer: 1 },
    { kind: 'case', x: 2, z: 24, w: 2, h: 0.9, layer: 1 },
    // H 办公区（二楼）
    { kind: 'desk', x: 36, z: 11, h: 0.76, face: [0, 1], layer: 1 },
    { kind: 'desk', x: 37, z: 11, h: 0.76, face: [0, 1], layer: 1 },
    { kind: 'desk', x: 39, z: 11, h: 0.76, face: [0, 1], layer: 1 },
    { kind: 'desk', x: 40, z: 11, h: 0.76, face: [0, 1], layer: 1 },
    { kind: 'desk', x: 36, z: 15, h: 0.76, face: [0, -1], layer: 1 },
    { kind: 'desk', x: 37, z: 15, h: 0.76, face: [0, -1], layer: 1 },
    { kind: 'desk', x: 39, z: 15, h: 0.76, face: [0, -1], layer: 1 },
    { kind: 'desk', x: 40, z: 15, h: 0.76, face: [0, -1], layer: 1 },
    { kind: 'desk', x: 38, z: 20, h: 0.76, face: [0, 1], layer: 1 },
    { kind: 'desk', x: 39, z: 20, h: 0.76, face: [0, 1], layer: 1 },
    { kind: 'cabinet', x: 41, z: 17, h: 1.9, face: [-1, 0], layer: 1 },
    { kind: 'cabinet', x: 41, z: 18, h: 1.9, face: [-1, 0], layer: 1 },
    { kind: 'plant', x: 36, z: 24, h: 1.2, layer: 1 },
    // 回廊
    { kind: 'plant', x: 13, z: 10, h: 1.2, layer: 1 },
    { kind: 'plant', x: 30, z: 10, h: 1.2, layer: 1 },
    { kind: 'plant', x: 13, z: 24, h: 1.2, layer: 1 },
    { kind: 'plant', x: 30, z: 24, h: 1.2, layer: 1 },
    // F 主任实验室（二楼）
    { kind: 'bigtank', x: 21, z: 3, w: 2, d: 2, h: 3.2, layer: 1 },
    { kind: 'console', x: 16, z: 6, w: 3, h: 1.0, face: [0, -1], layer: 1 },
    { kind: 'console', x: 25, z: 6, w: 3, h: 1.0, face: [0, -1], layer: 1 },
    { kind: 'cabinet', x: 13, z: 2, h: 1.9, face: [0, 1], layer: 1 },
    { kind: 'cabinet', x: 30, z: 2, h: 1.9, face: [0, 1], layer: 1 },
  ];
  for (const p of props) {
    for (let dz = 0; dz < (p.d ?? 1); dz++) for (let dx = 0; dx < (p.w ?? 1); dx++) set(p.layer ?? 0, p.x + dx, p.z + dz, T.CRATE);
  }

  const perks: PerkDef[] = [
    { perk: 'speed', x: 35, z: 7, face: [0, 1] },
    { perk: 'doubletap', x: 21, z: 2, face: [0, 1] },
    { perk: 'jugg', x: 29, z: 5, face: [-1, 0], layer: 1 },
  ];
  for (const p of perks) set(p.layer ?? 0, p.x, p.z, T.OBJECT);

  const box: BoxDef = { cells: [[2, 16], [2, 17]], face: [1, 0] };
  for (const [x, z] of box.cells) set(box.layer ?? 0, x, z, T.OBJECT);

  return {
    id: 'lab',
    name: '城市研究中心',
    theme: 'day',
    w: W,
    h: H,
    grid: g0,
    grid2: g1,
    storey: LAB_STOREY,
    doors,
    windows,
    perks,
    box,
    lamps: [],
    crates: [],
    stairs,
    props,
    start: { x: 22, z: 22.5, yaw: 0 },
  };
}
