import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../game';
import { T, type PropDef } from './map';
import { GeoBuilder, SLAB, DOOR_TOP, SILL, LINTEL, type Level } from './level';
import * as LT from '../core/labTextures';
import * as TX from '../core/textures';
import { seeded } from '../core/util';

/** 白天地图的场景：外观、家具、室外城市、太阳和阴影 */
export interface LabScene {
  update(dt: number, moving: boolean): void;
  lightLevelAt(p: THREE.Vector3): number;
}

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);

/** 研究中心的门：灰蓝钢门 */
export function labDoorMaterials(): [THREE.Material, THREE.Material] {
  return [std({ map: LT.labDoorTexture(), roughness: 0.5, metalness: 0.45 }), std({ color: 0x5c6670, roughness: 0.5, metalness: 0.5 })];
}

const wallish = (t: number) => t === T.WALL || t === T.GLASS || t === T.WINDOW || t === T.DOOR;
/** 4 邻居：dx, dz, 面方向（0 +x, 1 -x, 2 +z, 3 -z） */
const NB: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 1], [0, 1, 2], [0, -1, 3],
];

/** 按材质收集零件，最后每种材质合并成一个网格 */
class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  base = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  add(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(this.v.set(x, y, z), this.q, this.one.set(sx, sy, sz));
    g.applyMatrix4(this.m.premultiply(this.base));
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    return g;
  }
  box(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    return this.add(mat, new THREE.BoxGeometry(sx, sy, sz), x, y, z, rx, ry, rz);
  }
  cyl(mat: THREE.Material, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 12, rx = 0, rz = 0) {
    return this.add(mat, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, 0, rz);
  }
  ball(mat: THREE.Material, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    return this.add(mat, new THREE.SphereGeometry(r, 10, 7), x, y, z, 0, 0, 0, sx, sy, sz);
  }
  plane(mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0, uRepeat = 1) {
    const g = new THREE.PlaneGeometry(w, h);
    if (uRepeat !== 1) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * uRepeat);
    }
    return this.add(mat, g, x, y, z, rx, ry, 0);
  }
  build(root: THREE.Object3D, cast = true, receive = true) {
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list)!, mat);
      mesh.castShadow = cast && !(mat as THREE.MeshStandardMaterial).transparent;
      mesh.receiveShadow = receive;
      root.add(mesh);
    }
    this.parts.clear();
  }
}

/** 往 GeoBuilder 里加任意四边形（楼梯斜栏板用） */
function quad4(b: GeoBuilder, a: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, e: THREE.Vector3, uS = 1) {
  const base = b.p.length / 3;
  const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(e, a)).normalize();
  for (const p of [a, c, d, e]) {
    b.p.push(p.x, p.y, p.z);
    b.n.push(n.x, n.y, n.z);
    b.uv.push((p.x + p.z) / uS, p.y / uS);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function buildLabScene(game: Game, lvl: Level): LabScene {
  const S = lvl.storey;
  const top = S * lvl.layers;
  const { w: W, h: H, grids } = lvl;
  const root = lvl.root;
  const renderer = game.renderer;
  const scene = game.scene;
  const rnd = seeded(4242);

  // ---------- 天空、光照、阴影 ----------
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const center = new THREE.Vector3(W / 2, 0, H / 2);
  const sunDir = new THREE.Vector3(0.42, 0.78, 0.5).normalize();
  const sky = skyTexture(sunDir);
  scene.background = sky;
  scene.environment = sky;
  scene.environmentIntensity = 0.35;
  scene.fog = new THREE.Fog(0xc4d4e3, 50, 280);
  game.hemi.color.set(0xe4eeff);
  game.hemi.groundColor.set(0xc2beb6);
  game.hemi.intensity = 1.35;
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
  sun.position.copy(center).addScaledVector(sunDir, 60);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34;
  sc.near = 10; sc.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---------- 材质 ----------
  const shell = (p: THREE.MeshStandardMaterialParameters) => {
    const m = std(p);
    m.shadowSide = THREE.DoubleSide;
    return m;
  };
  const M = {
    wall: shell({ map: LT.labWallTexture(S), roughness: 0.85 }),
    facade: shell({ map: LT.facadeTexture(S), roughness: 0.92 }),
    floor: shell({ map: LT.labFloorTexture(), roughness: 0.32 }),
    floor2: shell({ map: LT.labFloorTexture([138, 150, 164], 312), roughness: 0.75 }),
    ceil: shell({ map: LT.labCeilingTexture(), roughness: 0.95 }),
    slab: shell({ color: 0xe6e4df, roughness: 0.8 }),
    tread: shell({ map: LT.labFloorTexture([178, 172, 164], 313), roughness: 0.4 }),
    stair: shell({ color: 0xd9d6cf, roughness: 0.75 }),
    glass: std({ color: 0xa8cce0, transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.2 }),
    frame: std({ color: 0x2f353c, roughness: 0.4, metalness: 0.7 }),
    rail: std({ color: 0xc4cad0, roughness: 0.25, metalness: 0.85 }),
    white: std({ color: 0xe8e9ea, roughness: 0.55 }),
    grey: std({ color: 0xa9adb2, roughness: 0.5, metalness: 0.3 }),
    steel: std({ color: 0xb4bbc2, roughness: 0.3, metalness: 0.8 }),
    dark: std({ color: 0x24282d, roughness: 0.45, metalness: 0.3 }),
    black: std({ color: 0x141618, roughness: 0.3 }),
    wood: std({ color: 0x9c7450, roughness: 0.6 }),
    accent: std({ color: 0x2e8a96, roughness: 0.5 }),
    fabric: std({ color: 0x3f5a78, roughness: 0.95 }),
    chair: std({ color: 0x2b3038, roughness: 0.8 }),
    leaf: std({ color: 0x3d7a36, roughness: 0.85 }),
    leaf2: std({ color: 0x5a9442, roughness: 0.85 }),
    bark: std({ color: 0x5a4636, roughness: 0.95 }),
    pot: std({ color: 0xd8d2c8, roughness: 0.7 }),
    soil: std({ color: 0x3a2c20, roughness: 1 }),
    concrete: std({ color: 0xbdb8ae, roughness: 0.9 }),
    orange: std({ color: 0xd8741c, roughness: 0.6 }),
    olive: std({ color: 0x4f5638, roughness: 0.8 }),
    hazard: std({ color: 0xe0aa1c, roughness: 0.6 }),
    red: std({ color: 0xa82a22, roughness: 0.5 }),
    liquid: std({ color: 0x4af08a, emissive: 0x20c060, emissiveIntensity: 0.9, transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false }),
    flesh: std({ color: 0x4d5a3c, roughness: 0.8 }),
    flesh2: std({ color: 0x4a3050, emissive: 0x6a1a8a, emissiveIntensity: 0.4, roughness: 0.7 }),
    rackBody: std({ color: 0x1c1f23, roughness: 0.5, metalness: 0.4 }),
    locker: std({ color: 0x6f8494, roughness: 0.5, metalness: 0.5 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xf6f8ff }),
    screen: [0, 1, 2].map((v) => new THREE.MeshBasicMaterial({ map: LT.screenTexture(v) })),
    vend: [0, 1].map((v) => std({ map: LT.vendingTexture(v), emissive: 0xffffff, emissiveMap: LT.vendingTexture(v), emissiveIntensity: 0.35, roughness: 0.4 })),
    blood: [1, 2, 3].map((s) => std({ map: TX.bloodSplatTexture(s * 47), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })),
  };
  const rackTex = LT.rackTextures();
  const rackFront = std({ map: rackTex.map, emissiveMap: rackTex.emissive, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.4 });

  // ---------- 建筑外壳 ----------
  const B = {
    wall: new GeoBuilder(),
    facade: new GeoBuilder(),
    floor: new GeoBuilder(),
    floor2: new GeoBuilder(),
    ceil: new GeoBuilder(),
    slab: new GeoBuilder(),
    glass: new GeoBuilder(),
    tread: new GeoBuilder(),
    stair: new GeoBuilder(),
  };
  const kit = new Kit();
  const at = (x: number, z: number, L: number) => lvl.typeAt(x, z, L);

  // 中庭天窗范围：二楼挑空格子的包围盒
  let ox0 = W, oz0 = H, ox1 = -1, oz1 = -1;
  if (lvl.layers > 1) {
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (grids[1][lvl.idx(x, z)] !== T.OPEN) continue;
      ox0 = Math.min(ox0, x); ox1 = Math.max(ox1, x);
      oz0 = Math.min(oz0, z); oz1 = Math.max(oz1, z);
    }
  }
  const underSkylight = (x: number, z: number) => x >= ox0 && x <= ox1 && z >= oz0 && z <= oz1;

  const lampSpots: [number, number, number][] = [];
  for (let L = 0; L < lvl.layers; L++) {
    const y0 = L * S, y1 = y0 + S;
    const ceilY = L === 0 && lvl.layers > 1 ? S - SLAB : y1;
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const c = lvl.idx(x, z);
        const t = grids[L][c];
        if (t === T.VOID) continue;
        const up = L === 0 && lvl.layers > 1 ? grids[1][c] : T.VOID;
        const fb = (nt: number) => (nt === T.VOID ? B.facade : B.wall);
        if (t === T.WALL) {
          for (const [dx, dz, dir] of NB) {
            const nt = at(x + dx, z + dz, L);
            if (nt !== T.WALL) fb(nt).boxFace(dir, x, y0, z, x + 1, y1, z + 1, 4, S);
          }
          if (L === 0 && (up === T.OPEN || (up === T.VOID && lvl.layers > 1))) B.slab.boxFace(4, x, y0, z, x + 1, y1, z + 1, 2);
          continue;
        }
        if (t === T.WINDOW) {
          for (const [dx, dz, dir] of NB) {
            const nt = at(x + dx, z + dz, L);
            if (nt === T.WALL) continue;
            fb(nt).boxFace(dir, x, y0, z, x + 1, y0 + SILL, z + 1, 4, S);
            fb(nt).boxFace(dir, x, y0 + LINTEL, z, x + 1, y1, z + 1, 4, S);
          }
          B.slab.boxFace(4, x, y0, z, x + 1, y0 + SILL, z + 1, 2);
          B.slab.boxFace(5, x, y0 + LINTEL, z, x + 1, y1, z + 1, 2);
          windowFrame(kit, M, lvl, x, z, y0);
          continue;
        }
        if (t === T.GLASS) {
          const alongX = wallish(at(x - 1, z, L)) || wallish(at(x + 1, z, L));
          const gTop = y1 - 0.35;
          for (const [dx, dz, dir] of NB) {
            const nt = at(x + dx, z + dz, L);
            if (wallish(nt)) continue;
            fb(nt).boxFace(dir, x, gTop, z, x + 1, y1, z + 1, 4, S);
          }
          B.slab.boxFace(5, x, gTop, z, x + 1, y1, z + 1, 2);
          (L ? B.floor2 : B.floor).boxFace(4, x, y0, z, x + 1, y0, z + 1, 2);
          glassPanel(B.glass, kit, M, x, z, y0 + 0.02, gTop, alongX, at(alongX ? x + 1 : x, alongX ? z : z + 1, L) !== T.GLASS);
          continue;
        }
        if (t === T.DOOR) {
          for (const [dx, dz, dir] of NB) {
            const nt = at(x + dx, z + dz, L);
            if (nt === T.WALL || nt === T.DOOR || nt === T.GLASS) continue;
            fb(nt).boxFace(dir, x, y0 + DOOR_TOP, z, x + 1, y1, z + 1, 4, S);
          }
          B.slab.boxFace(5, x, y0 + DOOR_TOP, z, x + 1, y1, z + 1, 2);
          (L ? B.floor2 : B.floor).boxFace(4, x, y0, z, x + 1, y0, z + 1, 2);
          continue;
        }
        if (t === T.FLOOR || t === T.CRATE || t === T.OBJECT) (L ? B.floor2 : B.floor).boxFace(4, x, y0, z, x + 1, y0, z + 1, 2);
        // 天花板：一楼在楼板底下（挑空和楼梯井除外），二楼是屋顶（天窗除外）
        const roofed = L === 0 ? lvl.layers === 1 || (up !== T.OPEN && up !== T.STAIR) : !underSkylight(x, z);
        if (t !== T.STAIR && t !== T.OPEN ? roofed : L === 1 && roofed) {
          B.ceil.boxFace(5, x, ceilY, z, x + 1, ceilY, z + 1, 2);
          if (x % 3 === 1 && z % 3 === 1) lampSpots.push([x + 0.5, ceilY, z + 0.5]);
        }
        // 二楼楼板边缘（朝挑空和楼梯井的侧面）
        if (L === 1 && t !== T.OPEN && t !== T.STAIR) {
          for (const [dx, dz, dir] of NB) {
            const nt = at(x + dx, z + dz, 1);
            if (nt === T.OPEN || nt === T.STAIR) B.slab.boxFace(dir, x, S - SLAB, z, x + 1, S, z + 1, 2);
          }
        }
      }
    }
  }

  // 墙面、栏杆等只有二楼才有的部分
  buildStairs(lvl, B, kit, M);
  if (lvl.layers > 1) {
    buildEdgeRails(lvl, B, kit, M);
    if (ox1 >= ox0) buildSkylight(kit, M, ox0, oz0, ox1 + 1, oz1 + 1, top);
  }

  const shellMat: [GeoBuilder, THREE.Material, boolean][] = [
    [B.wall, M.wall, true], [B.facade, M.facade, true], [B.floor, M.floor, true], [B.floor2, M.floor2, true],
    [B.ceil, M.ceil, true], [B.slab, M.slab, true], [B.tread, M.tread, true], [B.stair, M.stair, true], [B.glass, M.glass, false],
  ];
  for (const [b, m, cast] of shellMat) {
    if (b.empty) continue;
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.castShadow = cast;
    mesh.receiveShadow = cast;
    if (!cast) mesh.renderOrder = 2;
    root.add(mesh);
  }

  // 吊顶灯盘
  const lampGeo = new THREE.BoxGeometry(1.1, 0.03, 0.5);
  const lamps = new THREE.InstancedMesh(lampGeo, M.lamp, lampSpots.length);
  const lm = new THREE.Matrix4();
  lampSpots.forEach(([x, y, z], i) => lamps.setMatrixAt(i, lm.makeTranslation(x, y - 0.012, z)));
  root.add(lamps);

  // ---------- 家具 / 设备 ----------
  const anim: { tanks: THREE.MeshStandardMaterial[] } = { tanks: [M.liquid] };
  for (const p of lvl.def.props ?? []) buildProp(kit, M, rackFront, p, S, rnd);
  kit.build(root);
  buildSigns(lvl, root);
  buildScaffolds(lvl, kit, M);
  kit.build(root);
  buildBlood(lvl, root, M.blood, rnd);

  // ---------- 室外 ----------
  buildOutdoor(lvl, root, kit, M, rnd);

  let t = 0;
  let warm = 3;
  let shadowT = 0;
  let pending = false;
  return {
    update(dt, moving) {
      t += dt;
      // 门、木板在动时重画阴影，最多每秒 5 次（阴影一次要多画两百多个物体）；停下后再补画一次
      if (moving) pending = true;
      shadowT -= dt;
      if (warm > 0 || (pending && shadowT <= 0)) {
        renderer.shadowMap.needsUpdate = true;
        shadowT = 0.2;
        pending = moving;
        warm--;
      }
      for (const m of anim.tanks) m.emissiveIntensity = 0.8 + Math.sin(t * 1.7) * 0.15;
      rackFront.emissiveIntensity = 1.0 + (Math.sin(t * 13) > 0.6 ? 0.4 : 0);
    },
    lightLevelAt(p) {
      const x = Math.floor(p.x), z = Math.floor(p.z);
      return underSkylight(x, z) ? 1.15 : 0.95;
    },
  };
}

type Mats = Record<string, THREE.Material | THREE.Material[]> & {
  [k: string]: THREE.Material | THREE.Material[];
};

function mat(M: Mats, k: string) {
  return M[k] as THREE.MeshStandardMaterial;
}

/** 玻璃幕墙：一格一块玻璃 + 竖梃 + 上下横框 */
function glassPanel(gb: GeoBuilder, kit: Kit, M: Mats, x: number, z: number, y0: number, y1: number, alongX: boolean, endCap: boolean) {
  kit.base.identity();
  const h = y1 - y0;
  const cy = (y0 + y1) / 2;
  if (alongX) {
    gb.quad([x + 0.5, cy, z + 0.5], [0, 0, 1], [1, 0, 0], [0, 1, 0], 0.5, h / 2, 1, 1);
    kit.box(mat(M, 'frame'), 0.06, h, 0.12, x, cy, z + 0.5);
    if (endCap) kit.box(mat(M, 'frame'), 0.06, h, 0.12, x + 1, cy, z + 0.5);
    kit.box(mat(M, 'frame'), 1, 0.08, 0.14, x + 0.5, y0 + 0.04, z + 0.5);
    kit.box(mat(M, 'frame'), 1, 0.06, 0.12, x + 0.5, y1 - 0.03, z + 0.5);
    kit.box(mat(M, 'frame'), 1, 0.05, 0.1, x + 0.5, y0 + 1.05, z + 0.5);
  } else {
    gb.quad([x + 0.5, cy, z + 0.5], [1, 0, 0], [0, 0, -1], [0, 1, 0], 0.5, h / 2, 1, 1);
    kit.box(mat(M, 'frame'), 0.12, h, 0.06, x + 0.5, cy, z);
    if (endCap) kit.box(mat(M, 'frame'), 0.12, h, 0.06, x + 0.5, cy, z + 1);
    kit.box(mat(M, 'frame'), 0.14, 0.08, 1, x + 0.5, y0 + 0.04, z + 0.5);
    kit.box(mat(M, 'frame'), 0.12, 0.06, 1, x + 0.5, y1 - 0.03, z + 0.5);
    kit.box(mat(M, 'frame'), 0.1, 0.05, 1, x + 0.5, y0 + 1.05, z + 0.5);
  }
}

/** 路障窗户外侧的铝合金窗框 */
function windowFrame(kit: Kit, M: Mats, lvl: Level, x: number, z: number, y0: number) {
  const L = y0 > 0 ? 1 : 0;
  let out: [number, number] = [0, 1];
  for (const [dx, dz] of NB) if (lvl.typeAt(x + dx, z + dz, L) === T.VOID) out = [dx, dz];
  kit.base.makeRotationY(Math.atan2(out[0], out[1])).setPosition(x + 0.5 + out[0] * 0.44, y0, z + 0.5 + out[1] * 0.44);
  const f = mat(M, 'frame');
  const h = LINTEL - SILL;
  kit.box(f, 0.07, h, 0.1, -0.47, SILL + h / 2, 0);
  kit.box(f, 0.07, h, 0.1, 0.47, SILL + h / 2, 0);
  kit.box(f, 1, 0.07, 0.1, 0, SILL + 0.03, 0);
  kit.box(f, 1, 0.07, 0.1, 0, LINTEL - 0.03, 0);
  // 碎玻璃残片
  const g = mat(M, 'glass');
  const shard = (sx: number, sy: number, px: number, py: number, rz: number) => kit.add(g, new THREE.PlaneGeometry(sx, sy), px, py, 0, 0, 0, rz);
  shard(0.22, 0.3, -0.36, SILL + 0.2, 0.3);
  shard(0.16, 0.26, 0.38, LINTEL - 0.18, -0.4);
  shard(0.3, 0.14, 0.3, SILL + 0.1, 0.1);
}

/** 楼梯：一级级台阶（实心）+ 开放侧的斜玻璃栏板 */
function buildStairs(lvl: Level, B: Record<string, GeoBuilder>, kit: Kit, M: Mats) {
  const S = lvl.storey;
  for (const st of lvl.stairs) {
    const alongZ = st.dir[0] === 0;
    const width = alongZ ? st.x1 - st.x0 + 1 : st.z1 - st.z0 + 1;
    const len = st.len;
    // (s 沿上楼方向, t 横向) → 世界坐标
    const P = (s: number, t: number, y: number) => {
      if (st.dir[1] < 0) return new THREE.Vector3(st.x0 + t, y, st.z1 + 1 - s);
      if (st.dir[1] > 0) return new THREE.Vector3(st.x0 + t, y, st.z0 + s);
      if (st.dir[0] > 0) return new THREE.Vector3(st.x0 + s, y, st.z0 + t);
      return new THREE.Vector3(st.x1 + 1 - s, y, st.z0 + t);
    };
    // 面方向：上楼方向、下楼方向、横向两侧
    const dirOf = (dx: number, dz: number) => (dx > 0 ? 0 : dx < 0 ? 1 : dz > 0 ? 2 : 3);
    const upDir = dirOf(st.dir[0], st.dir[1]);
    const downDir = dirOf(-st.dir[0], -st.dir[1]);
    const side0 = alongZ ? 1 : 3, side1 = alongZ ? 0 : 2;
    // 两侧和顶端外面是不是墙（贴墙的面不画，避免和墙面重叠闪烁）
    const sideOpen = (tSide: number) => {
      for (let k = 0; k < len; k++) {
        const p = P(k + 0.5, tSide < 0 ? -0.5 : width + 0.5, 0);
        if (!wallish(lvl.typeAt(Math.floor(p.x), Math.floor(p.z), 0))) return true;
      }
      return false;
    };
    const open0 = sideOpen(-1), open1 = sideOpen(1);
    const topP = P(len + 0.5, width / 2, 0);
    const topOpen = !wallish(lvl.typeAt(Math.floor(topP.x), Math.floor(topP.z), 0));
    const steps = Math.round(S / 0.2);
    const tread = len / steps, rise = S / steps;
    for (let k = 0; k < steps; k++) {
      const a = P(k * tread, 0, 0), b = P((k + 1) * tread, width, 0);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
      const y1 = (k + 0.5) * rise;
      B.tread.boxFace(4, x0, 0, z0, x1, y1, z1, 2);
      B.stair.boxFace(downDir, x0, 0, z0, x1, y1, z1, 2, 2);
      if (open0) B.stair.boxFace(side0, x0, 0, z0, x1, y1, z1, 2, 2);
      if (open1) B.stair.boxFace(side1, x0, 0, z0, x1, y1, z1, 2, 2);
      if (k === steps - 1 && topOpen) B.stair.boxFace(upDir, x0, 0, z0, x1, y1, z1, 2, 2);
      // 台阶前沿的防滑条
      kit.base.identity();
      const nose = P(k * tread + 0.03, width / 2, y1 + 0.003);
      kit.box(mat(M, 'dark'), alongZ ? width : 0.06, 0.01, alongZ ? 0.06 : width, nose.x, nose.y, nose.z);
    }
    // 开放侧的斜玻璃栏板 + 扶手
    for (const [open, tt] of [[open0, 0.05], [open1, width - 0.05]] as [boolean, number][]) {
      if (!open) continue;
      const a = P(0, tt, 0.05), b = P(len, tt, S + 0.05), c = P(len, tt, S + 1.0), d = P(0, tt, 1.0);
      quad4(B.glass, a, b, c, d);
      kit.base.identity();
      const mid = c.clone().add(d).multiplyScalar(0.5);
      const run = c.clone().sub(d);
      const rail = new THREE.BoxGeometry(0.05, 0.05, run.length());
      rail.lookAt(run);
      kit.add(mat(M, 'rail'), rail, mid.x, mid.y + 0.02, mid.z);
      for (let k = 0; k <= len; k += 2) {
        const p = P(k, tt, (S * k) / len);
        kit.box(mat(M, 'rail'), 0.05, 1.0, 0.05, p.x, p.y + 0.5, p.z);
      }
    }
  }
}

/** 二楼回廊边缘（朝挑空、朝楼梯井）的玻璃栏板 */
function buildEdgeRails(lvl: Level, B: Record<string, GeoBuilder>, kit: Kit, M: Mats) {
  const S = lvl.storey;
  const g1 = lvl.grids[1];
  const posts = new Set<string>();
  kit.base.identity();
  for (let z = 0; z < lvl.h; z++) {
    for (let x = 0; x < lvl.w; x++) {
      const t = g1[lvl.idx(x, z)];
      if (t !== T.FLOOR && t !== T.CRATE && t !== T.OBJECT) continue;
      for (const [dx, dz] of NB) {
        const nx = x + dx, nz = z + dz;
        const nt = lvl.typeAt(nx, nz, 1);
        if (nt !== T.OPEN && nt !== T.STAIR) continue;
        if (nt === T.STAIR) {
          // 楼梯顶端的出口不装栏杆
          const st = lvl.stairs[lvl.stairOf[lvl.idx(nx, nz)]];
          if (st.dir[0] === -dx && st.dir[1] === -dz) continue;
        }
        // 栏杆在两格的交界线上，往走道这边缩 4 厘米
        const ex = x + 0.5 + dx * 0.46, ez = z + 0.5 + dz * 0.46;
        const cy = S + 0.52;
        if (dx !== 0) {
          B.glass.quad([ex, cy, ez], [dx, 0, 0], [0, 0, 1], [0, 1, 0], 0.5, 0.47, 1, 1);
          kit.box(mat(M, 'rail'), 0.06, 0.05, 1.0, ex, S + 1.02, ez);
          kit.box(mat(M, 'frame'), 0.05, 0.05, 1.0, ex, S + 0.06, ez);
          for (const pz of [z, z + 1]) {
            const key = `${ex},${pz}`;
            if (!posts.has(key)) {
              posts.add(key);
              kit.box(mat(M, 'rail'), 0.05, 1.0, 0.05, ex, S + 0.52, pz);
            }
          }
        } else {
          B.glass.quad([ex, cy, ez], [0, 0, dz], [1, 0, 0], [0, 1, 0], 0.5, 0.47, 1, 1);
          kit.box(mat(M, 'rail'), 1.0, 0.05, 0.06, ex, S + 1.02, ez);
          kit.box(mat(M, 'frame'), 1.0, 0.05, 0.05, ex, S + 0.06, ez);
          for (const px of [x, x + 1]) {
            const key = `${px},${ez}`;
            if (!posts.has(key)) {
              posts.add(key);
              kit.box(mat(M, 'rail'), 0.05, 1.0, 0.05, px, S + 0.52, ez);
            }
          }
        }
      }
    }
  }
}

/** 中庭上方的玻璃天窗 + 钢梁 */
function buildSkylight(kit: Kit, M: Mats, x0: number, z0: number, x1: number, z1: number, y: number) {
  kit.base.identity();
  const glass = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  kit.add(mat(M, 'glass'), glass, (x0 + x1) / 2, y - 0.02, (z0 + z1) / 2, Math.PI / 2);
  const beam = mat(M, 'frame');
  for (let x = x0; x <= x1; x += 2) kit.box(beam, 0.1, 0.22, z1 - z0, x, y - 0.11, (z0 + z1) / 2);
  for (let z = z0; z <= z1; z += 1.5) kit.box(beam, x1 - x0, 0.08, 0.06, (x0 + x1) / 2, y - 0.06, z);
  // 天窗四周的井壁
  const wall = mat(M, 'slab');
  kit.box(wall, x1 - x0 + 0.2, 0.6, 0.1, (x0 + x1) / 2, y + 0.3, z0 - 0.05);
  kit.box(wall, x1 - x0 + 0.2, 0.6, 0.1, (x0 + x1) / 2, y + 0.3, z1 + 0.05);
  kit.box(wall, 0.1, 0.6, z1 - z0, x0 - 0.05, y + 0.3, (z0 + z1) / 2);
  kit.box(wall, 0.1, 0.6, z1 - z0, x1 + 0.05, y + 0.3, (z0 + z1) / 2);
}

/** 按种类搭一件家具。局部坐标：+z 是正面，x 是宽度方向，y 从地面起 */
function buildProp(kit: Kit, M: Mats, rackFront: THREE.Material, p: PropDef, S: number, rnd: () => number) {
  const w = p.w ?? 1, d = p.d ?? 1;
  const face = p.face ?? [0, 1];
  const y0 = (p.layer ?? 0) * S;
  const theta = Math.atan2(face[0], face[1]);
  const Wd = face[1] !== 0 ? w : d; // 局部宽
  kit.base.makeRotationY(theta).setPosition(p.x + w / 2, y0, p.z + d / 2);
  const m = (k: string) => mat(M, k);
  const scr = (v: number) => (M.screen as THREE.Material[])[v % 3];
  const chair = (x: number, z: number, ry: number) => {
    const c = m('chair');
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    kit.box(c, 0.44, 0.06, 0.44, x, 0.46, z, 0, ry);
    const [bx, bz] = P(0, -0.21);
    kit.box(c, 0.44, 0.48, 0.05, bx, 0.72, bz, 0, ry);
    kit.cyl(m('steel'), 0.025, 0.025, 0.42, x, 0.22, z, 6);
    kit.box(m('steel'), 0.5, 0.03, 0.05, x, 0.03, z, 0, ry);
    kit.box(m('steel'), 0.05, 0.03, 0.5, x, 0.03, z, 0, ry);
  };
  switch (p.kind) {
    case 'reception': {
      kit.box(m('white'), Wd, 1.0, 0.7, 0, 0.5, 0.1);
      kit.box(m('accent'), Wd + 0.01, 0.12, 0.71, 0, 0.72, 0.1);
      kit.box(m('wood'), Wd + 0.1, 0.05, 0.9, 0, 1.08, 0.05);
      kit.box(m('white'), Wd - 0.2, 0.04, 0.55, 0, 0.74, -0.45);
      kit.box(m('dark'), 0.5, 0.32, 0.03, -0.6, 1.3, -0.35);
      kit.plane(scr(0), 0.46, 0.28, -0.6, 1.3, -0.333);
      kit.box(m('dark'), 0.5, 0.32, 0.03, 0.5, 1.3, -0.35);
      kit.plane(scr(1), 0.46, 0.28, 0.5, 1.3, -0.333);
      chair(-0.2, -0.75, Math.PI);
      break;
    }
    case 'sofa': {
      kit.box(m('fabric'), Wd - 0.05, 0.4, 0.85, 0, 0.26, 0);
      kit.box(m('fabric'), Wd - 0.05, 0.5, 0.22, 0, 0.62, -0.32);
      kit.box(m('fabric'), 0.18, 0.56, 0.85, -(Wd / 2 - 0.12), 0.34, 0);
      kit.box(m('fabric'), 0.18, 0.56, 0.85, Wd / 2 - 0.12, 0.34, 0);
      kit.box(m('dark'), Wd - 0.2, 0.06, 0.7, 0, 0.03, 0);
      break;
    }
    case 'tree': {
      kit.box(m('concrete'), 0.96, 0.9, 0.96, 0, 0.45, 0);
      kit.box(m('soil'), 0.84, 0.02, 0.84, 0, 0.9, 0);
      kit.cyl(m('bark'), 0.07, 0.13, 3.8, 0, 2.8, 0, 8);
      kit.cyl(m('bark'), 0.03, 0.06, 1.4, 0.35, 3.9, 0.1, 6, 0.3, -0.6);
      kit.cyl(m('bark'), 0.03, 0.06, 1.2, -0.3, 4.1, -0.1, 6, -0.2, 0.7);
      const blobs: [number, number, number, number][] = [[0, 5.1, 0, 1.2], [0.6, 4.6, 0.3, 0.9], [-0.6, 4.7, -0.2, 0.95], [0.1, 4.4, -0.7, 0.8], [-0.2, 5.6, 0.4, 0.8]];
      blobs.forEach(([x, y, z, r], i) => kit.ball(m(i % 2 ? 'leaf2' : 'leaf'), r, x, y, z, 1, 0.8, 1));
      break;
    }
    case 'plant': {
      kit.cyl(m('pot'), 0.24, 0.19, 0.5, 0, 0.25, 0, 14);
      kit.cyl(m('soil'), 0.22, 0.22, 0.02, 0, 0.5, 0, 12);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + rnd();
        kit.ball(m(k % 2 ? 'leaf2' : 'leaf'), 0.2, Math.cos(a) * 0.14, 0.8 + rnd() * 0.45, Math.sin(a) * 0.14, 0.7, 1.6, 0.7);
      }
      break;
    }
    case 'bench': {
      kit.box(m('wood'), Wd - 0.1, 0.06, 0.45, 0, 0.45, 0);
      for (const sx of [-1, 1]) kit.box(m('steel'), 0.06, 0.42, 0.4, sx * (Wd / 2 - 0.25), 0.21, 0);
      break;
    }
    case 'kiosk': {
      kit.box(m('steel'), 0.45, 1.0, 0.35, 0, 0.5, 0);
      kit.box(m('dark'), 0.7, 0.5, 0.08, 0, 1.25, 0.05, -0.35);
      kit.plane(scr(0), 0.62, 0.42, 0, 1.265, 0.095, 0, -0.35);
      break;
    }
    case 'labbench': {
      kit.box(m('white'), Wd - 0.04, 0.86, 0.85, 0, 0.43, 0);
      kit.box(m('black'), Wd, 0.05, 0.95, 0, 0.885, 0);
      for (let k = 1; k < Wd * 2; k++) {
        kit.box(m('grey'), 0.012, 0.7, 0.87, -Wd / 2 + k * 0.5, 0.45, 0);
      }
      for (const sx of [-1, 1]) kit.cyl(m('steel'), 0.02, 0.02, 0.95, sx * (Wd / 2 - 0.1), 1.38, 0, 6);
      kit.box(m('steel'), Wd - 0.1, 0.03, 0.32, 0, 1.6, 0);
      for (let k = 0; k < Wd * 2; k++) {
        const x = -Wd / 2 + 0.3 + k * 0.5 + rnd() * 0.1;
        const r = rnd();
        if (r < 0.3) {
          // 显微镜
          kit.box(m('dark'), 0.14, 0.04, 0.2, x, 0.93, 0.2);
          kit.cyl(m('dark'), 0.025, 0.03, 0.26, x, 1.06, 0.18, 8, 0.4);
        } else if (r < 0.7) {
          kit.cyl(m('glass'), 0.04, 0.05, 0.14, x, 0.98, 0.25 - rnd() * 0.4, 10);
          kit.cyl(m('liquid'), 0.035, 0.045, 0.07, x, 0.945, 0.25 - rnd() * 0.4, 10);
        } else kit.box(m('white'), 0.3, 0.22, 0.25, x, 1.02, -0.1);
        kit.cyl(m(rnd() < 0.5 ? 'orange' : 'white'), 0.035, 0.035, 0.18, x, 1.71, 0, 8);
      }
      break;
    }
    case 'hood': {
      kit.box(m('white'), 0.95, 2.15, 0.85, 0, 1.075, -0.05);
      kit.box(m('black'), 0.8, 0.75, 0.02, 0, 1.3, 0.38);
      kit.plane(m('glass'), 0.8, 0.5, 0, 1.45, 0.4);
      kit.box(m('black'), 0.85, 0.04, 0.3, 0, 0.92, 0.28);
      kit.box(m('hazard'), 0.22, 0.14, 0.01, 0.2, 1.85, 0.376);
      kit.cyl(m('steel'), 0.12, 0.12, S - 2.3 - 0.3, 0, 2.15 + (S - 2.45) / 2, -0.1, 10);
      break;
    }
    case 'cabinet': {
      const h = p.h;
      kit.box(m('grey'), 0.9, h, 0.5, 0, h / 2, -0.22);
      kit.box(m('dark'), 0.01, h - 0.1, 0.01, 0, h / 2, 0.035);
      for (const sx of [-1, 1]) kit.box(m('steel'), 0.02, 0.18, 0.03, sx * 0.06, h * 0.55, 0.045);
      break;
    }
    case 'tank': {
      kit.cyl(m('steel'), 0.46, 0.48, 0.3, 0, 0.15, 0, 16);
      kit.cyl(m('flesh'), 0.12, 0.1, 0.9, 0, 1.1, 0, 8);
      kit.ball(m('flesh'), 0.12, 0, 1.68, 0.03);
      kit.cyl(m('flesh'), 0.04, 0.035, 0.6, 0.16, 1.2, 0, 6, 0, 0.3);
      kit.cyl(m('flesh'), 0.04, 0.035, 0.6, -0.16, 1.2, 0, 6, 0, -0.3);
      kit.cyl(m('liquid'), 0.39, 0.39, 1.75, 0, 1.2, 0, 16);
      kit.cyl(m('glass'), 0.42, 0.42, 1.85, 0, 1.22, 0, 16);
      kit.cyl(m('steel'), 0.47, 0.47, 0.26, 0, 2.27, 0, 16);
      for (const a of [0.5, 2.6, 4.4]) {
        const len = S - SLAB - 2.35;
        kit.cyl(m('dark'), 0.03, 0.03, len, Math.cos(a) * 0.3, 2.35 + len / 2, Math.sin(a) * 0.3, 6);
      }
      break;
    }
    case 'bigtank': {
      kit.cyl(m('steel'), 0.95, 1.0, 0.35, 0, 0.175, 0, 20);
      kit.cyl(m('flesh2'), 0.26, 0.2, 1.3, 0, 1.3, 0, 10);
      kit.ball(m('flesh2'), 0.22, 0, 2.15, 0.05);
      kit.cyl(m('flesh2'), 0.08, 0.06, 1.0, 0.36, 1.45, 0, 8, 0, 0.35);
      kit.cyl(m('flesh2'), 0.08, 0.06, 1.0, -0.36, 1.45, 0, 8, 0, -0.35);
      kit.cyl(m('flesh2'), 0.09, 0.07, 0.75, 0.12, 0.6, 0, 8);
      kit.cyl(m('flesh2'), 0.09, 0.07, 0.75, -0.12, 0.6, 0, 8);
      kit.cyl(m('liquid'), 0.82, 0.82, 2.4, 0, 1.6, 0, 24);
      kit.cyl(m('glass'), 0.86, 0.86, 2.5, 0, 1.6, 0, 24);
      kit.cyl(m('steel'), 0.95, 0.95, 0.4, 0, 3.05, 0, 20);
      for (const a of [0.3, 1.9, 3.5, 5.0]) kit.cyl(m('dark'), 0.06, 0.06, S - 3.2, Math.cos(a) * 0.6, 3.2 + (S - 3.2) / 2, Math.sin(a) * 0.6, 8);
      for (const a of [0.8, 2.4, 4.0, 5.5]) kit.box(m('hazard'), 0.3, 0.1, 0.02, Math.cos(a) * 0.99, 0.2, Math.sin(a) * 0.99, 0, -a + Math.PI / 2);
      break;
    }
    case 'vending': {
      const v = (M.vend as THREE.Material[])[Math.floor(rnd() * 2)];
      kit.box(m('dark'), 0.9, 1.9, 0.75, 0, 0.95, -0.1);
      kit.plane(v, 0.86, 1.86, 0, 0.95, 0.276);
      break;
    }
    case 'counter': {
      kit.box(m('steel'), Wd, 0.95, 0.7, 0, 0.475, 0);
      kit.box(m('rail'), Wd + 0.05, 0.05, 0.8, 0, 0.975, 0);
      kit.plane(m('glass'), Wd - 0.1, 0.42, 0, 1.3, 0.28);
      for (let k = 0; k <= Wd; k++) kit.cyl(m('steel'), 0.015, 0.015, 0.45, -Wd / 2 + 0.05 + k * ((Wd - 0.1) / Wd), 1.22, 0.28, 6);
      for (let k = 0; k < Wd; k++) kit.box(m(k % 2 ? 'orange' : 'white'), 0.4, 0.08, 0.3, -Wd / 2 + 0.5 + k, 1.04, -0.1);
      break;
    }
    case 'table': {
      kit.cyl(m('white'), 0.46, 0.46, 0.04, 0, 0.74, 0, 20);
      kit.cyl(m('steel'), 0.05, 0.05, 0.7, 0, 0.37, 0, 8);
      kit.cyl(m('steel'), 0.26, 0.26, 0.03, 0, 0.015, 0, 14);
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.5;
        chair(Math.sin(a) * 0.78, Math.cos(a) * 0.78, a + Math.PI + (rnd() - 0.5) * 0.6);
      }
      if (rnd() < 0.6) kit.cyl(m('white'), 0.1, 0.1, 0.02, 0.12, 0.77, 0.05, 12);
      break;
    }
    case 'locker': {
      kit.box(m('locker'), Wd, 1.95, 0.5, 0, 0.975, -0.2);
      for (let k = 0; k <= Wd / 0.4; k++) kit.box(m('dark'), 0.012, 1.9, 0.01, -Wd / 2 + k * 0.4, 0.975, 0.051);
      for (let k = 0; k < Wd / 0.4; k++) {
        const x = -Wd / 2 + 0.2 + k * 0.4;
        for (let v = 0; v < 3; v++) kit.box(m('dark'), 0.22, 0.012, 0.01, x, 1.75 - v * 0.03, 0.052);
        kit.box(m('steel'), 0.03, 0.12, 0.03, x + 0.12, 1.0, 0.06);
      }
      break;
    }
    case 'case': {
      for (let k = 0; k < Wd; k++) {
        const x = -Wd / 2 + 0.5 + k;
        const c = m(rnd() < 0.5 ? 'black' : rnd() < 0.5 ? 'olive' : 'orange');
        kit.box(c, 0.8, 0.45, 0.6, x, 0.225, 0, 0, (rnd() - 0.5) * 0.2);
        if (rnd() < 0.7) kit.box(m(rnd() < 0.5 ? 'olive' : 'black'), 0.6, 0.4, 0.45, x + (rnd() - 0.5) * 0.1, 0.65, 0, 0, (rnd() - 0.5) * 0.4);
      }
      break;
    }
    case 'rack': {
      kit.box(m('rackBody'), Wd, 2.1, 0.95, 0, 1.05, -0.02);
      kit.plane(rackFront, Wd - 0.04, 2.0, 0, 1.05, 0.456, 0, 0, Wd);
      kit.plane(rackFront, Wd - 0.04, 2.0, 0, 1.05, -0.496, Math.PI, 0, Wd);
      kit.box(m('hazard'), Wd, 0.04, 0.02, 0, 2.08, 0.46);
      break;
    }
    case 'desk': {
      kit.box(m('wood'), 0.96, 0.04, 0.72, 0, 0.74, -0.05);
      for (const sx of [-1, 1]) kit.box(m('grey'), 0.04, 0.72, 0.66, sx * 0.44, 0.36, -0.05);
      kit.box(m('grey'), 0.84, 0.4, 0.02, 0, 0.5, -0.38);
      kit.box(m('dark'), 0.06, 0.22, 0.06, 0, 0.87, -0.26);
      kit.box(m('dark'), 0.56, 0.35, 0.03, 0, 1.13, -0.25);
      kit.plane(scr(Math.floor(rnd() * 3)), 0.52, 0.31, 0, 1.13, -0.233);
      kit.box(m('dark'), 0.42, 0.02, 0.14, 0, 0.77, 0.04);
      if (rnd() < 0.5) kit.box(m('white'), 0.22, 0.01, 0.3, 0.3, 0.765, 0.05, 0, rnd());
      chair((rnd() - 0.5) * 0.3, 0.62, Math.PI + (rnd() - 0.5) * 1.2);
      break;
    }
    case 'console': {
      kit.box(m('white'), Wd, 0.85, 0.7, 0, 0.425, 0);
      kit.box(m('dark'), Wd, 0.06, 0.6, 0, 0.92, 0.05, 0.3);
      for (let k = 0; k < Wd; k++) {
        const x = -Wd / 2 + 0.5 + k;
        kit.box(m('dark'), 0.7, 0.45, 0.04, x, 1.35, -0.28);
        kit.plane(scr(k), 0.66, 0.41, x, 1.35, -0.258);
      }
      break;
    }
  }
}

/** 门上方的房间牌（两面各写对面房间的名字） */
function buildSigns(lvl: Level, root: THREE.Object3D) {
  const cache = new Map<string, THREE.MeshBasicMaterial>();
  const matFor = (name: string) => {
    let m = cache.get(name);
    if (!m) {
      const [cn, en] = name.split('|');
      m = new THREE.MeshBasicMaterial({ map: LT.signTexture(cn, en ?? '', '#1f3440', '#f2f6f8', 512, 128) });
      cache.set(name, m);
    }
    return m;
  };
  const geo = new THREE.PlaneGeometry(1.5, 0.375);
  for (const d of lvl.doors) {
    const names = d.def.names;
    if (!names) continue;
    const alongX = d.def.cells[0][0] !== d.def.cells[d.def.cells.length - 1][0];
    for (const side of [-1, 1]) {
      // 从 side 这一侧看，写的是另一侧的名字
      const m = new THREE.Mesh(geo, matFor(side < 0 ? names[1] : names[0]));
      const off = side * 0.515;
      m.position.set(d.center.x + (alongX ? 0 : off), d.baseY + DOOR_TOP + 0.4, d.center.z + (alongX ? off : 0));
      m.rotation.y = alongX ? (side < 0 ? Math.PI : 0) : side < 0 ? -Math.PI / 2 : Math.PI / 2;
      root.add(m);
    }
  }
  // 大厅北墙：机构名 + 电梯
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 1.1),
    new THREE.MeshBasicMaterial({ map: LT.signTexture('城市研究中心', 'URBAN RESEARCH CENTER', '#f4f6f7', '#1f5f6a', 1024, 256) }),
  );
  logo.position.set(17.8, 2.1, 7.012);
  root.add(logo);
  const elevator = std({ color: 0xa8b0b8, roughness: 0.25, metalness: 0.9 });
  const frame = std({ color: 0x41484f, roughness: 0.4, metalness: 0.6 });
  for (const x of [25.5, 28]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.45, 0.06), frame);
    f.position.set(x, 1.225, 7.02);
    root.add(f);
    for (const s of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.62, 2.25, 0.05), elevator);
      door.position.set(x + s * 0.32, 1.13, 7.05);
      root.add(door);
    }
  }
  const out = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.3), new THREE.MeshBasicMaterial({ map: LT.signTexture('电梯停运', 'OUT OF SERVICE', '#8a1c14', '#ffffff', 512, 110) }));
  out.position.set(26.75, 2.7, 7.02);
  root.add(out);
}

/** 二楼窗户外的施工脚手架：钢管架 + 木跳板 + 爬梯（丧尸从这里爬上去） */
function buildScaffolds(lvl: Level, kit: Kit, M: Mats) {
  const S = lvl.storey;
  for (const w of lvl.windows) {
    if (w.layer === 0) continue;
    kit.base.makeRotationY(Math.atan2(w.out[0], w.out[1])).setPosition(w.center.x, 0, w.center.z);
    // 局部：+z 朝外，墙外表面在 z = 0.5
    const pipe = mat(M, 'steel');
    const plank = mat(M, 'wood');
    const zs = [0.62, 1.82];
    for (const x of [-0.8, 0.8]) for (const z of zs) kit.cyl(pipe, 0.03, 0.03, S + 1.1, x, (S + 1.1) / 2, z, 6);
    for (let y = 1.2; y < S; y += 1.2) {
      for (const z of zs) kit.box(pipe, 1.6, 0.05, 0.05, 0, y, z);
      for (const x of [-0.8, 0.8]) kit.box(pipe, 0.05, 0.05, 1.2, x, y, 1.22);
    }
    for (const x of [-0.8, 0.8]) {
      const len = Math.hypot(S - 0.2, 1.2);
      kit.cyl(pipe, 0.02, 0.02, len, x, S / 2, 1.22, 5, Math.atan2(1.2, S - 0.2));
    }
    for (let k = 0; k < 4; k++) kit.box(plank, 1.7, 0.05, 0.3, 0, S - 0.03, 0.62 + 0.15 + k * 0.31);
    kit.box(pipe, 1.6, 0.05, 0.05, 0, S + 1.05, 1.82);
    kit.box(pipe, 0.05, 0.05, 1.2, -0.8, S + 1.05, 1.22);
    kit.box(pipe, 0.05, 0.05, 1.2, 0.8, S + 1.05, 1.22);
    kit.box(mat(M, 'hazard'), 1.6, 0.25, 0.02, 0, S + 0.12, 1.84);
    // 爬梯
    for (const x of [-0.22, 0.22]) kit.box(pipe, 0.04, S + 0.9, 0.04, x, (S + 0.9) / 2, 1.9);
    for (let y = 0.3; y < S + 0.8; y += 0.3) kit.box(pipe, 0.44, 0.025, 0.025, 0, y, 1.9);
  }
}

function buildBlood(lvl: Level, root: THREE.Object3D, mats: THREE.Material[], rnd: () => number) {
  // 墙上的血手印：随机挑一些朝着房间的墙面
  const hands = [11, 12, 13].map((s) => std({ map: LT.bloodHandTexture(s * 29), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  const kit = new Kit();
  let hp = 0;
  for (let tries = 0; tries < 800 && hp < 16; tries++) {
    const L = rnd() < 0.35 && lvl.layers > 1 ? 1 : 0;
    const x = Math.floor(rnd() * lvl.w), z = Math.floor(rnd() * lvl.h);
    if (lvl.grids[L][lvl.idx(x, z)] !== T.WALL) continue;
    const [dx, dz] = NB[Math.floor(rnd() * 4)];
    if (lvl.typeAt(x + dx, z + dz, L) !== T.FLOOR) continue;
    kit.add(
      hands[hp % 3],
      new THREE.PlaneGeometry(0.9, 0.9),
      x + 0.5 + dx * 0.505 + (dz ? (rnd() - 0.5) * 0.5 : 0),
      L * lvl.storey + 1.1 + rnd() * 0.6,
      z + 0.5 + dz * 0.505 + (dx ? (rnd() - 0.5) * 0.5 : 0),
      0, Math.atan2(dx, dz), 0,
    );
    hp++;
  }
  let placed = 0;
  for (let tries = 0; tries < 600 && placed < 30; tries++) {
    const L = rnd() < 0.35 && lvl.layers > 1 ? 1 : 0;
    const x = Math.floor(rnd() * lvl.w), z = Math.floor(rnd() * lvl.h);
    if (lvl.grids[L][lvl.idx(x, z)] !== T.FLOOR) continue;
    const s = 0.5 + rnd();
    kit.add(mats[placed % 3], new THREE.PlaneGeometry(1, 1), x + rnd(), L * lvl.storey + 0.004 + placed * 0.0002, z + rnd(), -Math.PI / 2, 0, rnd() * Math.PI * 2, s, s * (0.7 + rnd() * 0.6), 1);
    placed++;
  }
  kit.build(root, false, true);
}

/** 室外：广场地砖、环路、行道树、路灯、废弃车辆、远处的城市楼群 */
function buildOutdoor(lvl: Level, root: THREE.Object3D, kit: Kit, M: Mats, rnd: () => number) {
  const W = lvl.w, H = lvl.h;
  const cx = W / 2, cz = H / 2;
  const ground = (tex: THREE.Texture, w: number, h: number, x: number, z: number, y: number, tile: number) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(w / tile, h / tile);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std({ map: t, roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
  };
  const grass = LT.outdoorTexture(0), asphalt = LT.outdoorTexture(1), pavers = LT.outdoorTexture(2);
  ground(grass, 700, 700, cx, cz, -0.04, 8);
  // 广场：建筑四周 11 米，丧尸从这里走向窗户
  const px0 = -10, px1 = W + 10, pz0 = -10, pz1 = H + 10;
  ground(pavers, px1 - px0, pz1 - pz0, (px0 + px1) / 2, (pz0 + pz1) / 2, -0.02, 4);
  // 环路
  const rw = 8;
  const roads: [number, number, number, number][] = [
    [px0 - 2 - rw, pz0 - 2 - rw, px1 + 2 + rw, pz0 - 2],
    [px0 - 2 - rw, pz1 + 2, px1 + 2 + rw, pz1 + 2 + rw],
    [px0 - 2 - rw, pz0 - 2, px0 - 2, pz1 + 2],
    [px1 + 2, pz0 - 2, px1 + 2 + rw, pz1 + 2],
    // 往城市延伸出去的两条大路
    [cx - rw / 2, pz1 + 2 + rw, cx + rw / 2, pz1 + 180],
    [px1 + 2 + rw, cz - rw / 2, px1 + 200, cz + rw / 2],
  ];
  for (const [x0, z0, x1, z1] of roads) ground(asphalt, x1 - x0, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2, -0.01, 8);
  // 车道虚线
  kit.base.identity();
  const paint = std({ color: 0xe8e2c8, roughness: 0.8 });
  for (let x = px0 - 6; x < px1 + 6; x += 4) {
    kit.box(paint, 2, 0.01, 0.15, x, 0.0, pz0 - 2 - rw / 2);
    kit.box(paint, 2, 0.01, 0.15, x, 0.0, pz1 + 2 + rw / 2);
  }
  for (let z = pz0 - 6; z < pz1 + 6; z += 4) {
    kit.box(paint, 0.15, 0.01, 2, px0 - 2 - rw / 2, 0.0, z);
    kit.box(paint, 0.15, 0.01, 2, px1 + 2 + rw / 2, 0.0, z);
  }
  // 路缘石
  const curb = mat(M, 'concrete');
  kit.box(curb, px1 - px0 + 4, 0.15, 0.3, (px0 + px1) / 2, 0.07, pz0 - 2);
  kit.box(curb, px1 - px0 + 4, 0.15, 0.3, (px0 + px1) / 2, 0.07, pz1 + 2);
  kit.box(curb, 0.3, 0.15, pz1 - pz0 + 4, px0 - 2, 0.07, (pz0 + pz1) / 2);
  kit.box(curb, 0.3, 0.15, pz1 - pz0 + 4, px1 + 2, 0.07, (pz0 + pz1) / 2);

  // 行道树和路灯（沿环路外侧）
  const treeSpots: [number, number][] = [];
  const ring = (inset: number, step: number, fn: (x: number, z: number) => void) => {
    const x0 = px0 - 2 - rw - inset, x1 = px1 + 2 + rw + inset, z0 = pz0 - 2 - rw - inset, z1 = pz1 + 2 + rw + inset;
    for (let x = x0; x <= x1; x += step) {
      fn(x, z0);
      fn(x, z1);
    }
    for (let z = z0 + step; z < z1; z += step) {
      fn(x0, z);
      fn(x1, z);
    }
  };
  ring(3, 9, (x, z) => {
    if (Math.abs(x - cx) < 7 || Math.abs(z - cz) < 7) return;
    treeSpots.push([x + (rnd() - 0.5) * 2, z + (rnd() - 0.5) * 2]);
  });
  for (const [x, z] of treeSpots) {
    const s = 0.8 + rnd() * 0.5;
    kit.cyl(mat(M, 'bark'), 0.12 * s, 0.2 * s, 4 * s, x, 2 * s, z, 7);
    kit.ball(mat(M, rnd() < 0.5 ? 'leaf' : 'leaf2'), 2.0 * s, x, 5 * s, z, 1, 0.85, 1);
    kit.ball(mat(M, 'leaf'), 1.4 * s, x + 0.8 * s, 4.3 * s, z + 0.4 * s);
  }
  ring(-rw - 1, 16, (x, z) => {
    kit.cyl(mat(M, 'dark'), 0.07, 0.1, 7, x, 3.5, z, 8);
    kit.box(mat(M, 'dark'), 1.2, 0.12, 0.3, x, 7, z);
  });

  // 废弃车辆（停在路上，离窗户很远，不挡丧尸）
  const carColors = [0xb8bcc2, 0x2a3440, 0x8a1c18, 0xe8e8e4, 0x3e5a2a, 0x1c1c1e];
  const cars: [number, number, number][] = [
    [px0 - 6, cz - 6, 0.1], [px0 - 6, cz + 8, 3.0], [px1 + 6, cz - 10, 0.3], [px1 + 7, cz + 6, 1.4],
    [cx - 12, pz0 - 6, 1.6], [cx + 9, pz0 - 7, 1.5], [cx + 2, pz1 + 6, 1.7], [cx - 16, pz1 + 7, 4.6],
    [cx + 1, pz1 + 24, 0.2], [px1 + 28, cz + 1, 1.5],
  ];
  for (const [x, z, a] of cars) buildCar(kit, M, x, z, a, carColors[Math.floor(rnd() * carColors.length)], rnd() < 0.3);
  // 警戒路障
  const barrier = (x: number, z: number, a: number) => {
    kit.base.makeRotationY(a).setPosition(x, 0, z);
    kit.box(mat(M, 'hazard'), 2.2, 0.25, 0.08, 0, 0.9, 0);
    kit.box(mat(M, 'white'), 2.2, 0.25, 0.08, 0, 0.55, 0);
    for (const s of [-1, 1]) kit.box(mat(M, 'dark'), 0.08, 1.0, 0.5, s * 1.0, 0.5, 0);
  };
  barrier(cx - 3, pz1 + 13, 0);
  barrier(cx + 3.5, pz1 + 13.5, 0.2);
  barrier(px1 + 13, cz + 5, Math.PI / 2);
  kit.build(root, true, true);

  // 远处的城市楼群：三种外墙，按米铺贴图
  const cityB = [new GeoBuilder(), new GeoBuilder(), new GeoBuilder()];
  const cityM = [0, 1, 2].map((v) => std({ map: LT.cityFacadeTexture(v as 0 | 1 | 2), roughness: v === 2 ? 0.25 : 0.85, metalness: v === 2 ? 0.3 : 0 }));
  const roofM = std({ color: 0x77736c, roughness: 0.9 });
  const roofB = new GeoBuilder();
  for (let k = 0; k < 70; k++) {
    const a = (k / 70) * Math.PI * 2 + rnd() * 0.05;
    const d = 85 + rnd() * 110;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    // 两条大路方向留出空隙
    if (Math.abs(x - cx) < 10 && z > cz) continue;
    if (Math.abs(z - cz) < 10 && x > cx) continue;
    const bw = 14 + rnd() * 20, bd = 14 + rnd() * 20;
    const bh = 3.5 * Math.round(5 + rnd() * rnd() * 22);
    const v = Math.floor(rnd() * 3);
    const b = cityB[v];
    for (let f = 0; f < 4; f++) b.boxFace(f, x - bw / 2, 0, z - bd / 2, x + bw / 2, bh, z + bd / 2, 4, 3.5);
    roofB.boxFace(4, x - bw / 2, 0, z - bd / 2, x + bw / 2, bh, z + bd / 2, 8);
  }
  cityB.forEach((b, i) => root.add(new THREE.Mesh(b.build(), cityM[i])));
  root.add(new THREE.Mesh(roofB.build(), roofM));
}

function buildCar(kit: Kit, M: Mats, x: number, z: number, a: number, color: number, burnt: boolean) {
  kit.base.makeRotationY(a).setPosition(x, 0, z);
  const body = burnt ? mat(M, 'black') : std({ color, roughness: 0.35, metalness: 0.5 });
  kit.box(body, 1.8, 0.7, 4.3, 0, 0.6, 0);
  kit.box(body, 1.6, 0.55, 2.2, 0, 1.2, -0.2);
  kit.box(mat(M, burnt ? 'dark' : 'glass'), 1.62, 0.45, 2.0, 0, 1.22, -0.2);
  for (const sx of [-1, 1]) for (const sz of [-1.35, 1.35]) kit.cyl(mat(M, 'black'), 0.34, 0.34, 0.24, sx * 0.85, 0.34, sz, 12, 0, Math.PI / 2);
  kit.box(mat(M, 'white'), 1.5, 0.12, 0.04, 0, 0.72, 2.16);
  kit.box(mat(M, 'red'), 1.5, 0.1, 0.04, 0, 0.8, -2.16);
}

/** 程序化的等距柱状天空：天顶蓝 → 地平线白，太阳方向一圈光晕 */
function skyTexture(sunDir: THREE.Vector3) {
  const Wd = 1024, Ht = 512;
  const { c, g } = TX.mk(Wd, Ht);
  const img = g.createImageData(Wd, Ht);
  const d = img.data;
  const { top, horizon, ground } = LT.skyColors();
  const col = new THREE.Color();
  const sunCol = new THREE.Color(0xfff6e0);
  const v = new THREE.Vector3();
  for (let y = 0; y < Ht; y++) {
    const lat = (0.5 - y / Ht) * Math.PI;
    for (let x = 0; x < Wd; x++) {
      const lon = (x / Wd) * Math.PI * 2 - Math.PI;
      v.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      if (lat >= 0) col.copy(horizon).lerp(top, Math.pow(Math.sin(lat), 0.55));
      else col.copy(horizon).lerp(ground, Math.min(1, -Math.sin(lat) * 6));
      const s = Math.max(0, v.dot(sunDir));
      col.lerp(sunCol, Math.pow(s, 90) * 0.95 + Math.pow(s, 8) * 0.25);
      const o = (y * Wd + x) * 4;
      d[o] = col.r * 255;
      d[o + 1] = col.g * 255;
      d[o + 2] = col.b * 255;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
