import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { markBarricade } from '../fx/silhouettes';
import { T, type MapDef, type DoorDef, type Layer, type StairDef } from './map';
import * as TX from '../core/textures';
import { MinHeap, seeded, clamp } from '../core/util';
import type { Game } from '../game';
import type { Zombie } from '../entities/zombies';
import type { UpgradeId } from '../weapons/defs';
import { buildLabScene, labDoorMaterials, type LabScene } from './labScene';

export const WALL_H = 3;
export const DOOR_TOP = 2.4;
export const SILL = 0.9;
export const LINTEL = 2.1;
export const BOARDS = 6;
/** 二楼楼板厚度（一楼天花板在层高减去它） */
export const SLAB = 0.3;
/** 能直接迈上去的高度差 */
export const STEP_UP = 0.65;
/** 超过这个落差就不让走下去（楼梯侧面、回廊边缘） */
export const LEDGE = 0.9;
/** 寻路时相邻两格中心高度差的上限（楼梯每格升 0.6 米） */
const NAV_DH = 0.8;
/**
 * 路障材质档位：0 普通木板，1 厚木板，2 带铆钉厚木板，3 普通钢板，4 加厚钢板，5 带铆钉加厚钢板，
 * 6 带铁丝网的铆钉加厚钢板（第 5 档 + 铁丝网反伤）
 */
export const STEEL_TIER = 3;
export const WIRE_TIER = 6;
/** 各档板子的缩放：厚板更厚，钢板更宽 */
const BOARD_SCALE: [number, number, number][] = [
  [1, 1, 1],
  [1, 1.15, 2.0],
  [1, 1.15, 2.0],
  [1.02, 1.4, 1.0],
  [1.02, 1.45, 1.8],
  [1.02, 1.45, 1.8],
  [1.02, 1.45, 1.8],
];
/** 铁丝网反伤：丧尸每拉一下被扎掉的血量（固定值，越强的丧尸越扛得住） */
export const WIRE_DAMAGE = 20;
/** 电网：各级的充能间隔（秒）和每次电击伤害（固定值） */
export const SHOCK = [
  { period: 8, damage: 300 },
  { period: 5, damage: 800 },
];

export interface DoorRT {
  def: DoorDef;
  index: number;
  open: boolean;
  group: THREE.Group;
  anim: number;
  zones: number[];
  center: THREE.Vector3;
  layer: Layer;
  /** 门所在楼层的地面高度 */
  baseY: number;
}

export interface WindowRT {
  index: number;
  cx: number;
  cz: number;
  out: [number, number];
  zone: number;
  /** 所在楼层：二楼的窗户丧尸要先爬脚手架 */
  layer: Layer;
  floorY: number;
  /** 二楼窗户：脚手架梯子底下的地面点（一楼窗户就是 outside） */
  climbBase: THREE.Vector3;
  present: boolean[];
  boards: THREE.Mesh[];
  boardBase: { pos: THREE.Vector3; rot: number }[];
  /** 每块板剩余耐久（加固升级后要拉多次才掉） */
  hp: number[];
  /** 0 无动画，1 被拆飞出，2 修复飞回，3 被拽得晃动 */
  boardAnim: { t: number; mode: 0 | 1 | 2 | 3 }[];
  /** 电网充能 0..1 */
  charge: number;
  repairT: number;
  sparkT: number;
  /** 带铁丝网那档的铁丝网（未升级时为 null） */
  wire: THREE.Group | null;
  /** 升级材质时有丧尸正翻窗，等它翻进来再补满 */
  pendingRepair: boolean;
  group: THREE.Group;
  inside: THREE.Vector3;
  outside: THREE.Vector3;
  center: THREE.Vector3;
  occupant: object | null;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
}

const DIRS8: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** 按面法线生成带世界坐标 UV 的四边形，拼成一个大网格以减少 draw call */
export class GeoBuilder {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  quad(
    c: [number, number, number],
    nrm: [number, number, number],
    r: [number, number, number],
    u: [number, number, number],
    hw: number,
    hh: number,
    uS: number,
    vS: number,
  ) {
    const base = this.p.length / 3;
    for (const [sr, su] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = c[0] + r[0] * hw * sr + u[0] * hh * su;
      const y = c[1] + r[1] * hw * sr + u[1] * hh * su;
      const z = c[2] + r[2] * hw * sr + u[2] * hh * su;
      this.p.push(x, y, z);
      this.n.push(nrm[0], nrm[1], nrm[2]);
      this.uv.push((x * r[0] + y * r[1] + z * r[2]) / uS, (x * u[0] + y * u[1] + z * u[2]) / vS);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** dir: 0 +x, 1 -x, 2 +z, 3 -z, 4 +y, 5 -y */
  boxFace(dir: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uS = 4, vS = WALL_H) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const up: [number, number, number] = [0, 1, 0];
    switch (dir) {
      case 0: return this.quad([x1, cy, cz], [1, 0, 0], [0, 0, -1], up, (z1 - z0) / 2, (y1 - y0) / 2, uS, vS);
      case 1: return this.quad([x0, cy, cz], [-1, 0, 0], [0, 0, 1], up, (z1 - z0) / 2, (y1 - y0) / 2, uS, vS);
      case 2: return this.quad([cx, cy, z1], [0, 0, 1], [1, 0, 0], up, (x1 - x0) / 2, (y1 - y0) / 2, uS, vS);
      case 3: return this.quad([cx, cy, z0], [0, 0, -1], [-1, 0, 0], up, (x1 - x0) / 2, (y1 - y0) / 2, uS, vS);
      case 4: return this.quad([cx, y1, cz], [0, 1, 0], [1, 0, 0], [0, 0, -1], (x1 - x0) / 2, (z1 - z0) / 2, uS, uS);
      default: return this.quad([cx, y0, cz], [0, -1, 0], [1, 0, 0], [0, 0, 1], (x1 - x0) / 2, (z1 - z0) / 2, uS, uS);
    }
  }
  /** 整个盒子的 6 个面 */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uS = 1, vS = 1) {
    for (let d = 0; d < 6; d++) this.boxFace(d, x0, y0, z0, x1, y1, z1, uS, vS);
  }
  get empty() {
    return this.p.length === 0;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

interface StairRT extends StairDef {
  /** 沿上楼方向的格数 */
  len: number;
}

/**
 * 关卡：按格子（1 米）存的地图，最多两层。
 * 寻路 / 区域用“节点”编号：一楼格子 c 的节点是 c，二楼是 N + c；楼梯格只有一个节点（编号 c），高度按斜坡算。
 */
export class Level {
  readonly w: number;
  readonly h: number;
  /** 每层格子数 */
  readonly N: number;
  /** 层数（1 或 2） */
  readonly layers: number;
  readonly storey: number;
  /** grids[0] 一楼，grids[1] 二楼 */
  readonly grids: Uint8Array[];
  readonly grid: Uint8Array;
  /** 按节点存：箱子 / 家具 / 饮料机的高度 */
  readonly objH: Float32Array;
  readonly doorOf: Int16Array;
  readonly zoneOf: Int16Array;
  /** 按格子存：属于哪段楼梯（-1 不是楼梯） */
  readonly stairOf: Int16Array;
  /** 按格子存：楼梯格中心的地面高度 */
  readonly stairH: Float32Array;
  readonly stairs: StairRT[] = [];
  zoneCount = 0;
  zoneActive: boolean[] = [];
  startZone = 0;
  doors: DoorRT[] = [];
  windows: WindowRT[] = [];
  flow: Float32Array;
  /** 流场每重算一次加 1（丧尸据此重新记录自己的路径距离） */
  flowVersion = 0;
  private flowCell = -1;
  private heap = new MinHeap();
  private closed: Uint8Array;
  lamps: { light: THREE.PointLight; glow: THREE.Sprite; bulb: THREE.MeshBasicMaterial; base: number; flicker: boolean; ft: number; pos: THREE.Vector3 }[] = [];
  root = new THREE.Group();
  private boardMats: THREE.MeshStandardMaterial[] = [];
  /** 白天地图的场景（灯光、天空、阴影） */
  lab: LabScene | null = null;
  /** 路障升级等级（全局，对所有窗户生效） */
  upgrades: Record<UpgradeId, number> = { armor: 0, shock: 0, repair: 0 };

  constructor(private game: Game, readonly def: MapDef) {
    this.w = def.w;
    this.h = def.h;
    const n = this.w * this.h;
    this.N = n;
    this.layers = def.grid2 ? 2 : 1;
    this.storey = def.storey;
    this.grids = [def.grid.slice()];
    if (def.grid2) this.grids.push(def.grid2.slice());
    this.grid = this.grids[0];
    this.objH = new Float32Array(n * 2);
    this.doorOf = new Int16Array(n * 2).fill(-1);
    this.zoneOf = new Int16Array(n * 2).fill(-1);
    this.stairOf = new Int16Array(n).fill(-1);
    this.stairH = new Float32Array(n);
    this.flow = new Float32Array(n * 2).fill(Infinity);
    this.closed = new Uint8Array(n * 2);

    const node = (x: number, z: number, l = 0) => l * n + this.idx(x, z);
    for (const c of def.crates) this.objH[node(c.x, c.z, c.layer)] = c.h;
    for (const p of def.props ?? []) {
      for (let dz = 0; dz < (p.d ?? 1); dz++) for (let dx = 0; dx < (p.w ?? 1); dx++) this.objH[node(p.x + dx, p.z + dz, p.layer)] = p.h;
    }
    for (const p of def.perks) this.objH[node(p.x, p.z, p.layer)] = 2.2;
    for (const [x, z] of def.box.cells) this.objH[node(x, z, def.box.layer)] = 1.0;
    (def.stairs ?? []).forEach((s, k) => {
      const len = s.dir[0] ? s.x1 - s.x0 + 1 : s.z1 - s.z0 + 1;
      this.stairs.push({ ...s, len });
      for (let z = s.z0; z <= s.z1; z++) {
        for (let x = s.x0; x <= s.x1; x++) {
          const i = this.idx(x, z);
          this.stairOf[i] = k;
          this.stairH[i] = this.stairHeight(k, x + 0.5, z + 0.5);
        }
      }
    });

    this.computeZones();
    this.buildDoors();
    this.buildWindows();
    if (def.theme === 'day') {
      this.lab = buildLabScene(game, this);
    } else {
      this.buildStatic();
      this.buildLamps();
      this.buildOutside();
    }
    game.scene.add(this.root);
  }

  // ---------- 网格查询 ----------

  idx(x: number, z: number) {
    return z * this.w + x;
  }
  inBounds(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }
  typeAt(x: number, z: number, layer = 0) {
    return this.inBounds(x, z) && layer < this.layers ? this.grids[layer][this.idx(x, z)] : T.VOID;
  }
  /** 站在高度 y 的东西算哪一层 */
  layerAt(y: number): Layer {
    return this.layers > 1 && y >= this.storey * 0.5 ? 1 : 0;
  }

  /** 第 k 段楼梯在 (x, z) 处的斜坡高度 */
  stairHeight(k: number, x: number, z: number) {
    const s = this.stairs[k];
    let t: number;
    if (s.dir[0] > 0) t = (x - s.x0) / s.len;
    else if (s.dir[0] < 0) t = (s.x1 + 1 - x) / s.len;
    else if (s.dir[1] > 0) t = (z - s.z0) / s.len;
    else t = (s.z1 + 1 - z) / s.len;
    return this.storey * clamp(t, 0, 1);
  }

  /** 脚下地面高度：楼梯按斜坡，其余按所在楼层（refY 是当前脚下的高度，用来判断在哪层） */
  groundAt(x: number, z: number, refY: number) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (this.inBounds(cx, cz)) {
      const s = this.stairOf[this.idx(cx, cz)];
      if (s >= 0) return this.stairHeight(s, x, z);
    }
    return this.layerAt(refY) * this.storey;
  }

  /**
   * 格子 (cx, cz) 在点 (qx, qz) 处能不能走进去。越界 = 室外空地，不阻挡。
   * feetY：脚底高度（跳起来时更高，能迈上更高的台阶）；refY：脚下地面高度（决定在哪层、落差多大）。
   */
  private blockedAt(cx: number, cz: number, qx: number, qz: number, feetY: number, refY: number) {
    if (!this.inBounds(cx, cz)) return false;
    const i = this.idx(cx, cz);
    const s = this.stairOf[i];
    let h: number;
    if (s >= 0) h = this.stairHeight(s, qx, qz);
    else {
      const L = this.layerAt(refY);
      const t = this.grids[L][i];
      if (t === T.DOOR) {
        if (!this.doors[this.doorOf[L * this.N + i]].open) return true;
      } else if (t !== T.FLOOR && t !== T.VOID) return true;
      h = L * this.storey;
    }
    return h > feetY + STEP_UP || h < refY - LEDGE;
  }

  /** 室内寻路是否可通行（节点编号） */
  private navOk(n: number) {
    const L = n >= this.N ? 1 : 0;
    const t = this.grids[L][n - L * this.N];
    if (t === T.FLOOR) return true;
    if (t === T.DOOR) return this.doors[this.doorOf[n]].open;
    return false;
  }

  /** 格子 c 里和高度 h 连得上的可走节点，没有返回 -1 */
  private navNode(c: number, h: number) {
    if (this.stairOf[c] >= 0) return Math.abs(this.stairH[c] - h) <= NAV_DH ? c : -1;
    if (Math.abs(h) <= NAV_DH && this.navOk(c)) return c;
    if (this.layers > 1 && Math.abs(h - this.storey) <= NAV_DH && this.navOk(this.N + c)) return this.N + c;
    return -1;
  }

  /** 位置对应的节点（楼梯格不分层） */
  nodeAt(x: number, y: number, z: number) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (!this.inBounds(cx, cz)) return -1;
    const c = this.idx(cx, cz);
    if (this.stairOf[c] >= 0) return c;
    return this.layerAt(y) * this.N + c;
  }
  /** 节点中心的地面高度 */
  nodeH(n: number) {
    if (n >= this.N) return this.storey;
    return this.stairOf[n] >= 0 ? this.stairH[n] : 0;
  }
  nodeCell(n: number) {
    return n >= this.N ? n - this.N : n;
  }

  /** 半径 r 的圆有没有压到楼梯格 */
  touchesStair(x: number, z: number, r: number) {
    for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        if (this.inBounds(cx, cz) && this.stairOf[this.idx(cx, cz)] >= 0) return true;
      }
    }
    return false;
  }

  zoneAt(x: number, y: number, z: number) {
    const n = this.nodeAt(x, y, z);
    return n < 0 ? -1 : this.zoneOf[n];
  }

  /** 圆与网格的碰撞：把圆推出所有走不进去的格子 */
  collideCircle(p: { x: number; z: number }, r: number, feetY = 0, refY = feetY) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r);
      const z0 = Math.floor(p.z - r), z1 = Math.floor(p.z + r);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const qx = clamp(p.x, cx, cx + 1);
          const qz = clamp(p.z, cz, cz + 1);
          const dx = p.x - qx, dz = p.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (!this.blockedAt(cx, cz, qx, qz, feetY, refY)) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (r - d);
            p.z += (dz / d) * (r - d);
          } else {
            // 圆心陷进格子里：从最近的边推出去
            const l = p.x - cx, rr = cx + 1 - p.x, u = p.z - cz, b = cz + 1 - p.z;
            const m = Math.min(l, rr, u, b);
            if (m === l) p.x = cx - r;
            else if (m === rr) p.x = cx + 1 + r;
            else if (m === u) p.z = cz - r;
            else p.z = cz + 1 + r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  circleBlocked(x: number, z: number, r: number, feetY = 0, refY = feetY) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const z0 = Math.floor(z - r), z1 = Math.floor(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const qx = clamp(x, cx, cx + 1), qz = clamp(z, cz, cz + 1);
        if ((x - qx) ** 2 + (z - qz) ** 2 >= r * r) continue;
        if (this.blockedAt(cx, cz, qx, qz, feetY, refY)) return true;
      }
    }
    return false;
  }

  /**
   * 以半径 r 的圆从 a 走到 b 是否畅通：按真实地形一步步“走”过去（上下楼梯时高度跟着变），
   * 从高度 ya 出发，走到终点时的高度要和 yb 对得上（不会把楼上的点当成走得到的）。
   */
  segmentClear(ax: number, az: number, bx: number, bz: number, r: number, ya = 0, yb = ya) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    let y = ya;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (this.circleBlocked(x, z, r, y, y)) return false;
      y = this.groundAt(x, z, y);
    }
    return Math.abs(y - yb) < 0.6;
  }

  // ---------- 子弹射线（网格 DDA，考虑高度） ----------

  /** 一格里所有实心的高度区间（两层叠起来，含二楼楼板和楼梯） */
  private solidSpans(x: number, z: number, out: number[]): number {
    const i = this.idx(x, z);
    const S = this.storey;
    let n = 0;
    const push = (a: number, b: number) => {
      out[n * 2] = a;
      out[n * 2 + 1] = b;
      n++;
    };
    for (let L = 0; L < this.layers; L++) {
      const y0 = L * S, y1 = y0 + S;
      const t = this.grids[L][i];
      switch (t) {
        case T.WALL:
        case T.GLASS:
          push(y0, y1);
          break;
        case T.DOOR:
          if (this.doors[this.doorOf[L * this.N + i]].open) push(y0 + DOOR_TOP, y1);
          else push(y0, y1);
          break;
        case T.WINDOW:
          push(y0, y0 + SILL);
          push(y0 + LINTEL, y1);
          break;
        case T.CRATE:
        case T.OBJECT:
          push(y0, y0 + this.objH[L * this.N + i]);
          break;
        case T.STAIR:
          if (L === 0) push(0, this.stairH[i]);
          break;
      }
      // 二楼楼板（挑空、楼梯井、室外没有）
      if (L === 1 && t !== T.OPEN && t !== T.STAIR && t !== T.VOID) push(S - SLAB, S);
    }
    return n;
  }
  private spans = new Array(12).fill(0);

  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, out: RayHit): boolean {
    let cx = Math.floor(o.x), cz = Math.floor(o.z);
    const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
    const adx = Math.abs(d.x), adz = Math.abs(d.z);
    let tMaxX = adx > 1e-9 ? (d.x > 0 ? cx + 1 - o.x : o.x - cx) / adx : Infinity;
    let tMaxZ = adz > 1e-9 ? (d.z > 0 ? cz + 1 - o.z : o.z - cz) / adz : Infinity;
    const tdx = adx > 1e-9 ? 1 / adx : Infinity;
    const tdz = adz > 1e-9 ? 1 / adz : Infinity;
    const top = this.layers * this.storey;
    let tEnter = 0;
    let axis = -1;
    for (let guard = 0; guard < 512; guard++) {
      const tExit = Math.min(tMaxX, tMaxZ, maxDist);
      const inB = this.inBounds(cx, cz);
      const yIn = o.y + d.y * tEnter;
      const yOut = o.y + d.y * tExit;
      let best = Infinity;
      let bnx = 0, bny = 0, bnz = 0;
      if (inB) {
        const n = this.solidSpans(cx, cz, this.spans);
        for (let k = 0; k < n; k++) {
          const a = this.spans[k * 2], b = this.spans[k * 2 + 1];
          if (axis >= 0 && yIn >= a && yIn <= b) {
            if (tEnter < best) {
              best = tEnter;
              bnx = axis === 0 ? -stepX : 0; bny = 0; bnz = axis === 1 ? -stepZ : 0;
            }
          } else if (yIn > b && yOut < b) {
            const t = (b - o.y) / d.y;
            if (t < best) { best = t; bnx = 0; bny = 1; bnz = 0; }
          } else if (yIn < a && yOut > a) {
            const t = (a - o.y) / d.y;
            if (t < best) { best = t; bnx = 0; bny = -1; bnz = 0; }
          }
        }
        if (this.grid[this.idx(cx, cz)] !== T.VOID && yOut > top && yIn <= top) {
          const t = (top - o.y) / d.y;
          if (t < best) { best = t; bnx = 0; bny = -1; bnz = 0; }
        }
      }
      if (yIn > 0 && yOut <= 0) {
        const t = -o.y / d.y;
        if (t < best) { best = t; bnx = 0; bny = 1; bnz = 0; }
      }
      if (best < Infinity) {
        out.t = best; out.nx = bnx; out.ny = bny; out.nz = bnz;
        return true;
      }
      if (tExit >= maxDist) return false;
      if (!inB && axis >= 0) {
        // 已经出了建筑网格，外面只剩地面
        if (d.y < 0) {
          const t = -o.y / d.y;
          if (t < maxDist) {
            out.t = t; out.nx = 0; out.ny = 1; out.nz = 0;
            return true;
          }
        }
        return false;
      }
      if (tMaxX < tMaxZ) {
        cx += stepX; tEnter = tMaxX; tMaxX += tdx; axis = 0;
      } else {
        cz += stepZ; tEnter = tMaxZ; tMaxZ += tdz; axis = 1;
      }
    }
    return false;
  }

  // ---------- 流场寻路 ----------

  /** 以玩家所在节点为起点做 Dijkstra（py 是玩家脚下地面高度） */
  updateFlow(px: number, py: number, pz: number, force = false) {
    const start = this.nodeAt(px, py, pz);
    if (start < 0) return;
    if (!force && start === this.flowCell) return;
    if (this.stairOf[this.nodeCell(start)] < 0 && !this.navOk(start)) return;
    this.flowCell = start;
    this.flowVersion++;
    const flow = this.flow;
    flow.fill(Infinity);
    this.closed.fill(0);
    const heap = this.heap;
    heap.clear();
    flow[start] = 0;
    heap.push(0, start);
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur]) continue;
      this.closed[cur] = 1;
      const dc = flow[cur];
      this.forNeighbors(cur, (ni, cost) => {
        const nd = dc + cost;
        if (nd < flow[ni]) {
          flow[ni] = nd;
          heap.push(nd, ni);
        }
      });
    }
  }

  /** 节点的 8 个方向邻居（斜走不能切墙角；上下楼只能走楼梯） */
  private forNeighbors(n: number, fn: (ni: number, cost: number) => void) {
    const c = this.nodeCell(n);
    const x = c % this.w, z = (c / this.w) | 0;
    const h = this.nodeH(n);
    for (let k = 0; k < 8; k++) {
      const [dx, dz] = DIRS8[k];
      const nx = x + dx, nz = z + dz;
      if (!this.inBounds(nx, nz)) continue;
      const ni = this.navNode(this.idx(nx, nz), h);
      if (ni < 0) continue;
      if (k >= 4 && (this.navNode(this.idx(x + dx, z), h) < 0 || this.navNode(this.idx(x, z + dz), h) < 0)) continue;
      fn(ni, k >= 4 ? 1.4142 : 1);
    }
  }

  invalidateFlow() {
    this.flowCell = -1;
  }

  /** 流场里比当前节点更接近玩家的最佳相邻节点 */
  bestNeighbor(n: number): number {
    let best = -1;
    let bd = this.flow[n];
    this.forNeighbors(n, (ni) => {
      if (this.flow[ni] < bd) {
        bd = this.flow[ni];
        best = ni;
      }
    });
    return best;
  }

  // ---------- 区域 / 门 / 窗 ----------

  /** 格子 c 在高度 h 处属于房间的节点（地板、家具、饮料机、楼梯），没有返回 -1 */
  private roomNode(c: number, h: number) {
    const roomy = (t: number) => t === T.FLOOR || t === T.CRATE || t === T.OBJECT;
    if (this.stairOf[c] >= 0) return Math.abs(this.stairH[c] - h) <= NAV_DH ? c : -1;
    if (Math.abs(h) <= NAV_DH && roomy(this.grids[0][c])) return c;
    if (this.layers > 1 && Math.abs(h - this.storey) <= NAV_DH && roomy(this.grids[1][c])) return this.N + c;
    return -1;
  }

  private computeZones() {
    const { w, N } = this;
    let zone = 0;
    const stack: number[] = [];
    for (let n = 0; n < N * this.layers; n++) {
      const c = this.nodeCell(n);
      if (this.zoneOf[n] >= 0 || this.roomNode(c, n >= N ? this.storey : this.stairOf[c] >= 0 ? this.stairH[c] : 0) !== n) continue;
      stack.push(n);
      this.zoneOf[n] = zone;
      while (stack.length) {
        const cur = stack.pop()!;
        const cc = this.nodeCell(cur);
        const x = cc % w, z = (cc / w) | 0;
        const h = this.nodeH(cur);
        for (let k = 0; k < 4; k++) {
          const nx = x + DIRS8[k][0], nz = z + DIRS8[k][1];
          if (!this.inBounds(nx, nz)) continue;
          const ni = this.roomNode(this.idx(nx, nz), h);
          if (ni >= 0 && this.zoneOf[ni] < 0) {
            this.zoneOf[ni] = zone;
            stack.push(ni);
          }
        }
      }
      zone++;
    }
    this.zoneCount = zone;
    this.zoneActive = new Array(zone).fill(false);
    this.startZone = this.zoneOf[this.nodeAt(this.def.start.x, 0, this.def.start.z)];
    this.zoneActive[this.startZone] = true;
  }

  private buildDoors() {
    const day = this.def.theme === 'day';
    const [mat, sideMat] = day
      ? labDoorMaterials()
      : [
          new THREE.MeshStandardMaterial({ map: TX.doorTexture(), roughness: 0.85 }),
          new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }),
        ];
    this.def.doors.forEach((def, index) => {
      const layer: Layer = def.layer ?? 0;
      const baseY = layer * this.storey;
      const alongX = def.cells[0][0] !== def.cells[def.cells.length - 1][0];
      const zones = new Set<number>();
      let sx = 0, sz = 0;
      for (const [x, z] of def.cells) {
        this.doorOf[layer * this.N + this.idx(x, z)] = index;
        sx += x + 0.5;
        sz += z + 0.5;
        const a = alongX ? this.idx(x, z - 1) : this.idx(x - 1, z);
        const b = alongX ? this.idx(x, z + 1) : this.idx(x + 1, z);
        for (const c of [a, b]) {
          const n = this.roomNode(c, baseY);
          if (n >= 0 && this.zoneOf[n] >= 0) zones.add(this.zoneOf[n]);
        }
      }
      const center = new THREE.Vector3(sx / def.cells.length, baseY, sz / def.cells.length);
      const group = new THREE.Group();
      group.position.copy(center);
      if (!alongX) group.rotation.y = Math.PI / 2;
      const n = def.cells.length;
      for (let k = 0; k < n; k++) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.98, DOOR_TOP - 0.02, 0.2), [sideMat, sideMat, sideMat, sideMat, mat, mat]);
        leaf.position.set(k - (n - 1) / 2, DOOR_TOP / 2, 0);
        if (k % 2 === 1) leaf.scale.x = -1;
        if (day) leaf.castShadow = leaf.receiveShadow = true;
        group.add(leaf);
      }
      this.root.add(group);
      this.doors.push({ def, index, open: false, group, anim: 0, zones: [...zones], center, layer, baseY });
    });
  }

  openDoor(d: DoorRT) {
    if (d.open) return;
    d.open = true;
    d.anim = 0.0001;
    for (const z of d.zones) this.zoneActive[z] = true;
    this.invalidateFlow();
    this.game.audio.doorOpen(new THREE.Vector3(d.center.x, d.baseY + 1.5, d.center.z));
  }

  private buildWindows() {
    this.boardMats = [
      new THREE.MeshStandardMaterial({ map: TX.plankTexture(0), roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: TX.plankTexture(1), roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: TX.plankTexture(2), roughness: 0.75, metalness: 0.2 }),
      new THREE.MeshStandardMaterial({ map: TX.plankTexture(3), color: 0xb4c2d8, roughness: 0.5, metalness: 0.35 }),
      new THREE.MeshStandardMaterial({ map: TX.plankTexture(4), color: 0xa8b6cc, roughness: 0.5, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: TX.plankTexture(5), color: 0xa8b6cc, roughness: 0.45, metalness: 0.45 }),
    ];
    // 路障写模板缓冲：挡在后面的丧尸会画出透视轮廓
    for (const m of this.boardMats) markBarricade(m);
    markBarricade(this.wireMat);
    const day = this.def.theme === 'day';
    const boardGeo = new THREE.BoxGeometry(1.25, 0.15, 0.035);
    const diagGeo = new THREE.BoxGeometry(1.45, 0.15, 0.035);
    const layout: [number, number, boolean][] = [
      [-0.45, 0.06, false],
      [-0.25, -0.1, false],
      [-0.02, 0.62, true],
      [0.02, -0.62, true],
      [0.28, 0.08, false],
      [0.46, -0.05, false],
    ];
    this.def.windows.forEach(([cx, cz, l], index) => {
      const layer: Layer = l ?? 0;
      const floorY = layer * this.storey;
      let out: [number, number] = [0, 1];
      for (const [dx, dz] of DIRS8.slice(0, 4)) {
        if (this.typeAt(cx + dx, cz + dz, layer) === T.VOID) out = [dx, dz];
      }
      const center = new THREE.Vector3(cx + 0.5, floorY, cz + 0.5);
      const inside = new THREE.Vector3(center.x - out[0] * 1.0, floorY, center.z - out[1] * 1.0);
      const outside = new THREE.Vector3(center.x + out[0] * 1.05, floorY, center.z + out[1] * 1.05);
      const climbBase = layer ? new THREE.Vector3(center.x + out[0] * 1.95, 0, center.z + out[1] * 1.95) : outside.clone();
      const zn = this.roomNode(this.idx(cx - out[0], cz - out[1]), floorY);
      const zone = zn >= 0 ? this.zoneOf[zn] : -1;
      const group = new THREE.Group();
      group.position.set(center.x - out[0] * 0.53, floorY + (SILL + LINTEL) / 2, center.z - out[1] * 0.53);
      group.rotation.y = Math.atan2(-out[0], -out[1]);
      const boards: THREE.Mesh[] = [];
      const boardBase: { pos: THREE.Vector3; rot: number }[] = [];
      layout.forEach(([y, rot, diag], k) => {
        const m = new THREE.Mesh(diag ? diagGeo : boardGeo, this.boardMats[0]);
        const pos = new THREE.Vector3((k % 2 ? 1 : -1) * 0.02, y, 0.012 * k);
        m.position.copy(pos);
        m.rotation.z = rot;
        if (day) m.castShadow = m.receiveShadow = true;
        group.add(m);
        boards.push(m);
        boardBase.push({ pos, rot });
      });
      this.root.add(group);
      this.windows.push({
        index, cx, cz, out, zone, layer, floorY, climbBase,
        present: new Array(BOARDS).fill(true),
        boards, boardBase,
        hp: new Array(BOARDS).fill(1),
        boardAnim: boards.map(() => ({ t: 0, mode: 0 as 0 | 1 | 2 | 3 })),
        charge: 0,
        repairT: 0,
        sparkT: Math.random(),
        wire: null,
        pendingRepair: false,
        group, inside, outside, center, occupant: null,
      });
    });
  }

  boardCount(w: WindowRT) {
    let n = 0;
    for (const p of w.present) if (p) n++;
    return n;
  }

  /** 每档多拉一下，铁丝网那档耐久和带铆钉钢板一样，多的是反伤 */
  get boardMaxHp() {
    return Math.min(this.upgrades.armor, WIRE_TIER - 1) + 1;
  }

  private boardPos(w: WindowRT) {
    return new THREE.Vector3(w.center.x - w.out[0] * 0.5, w.floorY + 1.5, w.center.z - w.out[1] * 0.5);
  }

  /**
   * 丧尸拽一次路障。电网充好电时先电它；否则随机一块板掉一点耐久，耐久归零就被拆掉。
   * 返回 true 表示丧尸被电死了。
   */
  pullBoard(w: WindowRT, z: Zombie): boolean {
    const g = this.game;
    const p = this.boardPos(w);
    if (this.upgrades.shock > 0 && w.charge >= 1) {
      w.charge = 0;
      g.lightning.bolt(p, new THREE.Vector3(z.pos.x, z.pos.y + 1.3, z.pos.z));
      g.particles.sparks(p, 0x7fc8ff);
      g.audio.shockZap(p);
      z.stun(0.8);
      if (g.zombies.damage(z, SHOCK[Math.min(this.upgrades.shock, SHOCK.length) - 1].damage, 'torso', 'trap')) return true;
    }
    // 铁丝网反伤：每拉一下都被扎
    if (this.upgrades.armor >= WIRE_TIER && this.boardCount(w) > 0) {
      const hand = new THREE.Vector3(z.pos.x, z.pos.y + 1.25, z.pos.z).lerp(p, 0.5);
      g.particles.blood(hand, new THREE.Vector3(w.out[0], 0.4, w.out[1]), 6, 0.8);
      g.audio.wireScrape(hand);
      const dir = new THREE.Vector3(w.out[0], 0, w.out[1]);
      if (g.zombies.damage(z, WIRE_DAMAGE, 'torso', 'trap', dir, { point: hand })) return true;
    }
    const idxs = w.present.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return false;
    const i = idxs[Math.floor(Math.random() * idxs.length)];
    w.hp[i]--;
    if (w.hp[i] > 0) {
      w.boardAnim[i] = { t: 0, mode: 3 };
      g.audio.boardRattle(p, this.upgrades.armor >= STEEL_TIER);
      return false;
    }
    w.present[i] = false;
    w.boardAnim[i] = { t: 0, mode: 1 };
    if (this.upgrades.armor >= STEEL_TIER) {
      g.audio.boardRattle(p, true);
      g.particles.sparks(p, 0xffc070);
    } else {
      g.audio.woodBreak(p);
      g.particles.wood(p);
    }
    return false;
  }

  /** 是否有缺的板或受损的板 */
  needsRepair(w: WindowRT) {
    const max = this.boardMaxHp;
    for (let i = 0; i < BOARDS; i++) if (!w.present[i] || w.hp[i] < max) return true;
    return false;
  }

  /** 修一次：优先补上缺的板，没缺的就把受损的板加固回满耐久 */
  repairBoard(w: WindowRT, silent = false) {
    const max = this.boardMaxHp;
    let i = w.present.indexOf(false);
    if (i >= 0) {
      w.present[i] = true;
      w.hp[i] = max;
      w.boardAnim[i] = { t: 0, mode: 2 };
      w.boards[i].visible = true;
    } else {
      i = w.hp.findIndex((h) => h < max);
      if (i < 0) return false;
      w.hp[i] = max;
      w.boardAnim[i] = { t: 0, mode: 3 };
    }
    if (!silent) this.game.audio.hammer(new THREE.Vector3(w.center.x, w.floorY + 1.5, w.center.z));
    return true;
  }

  /** 木匠道具：所有窗户瞬间修满 */
  repairAll() {
    for (const w of this.windows) if (!w.occupant) this.refillWindow(w);
  }

  /** 把一扇窗的板子一次补满（缺的板飞回来，受损的回满耐久） */
  private refillWindow(w: WindowRT) {
    w.pendingRepair = false;
    while (this.repairBoard(w, true));
  }

  setUpgrade(id: UpgradeId, level: number) {
    this.upgrades[id] = level;
    if (id === 'armor') {
      const mat = this.boardMats[Math.min(level, this.boardMats.length - 1)];
      const sc = BOARD_SCALE[Math.min(level, BOARD_SCALE.length - 1)];
      for (const w of this.windows) {
        for (let i = 0; i < BOARDS; i++) {
          w.boards[i].material = mat;
          w.boards[i].scale.set(...sc);
        }
        if (level >= WIRE_TIER && !w.wire) {
          w.wire = this.buildWire();
          w.group.add(w.wire);
        }
        // 换材质的同时把所有窗户按新材质补满
        if (w.occupant) w.pendingRepair = true;
        else this.refillWindow(w);
      }
    }
    if (id === 'shock') for (const w of this.windows) w.charge = 1;
  }

  // ---------- 静态几何 ----------

  private buildStatic() {
    const { w, h } = this;
    const walls = new GeoBuilder();
    const floor = new GeoBuilder();
    const ceil = new GeoBuilder();
    const beams = new GeoBuilder();
    const nb: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 1], [0, 1, 2], [0, -1, 3],
    ];
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const t = this.grid[this.idx(x, z)];
        if (t === T.VOID) continue;
        if (t === T.WALL) {
          for (const [dx, dz, dir] of nb) {
            if (this.typeAt(x + dx, z + dz) !== T.WALL) walls.boxFace(dir, x, 0, z, x + 1, WALL_H, z + 1);
          }
          continue;
        }
        if (t === T.WINDOW) {
          for (const [dx, dz, dir] of nb) {
            if (this.typeAt(x + dx, z + dz) === T.WALL) continue;
            walls.boxFace(dir, x, 0, z, x + 1, SILL, z + 1);
            walls.boxFace(dir, x, LINTEL, z, x + 1, WALL_H, z + 1);
          }
          walls.boxFace(4, x, 0, z, x + 1, SILL, z + 1);
          walls.boxFace(5, x, LINTEL, z, x + 1, WALL_H, z + 1);
          continue;
        }
        if (t === T.DOOR) {
          for (const [dx, dz, dir] of nb) {
            const nt = this.typeAt(x + dx, z + dz);
            if (nt === T.WALL || nt === T.DOOR) continue;
            walls.boxFace(dir, x, DOOR_TOP, z, x + 1, WALL_H, z + 1);
          }
          walls.boxFace(5, x, DOOR_TOP, z, x + 1, WALL_H, z + 1);
        }
        floor.boxFace(4, x, 0, z, x + 1, 0, z + 1, 2);
        if (t !== T.DOOR) ceil.boxFace(5, x, WALL_H, z, x + 1, WALL_H, z + 1, 2);
        // 天花板横梁
        if (z % 4 === 2 && t !== T.DOOR) {
          beams.boxFace(5, x, 2.78, z + 0.35, x + 1, WALL_H, z + 0.65, 1, 1);
          beams.boxFace(2, x, 2.78, z + 0.35, x + 1, WALL_H, z + 0.65, 1, 1);
          beams.boxFace(3, x, 2.78, z + 0.35, x + 1, WALL_H, z + 0.65, 1, 1);
        }
      }
    }
    const wallTex = TX.wallTexture();
    const floorTex = TX.floorTexture();
    const ceilTex = TX.floorTexture(true);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 1.2, roughness: 0.93 });
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.8, roughness: 0.78 });
    const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, color: 0x807870, roughness: 0.95 });
    const beamMat = new THREE.MeshStandardMaterial({ map: ceilTex, color: 0x6a5a4a, roughness: 0.9 });
    this.root.add(new THREE.Mesh(walls.build(), wallMat));
    this.root.add(new THREE.Mesh(floor.build(), floorMat));
    this.root.add(new THREE.Mesh(ceil.build(), ceilMat));
    this.root.add(new THREE.Mesh(beams.build(), beamMat));

    // 木箱
    const crateMat = new THREE.MeshStandardMaterial({ map: TX.crateTexture(), roughness: 0.85 });
    const crateGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    let count = 0;
    for (const c of this.def.crates) count += c.h > 1 ? 2 : 1;
    const crates = new THREE.InstancedMesh(crateGeo, crateMat, count);
    const r = seeded(77);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    let k = 0;
    for (const c of this.def.crates) {
      const layers = c.h > 1 ? 2 : 1;
      for (let l = 0; l < layers; l++) {
        e.set(0, (r() - 0.5) * (l ? 0.35 : 0.12), 0);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(c.x + 0.5, 0.45 + l * 0.9, c.z + 0.5), q, new THREE.Vector3(1, 1, 1));
        crates.setMatrixAt(k++, m4);
      }
    }
    this.root.add(crates);

    // 地板上的血迹
    const splatMats = [1, 2, 3].map(
      (s) =>
        new THREE.MeshStandardMaterial({
          map: TX.bloodSplatTexture(s * 31),
          transparent: true,
          depthWrite: false,
          roughness: 0.75,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
    );
    const splatGeo = new THREE.PlaneGeometry(1, 1);
    splatGeo.rotateX(-Math.PI / 2);
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 26; tries++) {
      const x = Math.floor(r() * w), z = Math.floor(r() * h);
      if (this.grid[this.idx(x, z)] !== T.FLOOR) continue;
      const m = new THREE.Mesh(splatGeo, splatMats[placed % 3]);
      const s = 0.6 + r() * 1.1;
      m.scale.set(s, 1, s * (0.7 + r() * 0.6));
      m.rotation.y = r() * Math.PI * 2;
      m.position.set(x + r(), 0.004 + placed * 0.0003, z + r());
      this.root.add(m);
      placed++;
    }
  }

  private buildLamps() {
    const glowTex = TX.glowTexture();
    const shadeGeo = new THREE.ConeGeometry(0.24, 0.16, 16, 1, true);
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0x2c3a2c, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
    const cordGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.36);
    const cordMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const bulbGeo = new THREE.SphereGeometry(0.06, 12, 8);
    for (const l of this.def.lamps) {
      const pos = new THREE.Vector3(l.x, 2.42, l.z);
      const light = new THREE.PointLight(0xffb46a, 9, 17, 1.5);
      light.position.copy(pos);
      this.root.add(light);
      const bulb = new THREE.MeshBasicMaterial({ color: 0xffe2b0 });
      const bm = new THREE.Mesh(bulbGeo, bulb);
      bm.position.copy(pos);
      this.root.add(bm);
      const shade = new THREE.Mesh(shadeGeo, shadeMat);
      shade.position.set(l.x, 2.55, l.z);
      this.root.add(shade);
      const cord = new THREE.Mesh(cordGeo, cordMat);
      cord.position.set(l.x, 2.8, l.z);
      this.root.add(cord);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: 0xffb060, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glow.scale.setScalar(0.9);
      glow.position.copy(pos);
      this.root.add(glow);
      this.lamps.push({ light, glow, bulb, base: light.intensity, flicker: !!l.flicker, ft: 0, pos });
    }
  }

  private buildOutside() {
    const groundTex = TX.groundTexture();
    groundTex.repeat.set(30, 30);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ map: groundTex, color: 0x8a92a8, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.w / 2, -0.02, this.h / 2);
    this.root.add(ground);

    // 枯树
    const parts: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CylinderGeometry(0.12, 0.28, 7, 7);
    trunk.translate(0, 3.5, 0);
    parts.push(trunk);
    const branch = (len: number, y: number, rz: number, ry: number) => {
      const b = new THREE.CylinderGeometry(0.03, 0.09, len, 5);
      b.translate(0, len / 2, 0);
      b.rotateZ(rz);
      b.rotateY(ry);
      b.translate(0, y, 0);
      parts.push(b);
    };
    branch(2.6, 4.2, 0.9, 0);
    branch(2.2, 5.0, -0.8, 1.2);
    branch(1.8, 5.8, 0.7, 2.6);
    branch(2.4, 3.4, -1.0, 4.0);
    branch(1.5, 6.4, 0.5, 5.0);
    const treeGeo = mergeGeometries(parts)!;
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2a241e, roughness: 1 });
    const n = 70;
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, n);
    const r = seeded(99);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const cx = this.w / 2, cz = this.h / 2;
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0;
      for (let t = 0; t < 20; t++) {
        const a = r() * Math.PI * 2;
        const d = 34 + r() * 40;
        x = cx + Math.cos(a) * d * 1.1;
        z = cz + Math.sin(a) * d * 0.9;
        // 离建筑至少 12 米，留出丧尸出生通道
        if (x < -12 || x > this.w + 12 || z < -12 || z > this.h + 12) break;
      }
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.15, r() * 6.28, (r() - 0.5) * 0.15));
      const s = 0.7 + r() * 0.7;
      m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
      trees.setMatrixAt(i, m4);
    }
    this.root.add(trees);

    const moon = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: TX.moonTexture(), fog: false, depthWrite: false, transparent: true }),
    );
    moon.scale.setScalar(26);
    moon.position.set(cx + 110, 48, cz - 120);
    this.root.add(moon);
  }

  // ---------- 每帧 ----------

  update(dt: number) {
    // 门和木板在动时，白天地图要重画阴影
    let moving = false;
    for (const d of this.doors) {
      if (d.anim <= 0 || !d.group.visible) continue;
      moving = true;
      d.anim += dt;
      const t = Math.min(1, d.anim / 1.1);
      d.group.position.y = d.baseY + t * t * (DOOR_TOP + 0.3);
      if (t >= 1) d.group.visible = false;
    }
    for (const w of this.windows) {
      for (let i = 0; i < BOARDS; i++) {
        const a = w.boardAnim[i];
        if (a.mode === 0) continue;
        moving = true;
        const b = w.boards[i];
        const base = w.boardBase[i];
        if (a.mode === 1) {
          a.t += dt / 0.6;
          const t = Math.min(1, a.t);
          b.position.set(base.pos.x + t * 0.3, base.pos.y - 1.6 * t * t, base.pos.z - 1.5 * t);
          b.rotation.set(t * 1.5, 0, base.rot + t * 2.2);
          if (t >= 1) {
            b.visible = false;
            a.mode = 0;
          }
        } else if (a.mode === 2) {
          a.t += dt / 0.3;
          const t = Math.min(1, a.t);
          const s = 1 - t;
          b.position.set(base.pos.x + 0.3 * s, base.pos.y - 0.9 * s, base.pos.z + 1.0 * s);
          b.rotation.set(0, 0, base.rot + 1.2 * s);
          if (t >= 1) a.mode = 0;
        } else {
          // 被拽了一下但没掉：往外一扯再弹回
          a.t += dt / 0.3;
          const t = Math.min(1, a.t);
          const s = Math.sin(t * Math.PI) * (1 - t * 0.5);
          b.position.set(base.pos.x, base.pos.y, base.pos.z - 0.12 * s);
          b.rotation.set(0.25 * s, 0, base.rot + Math.sin(t * 25) * 0.05 * (1 - t));
          if (t >= 1) {
            a.mode = 0;
            b.position.copy(base.pos);
            b.rotation.set(0, 0, base.rot);
          }
        }
      }
      this.updateWindowUpgrades(w, dt);
    }
    if (this.lab) this.lab.update(dt, moving);
    for (const l of this.lamps) {
      if (!l.flicker) continue;
      l.ft -= dt;
      if (l.ft <= 0) {
        const off = Math.random() < 0.35;
        const k = off ? 0.05 + Math.random() * 0.25 : 0.8 + Math.random() * 0.25;
        l.light.intensity = l.base * k;
        l.glow.material.opacity = 0.55 * k;
        l.bulb.color.setScalar(0.25 + 0.75 * k).multiply(new THREE.Color(0xffe2b0));
        l.ft = off ? 0.04 + Math.random() * 0.1 : 0.1 + Math.random() * 1.2;
      }
    }
  }

  private wireGeo: THREE.BufferGeometry | null = null;
  private wireMat = new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.45, metalness: 0.35 });

  /** 两卷带刺的蛇腹形铁丝网，横挂在钢板内侧 */
  private buildWire() {
    if (!this.wireGeo) {
      const turns = 12, n = 260, r = 0.11, L = 1.28;
      const helix = (t: number) => {
        const a = t * turns * Math.PI * 2;
        return new THREE.Vector3(-L / 2 + t * L, Math.cos(a) * r, Math.sin(a) * r * 0.7);
      };
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) pts.push(helix(i / n));
      const parts: THREE.BufferGeometry[] = [new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.0055, 4, false)];
      // 倒刺：沿铁丝每隔一段放一个小“X”
      const barbs = turns * 4;
      for (let k = 0; k < barbs; k++) {
        const p = helix((k + 0.5) / barbs);
        for (const rz of [Math.PI / 4, -Math.PI / 4]) {
          const b = new THREE.BoxGeometry(0.05, 0.006, 0.006);
          b.rotateZ(rz);
          b.rotateY((k % 3) * 0.7);
          b.translate(p.x, p.y, p.z);
          parts.push(b);
        }
      }
      this.wireGeo = mergeGeometries(parts)!;
    }
    const g = new THREE.Group();
    for (const y of [0.32, -0.3]) {
      const m = new THREE.Mesh(this.wireGeo, this.wireMat);
      m.position.set(0, y, 0.11);
      m.rotation.x = y > 0 ? 0.3 : -0.2;
      g.add(m);
    }
    return g;
  }

  private updateWindowUpgrades(w: WindowRT, dt: number) {
    const u = this.upgrades;
    if (w.pendingRepair && !w.occupant) this.refillWindow(w);
    if (w.wire) w.wire.visible = u.armor >= WIRE_TIER && this.boardCount(w) > 0;
    if (u.shock > 0) {
      const period = SHOCK[Math.min(u.shock, SHOCK.length) - 1].period;
      w.charge = Math.min(1, w.charge + dt / period);
      // 充满电时窗户上偶尔冒电火花
      if (w.charge >= 1 && this.boardCount(w) > 0) {
        w.sparkT -= dt;
        if (w.sparkT <= 0) {
          w.sparkT = 0.6 + Math.random() * 1.6;
          const p = this.boardPos(w);
          p.x += (Math.random() - 0.5) * 0.8 * Math.abs(w.out[1]);
          p.z += (Math.random() - 0.5) * 0.8 * Math.abs(w.out[0]);
          p.y += (Math.random() - 0.5) * 0.9;
          this.game.particles.sparks(p, 0x7fc8ff);
        }
      }
    }
    if (u.repair > 0 && !w.occupant) {
      const period = u.repair >= 2 ? 6 : 12;
      if (this.needsRepair(w)) {
        w.repairT += dt;
        if (w.repairT >= period) {
          w.repairT = 0;
          this.repairBoard(w, true);
        }
      } else w.repairT = 0;
    }
  }

  /** 位置处的大致亮度（0..1），用来给第一人称枪模调光 */
  lightLevelAt(p: THREE.Vector3) {
    if (this.lab) return this.lab.lightLevelAt(p);
    let s = 0;
    for (const l of this.lamps) {
      const d2 = (l.pos.x - p.x) ** 2 + (l.pos.z - p.z) ** 2;
      s += (l.light.intensity / l.base) / (1 + d2 / 10);
    }
    return clamp(0.25 + s * 0.8, 0.25, 1.2);
  }
}
