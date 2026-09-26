import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gunWoodTextures, gunMetalTextures } from '../core/textures';

/**
 * 枪模零件库：材质、几何工具（侧面轮廓挤出、圆角方块、回转体）、常用零件（准星照门、握把、扳机护圈、弹匣）、
 * 袖子，以及把整把枪按材质合并成少量网格的 finalize。
 * 坐标约定同 models.ts：枪口朝 -z，x 向右，y 向上，单位米。
 */

// ---------- 材质 ----------

const metalTx = gunMetalTextures(11);

function metal(color: number, roughness: number, metalness: number) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, map: metalTx.map, roughnessMap: metalTx.roughMap });
}
function wood(base: [number, number, number], seed: number, roughness = 0.7) {
  const t = gunWoodTextures(base, seed);
  return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughMap, roughness });
}
function matte(color: number, roughness: number, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, map: metalTx.map });
}

export const M = {
  /** 发蓝钢 */
  blued: metal(0x2c3038, 0.36, 0.85),
  /** 磷化哑光钢 */
  park: metal(0x3b3d40, 0.62, 0.65),
  /** 黑色阳极氧化铝 */
  anod: metal(0x222326, 0.55, 0.55),
  /** 黑色小零件 */
  dark: metal(0x1a1b1e, 0.5, 0.75),
  /** 抛光钢：枪栓、扳机 */
  bright: metal(0x9a9ea5, 0.28, 0.95),
  wood: wood([150, 88, 48], 3),
  woodDark: wood([98, 58, 34], 5),
  woodRed: wood([165, 72, 38], 7),
  woodLight: wood([178, 118, 68], 9),
  bakelite: matte(0x4a2a1a, 0.42, 0.05),
  poly: matte(0x1d1e20, 0.8, 0.05),
  akMag: matte(0x7a3314, 0.45, 0.05),
  brass: metal(0xc09448, 0.3, 0.95),
  copper: metal(0xbb6d3e, 0.34, 0.9),
  olive: matte(0x525a36, 0.72, 0.2),
  leather: matte(0x3a2616, 0.75),
  hole: new THREE.MeshBasicMaterial({ color: 0x040404 }),
  skin: new THREE.MeshStandardMaterial({ color: 0x8f6448, roughness: 0.85 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x46512f, roughness: 0.95 }),
  rayBody: metal(0x8a9a90, 0.3, 0.75),
  rayRed: new THREE.MeshStandardMaterial({ color: 0xb02a1e, roughness: 0.35, metalness: 0.35 }),
  rayGlow: new THREE.MeshBasicMaterial({ color: 0x5dff72 }),
  blade: metal(0xc4c8ce, 0.22, 0.95),
  bulb: new THREE.MeshBasicMaterial({ color: 0x2f7fe0, transparent: true, opacity: 0.5, depthWrite: false }),
  electric: new THREE.MeshBasicMaterial({ color: 0xd8f2ff }),
  dial: new THREE.MeshBasicMaterial({ color: 0xd8cfb0 }),
  /** 瞄具镜片（淡蓝半透明） */
  lens: new THREE.MeshStandardMaterial({ color: 0x9cc8dc, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.2, depthWrite: false }),
  /** 全息 / 红点瞄具的发光分划 */
  reticle: new THREE.MeshBasicMaterial({ color: 0xff2a18 }),
  /** 半透明烟色弹匣（P90、AUG） */
  smoke: new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.62, depthWrite: false }),
  /** 光纤准星（ACOG 顶上的绿色导光条） */
  fiber: new THREE.MeshBasicMaterial({ color: 0x7dff5a }),
  /** 沙色聚合物 */
  tan: matte(0x9c8660, 0.75),
};

// ---------- 几何工具 ----------

/** 侧视图上的点 [z, y]；四个数时是二次曲线 [z, y, 控制点 z, 控制点 y] */
export type Pt = [number, number] | [number, number, number, number];

function tracePath<T extends THREE.Path>(p: T, pts: Pt[]) {
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const q = pts[i];
    if (q.length === 4) p.quadraticCurveTo(q[2], q[3], q[0], q[1]);
    else p.lineTo(q[0], q[1]);
  }
  return p;
}

function add(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** 侧面轮廓沿 x 方向挤出成宽 w 的零件，边缘倒角 r。枪托、机匣、握把基本都用它 */
export function side(g: THREE.Object3D, pts: Pt[], w: number, m: THREE.Material, x = 0, r = 0.0018, holes?: Pt[][]) {
  r = Math.min(r, w * 0.3);
  const shape = tracePath(new THREE.Shape(), pts);
  if (holes) for (const h of holes) shape.holes.push(tracePath(new THREE.Path(), h));
  const depth = Math.max(0.0004, w - 2 * r);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: r > 0,
    bevelThickness: r,
    bevelSize: r,
    bevelOffset: -r,
    bevelSegments: 3,
    curveSegments: 10,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  return add(g, geo, m, x);
}

/** 正视图上的形状 [x, y] 沿 z 挤出（准星框之类垂直于枪管的薄板） */
export function plate(g: THREE.Object3D, pts: [number, number][], thick: number, z: number, m: THREE.Material, holes?: [number, number][][]) {
  const shape = tracePath(new THREE.Shape(), pts);
  if (holes) for (const h of holes) shape.holes.push(tracePath(new THREE.Path(), h));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, -thick / 2);
  return add(g, geo, m, 0, 0, z);
}

export function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz = 0) {
  const mesh = add(g, new THREE.BoxGeometry(w, h, d), m, x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

/** 圆角方块 */
export function rbox(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0.002, rx = 0, ry = 0, rz = 0) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const geo = r > 0.0003 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  const mesh = add(g, geo, m, x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

/** 沿 z 轴的回转体：prof 为 [半径, z]，按 z 从前到后（从小到大）排列 */
export function lathe(g: THREE.Object3D, prof: [number, number][], x: number, y: number, m: THREE.Material, seg = 20) {
  const pts = prof.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-5), z));
  const geo = new THREE.LatheGeometry(pts, seg);
  geo.rotateX(Math.PI / 2);
  return add(g, geo, m, x, y, 0);
}

/** 沿 x 轴的回转体（弹鼓之类）：prof 为 [半径, x] */
export function latheX(g: THREE.Object3D, prof: [number, number][], y: number, z: number, m: THREE.Material, seg = 28) {
  const pts = prof.map(([r, x]) => new THREE.Vector2(Math.max(r, 1e-5), x));
  const geo = new THREE.LatheGeometry(pts, seg);
  geo.rotateZ(-Math.PI / 2);
  return add(g, geo, m, 0, y, z);
}

/** 沿 y 轴的回转体（瓶子）：prof 为 [半径, y]，y 从下到上 */
export function latheY(g: THREE.Object3D, prof: [number, number][], x: number, z: number, m: THREE.Material, seg = 24) {
  const pts = prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y));
  return add(g, new THREE.LatheGeometry(pts, seg), m, x, 0, z);
}

/** 正视图上的圆弧带（护罩截面）：圆心 (0, cy)，外半径 R，厚 t，从 -a 到 a（0 = 正上方） */
export function arcBand(R: number, t: number, cy: number, a: number, n = 14): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const th = -a + (2 * a * i) / n;
    pts.push([Math.sin(th) * R, cy + Math.cos(th) * R]);
  }
  for (let i = n; i >= 0; i--) {
    const th = -a + (2 * a * i) / n;
    pts.push([Math.sin(th) * (R - t), cy + Math.cos(th) * (R - t)]);
  }
  return pts;
}

/** 沿 z 轴的圆柱；r1 在后（+z）、r2 在前（-z） */
export function cylZ(g: THREE.Object3D, r1: number, r2: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 16) {
  const geo = new THREE.CylinderGeometry(r1, r2, len, seg);
  geo.rotateX(Math.PI / 2);
  return add(g, geo, m, x, y, z);
}

export function cylX(g: THREE.Object3D, r: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 16) {
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  geo.rotateZ(Math.PI / 2);
  return add(g, geo, m, x, y, z);
}

export function cylY(g: THREE.Object3D, r1: number, r2: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 16) {
  return add(g, new THREE.CylinderGeometry(r1, r2, len, seg), m, x, y, z);
}

export function sphere(g: THREE.Object3D, r: number, x: number, y: number, z: number, m: THREE.Material, seg = 14) {
  return add(g, new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), m, x, y, z);
}

/** 绕 z 轴的圆环（枪管箍、发光环） */
export function ringZ(g: THREE.Object3D, r: number, tube: number, x: number, y: number, z: number, m: THREE.Material, arc = Math.PI * 2) {
  return add(g, new THREE.TorusGeometry(r, tube, 8, 24, arc), m, x, y, z);
}

/** 两点之间的圆柱（杆、脚架腿） */
export function rod(g: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, r2 = r, seg = 12) {
  const len = a.distanceTo(b);
  const mesh = add(g, new THREE.CylinderGeometry(r2, r, len, seg), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return mesh;
}

/** 沿曲线的管子（电线、弹链） */
export function tube(g: THREE.Object3D, pts: THREE.Vector3[], r: number, m: THREE.Material) {
  return add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 8, r, 8, false), m);
}

const UP = new THREE.Vector3(0, 1, 0);
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------- 常用零件 ----------

/** 枪口黑洞 */
export function bore(g: THREE.Object3D, r: number, y: number, z: number, x = 0) {
  return cylZ(g, r, r, 0.0015, x, y, z - 0.0006, M.hole, 14);
}

/** 带倒角枪口的枪管：从 zb（后）到 zf（前），半径 r，可选前端收细到 r2 */
export function barrel(g: THREE.Object3D, r: number, zb: number, zf: number, y: number, m: THREE.Material = M.blued, r2 = r, x = 0) {
  lathe(g, [[0, zf], [r2 * 0.88, zf], [r2, zf + 0.002], [r, zb], [0, zb]], x, y, m);
  bore(g, r2 * 0.5, y, zf, x);
}

/** 两侧对称的螺丝头 */
export function screws(g: THREE.Object3D, halfW: number, y: number, z: number, r = 0.0026, m: THREE.Material = M.bright) {
  cylX(g, r, 0.0016, halfW, y, z, m, 10);
  cylX(g, r, 0.0016, -halfW, y, z, m, 10);
}

/** 准星：底座 + 细立柱，柱顶在 top。ears 两侧护耳，hood 顶部半圆护罩 */
export function frontSight(g: THREE.Object3D, z: number, base: number, top: number, opt: { ears?: boolean; hood?: boolean; m?: THREE.Material } = {}) {
  const m = opt.m ?? M.dark;
  const blockTop = top - 0.0065;
  if (blockTop - base > 0.0015) rbox(g, 0.011, blockTop - base, 0.012, 0, (blockTop + base) / 2, z, m, 0.0015);
  box(g, 0.0026, 0.0068, 0.0035, 0, top - 0.0034, z, m);
  if (opt.ears) {
    box(g, 0.0024, 0.0095, 0.01, 0.0068, top - 0.0035, z, m);
    box(g, 0.0024, 0.0095, 0.01, -0.0068, top - 0.0035, z, m);
  }
  if (opt.hood) ringZ(g, 0.0074, 0.0014, 0, top - 0.0022, z, m, Math.PI);
}

/** 照门：缺口底略低于 top，准星顶正好卡在缺口里 */
export function rearSight(g: THREE.Object3D, z: number, base: number, top: number, m: THREE.Material = M.dark, w = 0.017) {
  const gap = 0.0036;
  const floor = top - 0.0016;
  rbox(g, w, floor - base, 0.006, 0, (floor + base) / 2, z, m, 0.001);
  const pw = (w - gap) / 2;
  box(g, pw, 0.0042, 0.006, gap / 2 + pw / 2, floor + 0.0021, z, m);
  box(g, pw, 0.0042, 0.006, -(gap / 2 + pw / 2), floor + 0.0021, z, m);
}

/** 觇孔照门：圆环中心在 center，两侧护耳 */
export function rearPeep(g: THREE.Object3D, z: number, base: number, center: number, m: THREE.Material = M.dark) {
  const R = 0.0036;
  ringZ(g, R, 0.0014, 0, center, z, m);
  const stemTop = center - R;
  if (stemTop - base > 0.001) rbox(g, 0.008, stemTop - base, 0.006, 0, (stemTop + base) / 2, z, m, 0.001);
  const earTop = center + 0.006;
  box(g, 0.003, earTop - base, 0.008, 0.0085, (earTop + base) / 2, z, m);
  box(g, 0.003, earTop - base, 0.008, -0.0085, (earTop + base) / 2, z, m);
}

/** 霰弹枪的珠形准星 */
export function bead(g: THREE.Object3D, z: number, base: number, top: number) {
  const r = 0.0032;
  if (top - 2 * r - base > 0.001) cylY(g, 0.003, 0.004, top - 2 * r - base, 0, (top - 2 * r + base) / 2, z, M.dark, 10);
  sphere(g, r, 0, top - r, z, M.brass, 12);
}

/**
 * 手枪式握把：顶部从 zf（前）到 zb（后），高 top，向下长 len，底部向后偏 angle（弧度）。
 * 返回握把中心（中指高度），方便放手。
 */
export function grip(g: THREE.Object3D, zf: number, zb: number, top: number, len: number, angle: number, w: number, m: THREE.Material, r = 0.004) {
  const dz = Math.tan(angle) * len;
  const bot = top - len;
  side(
    g,
    [
      [zf, top],
      [zb, top],
      [zb + dz * 0.9, bot + len * 0.1],
      [zb + dz - 0.006, bot, zb + dz, bot],
      [zf + dz + 0.006, bot],
      [zf + dz * 0.9, bot + len * 0.1, zf + dz, bot],
    ],
    w,
    m,
    0,
    r,
  );
  return V(0, top - len * 0.42, (zf + zb) / 2 + dz * 0.42);
}

/** 扳机护圈（带孔的环）+ 扳机。护圈顶部 top 贴着机匣底，下沿在 bottom */
export function triggerGuard(g: THREE.Object3D, zb: number, zf: number, top: number, bottom: number, m: THREE.Material = M.blued, w = 0.009) {
  const t = 0.0036;
  const outer: Pt[] = [
    [zb, top],
    [zb - 0.001, bottom + 0.01],
    [zb - 0.012, bottom, zb - 0.002, bottom],
    [zf + 0.012, bottom],
    [zf, bottom + 0.013, zf + 0.001, bottom],
    [zf, top],
  ];
  const b = bottom + t;
  const hole: Pt[] = [
    [zb - t, top - 0.0012],
    [zb - t - 0.001, b + 0.007],
    [zb - t - 0.009, b, zb - t - 0.002, b],
    [zf + t + 0.009, b],
    [zf + t, b + 0.01, zf + t + 0.001, b],
    [zf + t, top - 0.0012],
  ];
  side(g, outer, w, m, 0, 0.0012, [hole]);
  const h = (top - bottom) * 0.62;
  const tz = zf + (zb - zf) * 0.52;
  side(
    g,
    [
      [tz + 0.0025, top],
      [tz - 0.0025, top],
      [tz - 0.0045, top - h * 0.6, tz - 0.004, top - h * 0.3],
      [tz - 0.0015, top - h],
      [tz + 0.0005, top - h * 0.55, tz - 0.001, top - h * 0.75],
    ],
    0.005,
    M.bright,
    0,
    0.001,
  );
}

/** 弹匣：顶部中心 z、上沿 top，向下 len，前后厚 d，宽 w。sweep > 0 时底部向前弯（弯弹匣） */
export function mag(g: THREE.Object3D, z: number, top: number, len: number, d: number, w: number, m: THREE.Material, sweep = 0) {
  const bot = top - len;
  const zb = z + d / 2, zf = z - d / 2;
  side(
    g,
    sweep > 0
      ? [
          [zf, top],
          [zb, top],
          [zb - sweep, bot + 0.004, zb + sweep * 0.05, top - len * 0.55],
          [zf - sweep * 1.12, bot],
          [zf, top, zf - sweep * 0.25, top - len * 0.55],
        ]
      : [
          [zf, top],
          [zb, top],
          [zb, bot],
          [zf, bot],
        ],
    w,
    m,
    0,
    0.002,
  );
  // 底板
  const bz = sweep > 0 ? zb - sweep - 0.002 : zb;
  const fz = sweep > 0 ? zf - sweep * 1.12 : zf;
  const ang = sweep > 0 ? Math.atan2(0.004, bz - fz) * 0.5 : 0;
  rbox(g, w + 0.003, 0.006, bz - fz + 0.004, 0, bot + 0.001, (bz + fz) / 2, M.dark, 0.0015, ang);
}

/** 圆柱表面上一圈圈的开槽（散热孔） */
export function slots(g: THREE.Object3D, y: number, r: number, z0: number, z1: number, n: number, angles: number[], sw: number, sl: number, round = false) {
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * (i + 0.5)) / n;
    for (const a of angles) {
      const mesh = round
        ? cylY(g, sw / 2, sw / 2, 0.0024, Math.sin(a) * r, y + Math.cos(a) * r, z, M.hole, 10)
        : rbox(g, sw, 0.0024, sl, Math.sin(a) * r, y + Math.cos(a) * r, z, M.hole, Math.min(sw, sl) * 0.45);
      mesh.rotation.z = -a;
    }
  }
}

/** 带弹头的一发子弹（沿 z，弹头朝前） */
export function cartridge(g: THREE.Object3D, x: number, y: number, z: number, len = 0.05, r = 0.0048) {
  cylZ(g, r, r, len * 0.68, x, y, z + len * 0.16, M.brass, 10);
  lathe(g, [[0, z - len / 2], [r * 0.55, z - len / 2 + len * 0.1], [r * 0.9, z - len * 0.18]], x, y, M.copper, 10);
}

// ---------- 手臂 ----------

const ZAXIS = new THREE.Vector3(0, 0, 1);

/** 两点之间的方条（袖子） */
export function limb(g: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, thick: number, m: THREE.Material) {
  const mesh = add(g, new THREE.BoxGeometry(thick, thick, a.distanceTo(b)), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(ZAXIS, b.clone().sub(a).normalize());
  return mesh;
}

// ---------- 合并 ----------

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** 按三角面朝向做盒式投影 UV（单位：米），木纹顺着枪身方向 */
function boxUV(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i);
    _b.fromBufferAttribute(pos, i + 1);
    _c.fromBufferAttribute(pos, i + 2);
    _c.sub(_b);
    _a.sub(_b);
    _c.cross(_a);
    const ax = Math.abs(_c.x), ay = Math.abs(_c.y), az = Math.abs(_c.z);
    const mode = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    for (let k = 0; k < 3; k++) {
      const j = i + k;
      const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
      uv[j * 2] = mode === 2 ? x : z;
      uv[j * 2 + 1] = mode === 1 ? x : y;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * 把 root 下所有网格烘焙到 root 空间、算好折痕法线和 UV，再按材质合并。
 * 一把枪最后只剩十来个网格，渲染开销很小。
 */
export function finalize(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4();
  for (const mesh of meshes) {
    let geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
    // toCreasedNormals 按 1 厘米量化顶点，先放大 100 倍避免把相邻的小零件搅在一起
    geo.scale(100, 100, 100);
    geo = toCreasedNormals(geo, 0.72);
    geo.scale(0.01, 0.01, 0.01);
    geo.applyMatrix4(m4.multiplyMatrices(inv, mesh.matrixWorld));
    boxUV(geo);
    const mat = mesh.material as THREE.Material;
    let list = byMat.get(mat);
    if (!list) byMat.set(mat, (list = []));
    list.push(geo);
    mesh.geometry.dispose();
  }
  for (const c of [...root.children]) root.remove(c);
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list);
    if (merged) root.add(new THREE.Mesh(merged, mat));
    for (const g of list) g.dispose();
  }
}
