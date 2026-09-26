import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { markBarricade } from '../fx/silhouettes';
import { T, type MapDef, type DoorDef } from './map';
import * as TX from '../core/textures';
import { MinHeap, seeded, clamp } from '../core/util';
import type { Game } from '../game';
import type { Zombie } from '../entities/zombies';
import type { UpgradeId } from '../weapons/defs';

export const WALL_H = 3;
export const DOOR_TOP = 2.4;
export const SILL = 0.9;
export const LINTEL = 2.1;
export const BOARDS = 6;
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
}

export interface WindowRT {
  index: number;
  cx: number;
  cz: number;
  out: [number, number];
  zone: number;
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
class GeoBuilder {
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

export class Level {
  readonly w: number;
  readonly h: number;
  readonly grid: Uint8Array;
  readonly objH: Float32Array;
  readonly doorOf: Int16Array;
  readonly zoneOf: Int16Array;
  zoneCount = 0;
  zoneActive: boolean[] = [];
  startZone = 0;
  doors: DoorRT[] = [];
  windows: WindowRT[] = [];
  flow: Float32Array;
  private flowCell = -1;
  private heap = new MinHeap();
  private closed: Uint8Array;
  lamps: { light: THREE.PointLight; glow: THREE.Sprite; bulb: THREE.MeshBasicMaterial; base: number; flicker: boolean; ft: number; pos: THREE.Vector3 }[] = [];
  root = new THREE.Group();
  private boardMats: THREE.MeshStandardMaterial[] = [];
  /** 路障升级等级（全局，对所有窗户生效） */
  upgrades: Record<UpgradeId, number> = { armor: 0, shock: 0, repair: 0 };

  constructor(private game: Game, readonly def: MapDef) {
    this.w = def.w;
    this.h = def.h;
    const n = this.w * this.h;
    this.grid = def.grid.slice();
    this.objH = new Float32Array(n);
    this.doorOf = new Int16Array(n).fill(-1);
    this.zoneOf = new Int16Array(n).fill(-1);
    this.flow = new Float32Array(n).fill(Infinity);
    this.closed = new Uint8Array(n);

    for (const c of def.crates) this.objH[this.idx(c.x, c.z)] = c.h;
    for (const p of def.perks) this.objH[this.idx(p.x, p.z)] = 2.2;
    for (const [x, z] of def.box.cells) this.objH[this.idx(x, z)] = 1.0;

    this.computeZones();
    this.buildDoors();
    this.buildWindows();
    this.buildStatic();
    this.buildLamps();
    this.buildOutside();
    game.scene.add(this.root);
  }

  // ---------- 网格查询 ----------

  idx(x: number, z: number) {
    return z * this.w + x;
  }
  inBounds(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }
  typeAt(x: number, z: number) {
    return this.inBounds(x, z) ? this.grid[this.idx(x, z)] : T.VOID;
  }

  /** 移动是否被阻挡（玩家和丧尸共用）。越界 = 室外空地，不阻挡 */
  isBlocked(x: number, z: number) {
    if (!this.inBounds(x, z)) return false;
    const i = this.idx(x, z);
    const t = this.grid[i];
    if (t === T.FLOOR || t === T.VOID) return false;
    if (t === T.DOOR) return !this.doors[this.doorOf[i]].open;
    return true;
  }

  /** 室内寻路是否可通行 */
  private navOk(i: number) {
    const t = this.grid[i];
    if (t === T.FLOOR) return true;
    if (t === T.DOOR) return this.doors[this.doorOf[i]].open;
    return false;
  }

  zoneAt(x: number, z: number) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (!this.inBounds(cx, cz)) return -1;
    return this.zoneOf[this.idx(cx, cz)];
  }

  /** 圆与网格的碰撞：把圆推出所有重叠的实心格子 */
  collideCircle(p: { x: number; z: number }, r: number) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r);
      const z0 = Math.floor(p.z - r), z1 = Math.floor(p.z + r);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (!this.isBlocked(cx, cz)) continue;
          const qx = clamp(p.x, cx, cx + 1);
          const qz = clamp(p.z, cz, cz + 1);
          const dx = p.x - qx, dz = p.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
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

  circleBlocked(x: number, z: number, r: number) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const z0 = Math.floor(z - r), z1 = Math.floor(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.isBlocked(cx, cz)) continue;
        const qx = clamp(x, cx, cx + 1), qz = clamp(z, cz, cz + 1);
        if ((x - qx) ** 2 + (z - qz) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  /** 以半径 r 的圆扫过线段是否畅通 */
  segmentClear(ax: number, az: number, bx: number, bz: number, r: number) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.circleBlocked(ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
    }
    return true;
  }

  // ---------- 子弹射线（网格 DDA，考虑高度） ----------

  private solidSpans(x: number, z: number, out: number[]): number {
    const i = this.idx(x, z);
    const t = this.grid[i];
    switch (t) {
      case T.WALL:
        out[0] = 0; out[1] = WALL_H;
        return 1;
      case T.DOOR:
        if (this.doors[this.doorOf[i]].open) {
          out[0] = DOOR_TOP; out[1] = WALL_H;
        } else {
          out[0] = 0; out[1] = WALL_H;
        }
        return 1;
      case T.WINDOW:
        out[0] = 0; out[1] = SILL; out[2] = LINTEL; out[3] = WALL_H;
        return 2;
      case T.CRATE:
      case T.OBJECT:
        out[0] = 0; out[1] = this.objH[i];
        return 1;
      default:
        return 0;
    }
  }
  private spans = [0, 0, 0, 0];

  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, out: RayHit): boolean {
    let cx = Math.floor(o.x), cz = Math.floor(o.z);
    const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
    const adx = Math.abs(d.x), adz = Math.abs(d.z);
    let tMaxX = adx > 1e-9 ? (d.x > 0 ? cx + 1 - o.x : o.x - cx) / adx : Infinity;
    let tMaxZ = adz > 1e-9 ? (d.z > 0 ? cz + 1 - o.z : o.z - cz) / adz : Infinity;
    const tdx = adx > 1e-9 ? 1 / adx : Infinity;
    const tdz = adz > 1e-9 ? 1 / adz : Infinity;
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
        if (this.grid[this.idx(cx, cz)] !== T.VOID && yOut > WALL_H && yIn <= WALL_H) {
          const t = (WALL_H - o.y) / d.y;
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

  updateFlow(px: number, pz: number, force = false) {
    const cx = Math.floor(px), cz = Math.floor(pz);
    if (!this.inBounds(cx, cz)) return;
    const c = this.idx(cx, cz);
    if (!force && c === this.flowCell) return;
    if (!this.navOk(c)) return;
    this.flowCell = c;
    const flow = this.flow;
    flow.fill(Infinity);
    this.closed.fill(0);
    const heap = this.heap;
    heap.clear();
    flow[c] = 0;
    heap.push(0, c);
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur]) continue;
      this.closed[cur] = 1;
      const x = cur % this.w, z = (cur / this.w) | 0;
      const dc = flow[cur];
      for (let k = 0; k < 8; k++) {
        const [dx, dz] = DIRS8[k];
        const nx = x + dx, nz = z + dz;
        if (!this.inBounds(nx, nz)) continue;
        const ni = this.idx(nx, nz);
        if (!this.navOk(ni)) continue;
        if (k >= 4 && (!this.navOk(this.idx(x + dx, z)) || !this.navOk(this.idx(x, z + dz)))) continue;
        const nd = dc + (k >= 4 ? 1.4142 : 1);
        if (nd < flow[ni]) {
          flow[ni] = nd;
          heap.push(nd, ni);
        }
      }
    }
  }

  invalidateFlow() {
    this.flowCell = -1;
  }

  /** 流场里比当前格更接近玩家的最佳相邻格 */
  bestNeighbor(i: number): number {
    const x = i % this.w, z = (i / this.w) | 0;
    let best = -1;
    let bd = this.inBounds(x, z) ? this.flow[i] : Infinity;
    for (let k = 0; k < 8; k++) {
      const [dx, dz] = DIRS8[k];
      const nx = x + dx, nz = z + dz;
      if (!this.inBounds(nx, nz)) continue;
      const ni = this.idx(nx, nz);
      if (!this.navOk(ni)) continue;
      if (k >= 4 && (!this.navOk(this.idx(x + dx, z)) || !this.navOk(this.idx(x, z + dz)))) continue;
      if (this.flow[ni] < bd) {
        bd = this.flow[ni];
        best = ni;
      }
    }
    return best;
  }

  // ---------- 区域 / 门 / 窗 ----------

  private computeZones() {
    const { w, h, grid } = this;
    const roomy = (t: number) => t === T.FLOOR || t === T.CRATE || t === T.OBJECT;
    let zone = 0;
    const stack: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (!roomy(grid[i]) || this.zoneOf[i] >= 0) continue;
      stack.push(i);
      this.zoneOf[i] = zone;
      while (stack.length) {
        const c = stack.pop()!;
        const x = c % w, z = (c / w) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + DIRS8[k][0], nz = z + DIRS8[k][1];
          if (!this.inBounds(nx, nz)) continue;
          const ni = this.idx(nx, nz);
          if (roomy(grid[ni]) && this.zoneOf[ni] < 0) {
            this.zoneOf[ni] = zone;
            stack.push(ni);
          }
        }
      }
      zone++;
    }
    this.zoneCount = zone;
    this.zoneActive = new Array(zone).fill(false);
    this.startZone = this.zoneOf[this.idx(Math.floor(this.def.start.x), Math.floor(this.def.start.z))];
    this.zoneActive[this.startZone] = true;
  }

  private buildDoors() {
    const doorTex = TX.doorTexture();
    const mat = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.85 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
    this.def.doors.forEach((def, index) => {
      const alongX = def.cells[0][0] !== def.cells[def.cells.length - 1][0];
      const zones = new Set<number>();
      let sx = 0, sz = 0;
      for (const [x, z] of def.cells) {
        this.doorOf[this.idx(x, z)] = index;
        sx += x + 0.5;
        sz += z + 0.5;
        const n1 = alongX ? this.zoneOf[this.idx(x, z - 1)] : this.zoneOf[this.idx(x - 1, z)];
        const n2 = alongX ? this.zoneOf[this.idx(x, z + 1)] : this.zoneOf[this.idx(x + 1, z)];
        if (n1 >= 0) zones.add(n1);
        if (n2 >= 0) zones.add(n2);
      }
      const center = new THREE.Vector3(sx / def.cells.length, 0, sz / def.cells.length);
      const group = new THREE.Group();
      group.position.copy(center);
      if (!alongX) group.rotation.y = Math.PI / 2;
      const n = def.cells.length;
      for (let k = 0; k < n; k++) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.98, DOOR_TOP - 0.02, 0.2), [sideMat, sideMat, sideMat, sideMat, mat, mat]);
        leaf.position.set(k - (n - 1) / 2, DOOR_TOP / 2, 0);
        if (k % 2 === 1) leaf.scale.x = -1;
        group.add(leaf);
      }
      this.root.add(group);
      this.doors.push({ def, index, open: false, group, anim: 0, zones: [...zones], center });
    });
  }

  openDoor(d: DoorRT) {
    if (d.open) return;
    d.open = true;
    d.anim = 0.0001;
    for (const z of d.zones) this.zoneActive[z] = true;
    this.invalidateFlow();
    this.game.audio.doorOpen(new THREE.Vector3(d.center.x, 1.5, d.center.z));
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
    this.def.windows.forEach(([cx, cz], index) => {
      let out: [number, number] = [0, 1];
      for (const [dx, dz] of DIRS8.slice(0, 4)) {
        if (this.typeAt(cx + dx, cz + dz) === T.VOID) out = [dx, dz];
      }
      const center = new THREE.Vector3(cx + 0.5, 0, cz + 0.5);
      const inside = new THREE.Vector3(center.x - out[0] * 1.0, 0, center.z - out[1] * 1.0);
      const outside = new THREE.Vector3(center.x + out[0] * 1.05, 0, center.z + out[1] * 1.05);
      const zone = this.zoneOf[this.idx(cx - out[0], cz - out[1])];
      const group = new THREE.Group();
      group.position.set(center.x - out[0] * 0.53, (SILL + LINTEL) / 2, center.z - out[1] * 0.53);
      group.rotation.y = Math.atan2(-out[0], -out[1]);
      const boards: THREE.Mesh[] = [];
      const boardBase: { pos: THREE.Vector3; rot: number }[] = [];
      layout.forEach(([y, rot, diag], k) => {
        const m = new THREE.Mesh(diag ? diagGeo : boardGeo, this.boardMats[0]);
        const pos = new THREE.Vector3((k % 2 ? 1 : -1) * 0.02, y, 0.012 * k);
        m.position.copy(pos);
        m.rotation.z = rot;
        group.add(m);
        boards.push(m);
        boardBase.push({ pos, rot });
      });
      this.root.add(group);
      this.windows.push({
        index, cx, cz, out, zone,
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
    return new THREE.Vector3(w.center.x - w.out[0] * 0.5, 1.5, w.center.z - w.out[1] * 0.5);
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
    if (!silent) this.game.audio.hammer(new THREE.Vector3(w.center.x, 1.5, w.center.z));
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
    for (const d of this.doors) {
      if (d.anim <= 0 || !d.group.visible) continue;
      d.anim += dt;
      const t = Math.min(1, d.anim / 1.1);
      d.group.position.y = t * t * (DOOR_TOP + 0.3);
      if (t >= 1) d.group.visible = false;
    }
    for (const w of this.windows) {
      for (let i = 0; i < BOARDS; i++) {
        const a = w.boardAnim[i];
        if (a.mode === 0) continue;
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
    let s = 0;
    for (const l of this.lamps) {
      const d2 = (l.pos.x - p.x) ** 2 + (l.pos.z - p.z) ** 2;
      s += (l.light.intensity / l.base) / (1 + d2 / 10);
    }
    return clamp(0.25 + s * 0.8, 0.25, 1.2);
  }
}
