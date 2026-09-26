import * as THREE from 'three';

/**
 * 程序化枪模。约定：枪口朝 -z，原点在扳机附近，单位米。
 * sightY = 准星线相对原点的高度，用于开镜时把准星对准屏幕中心。
 */
export interface GunModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  sightY: number;
}

const std = (color: number, roughness: number, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const M = {
  metal: std(0x2e3034, 0.42, 0.85),
  dark: std(0x222326, 0.45, 0.8),
  wood: std(0x6e3f20, 0.62),
  woodDark: std(0x4a2a16, 0.7),
  bakelite: std(0x3a2418, 0.5),
  brass: std(0xb58c3c, 0.35, 0.9),
  skin: std(0x8f6448, 0.85),
  sleeve: std(0x46512f, 0.95),
  glove: std(0x2a2520, 0.9),
  rayBody: std(0x7c8a80, 0.35, 0.7),
  rayRed: std(0xa3261c, 0.4, 0.3),
  rayGlow: new THREE.MeshBasicMaterial({ color: 0x5dff72 }),
  blade: std(0xb8bcc2, 0.25, 0.95),
  poly: std(0x1f2022, 0.7, 0.2),
  akWood: std(0x8a4520, 0.55),
  akMag: std(0x6e2e12, 0.5),
  olive: std(0x4b5231, 0.7, 0.3),
  copper: std(0xb5673a, 0.35, 0.9),
  bulb: new THREE.MeshBasicMaterial({ color: 0x2f7fe0, transparent: true, opacity: 0.55, depthWrite: false }),
  electric: new THREE.MeshBasicMaterial({ color: 0xd8f2ff }),
};

function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  g.add(mesh);
  return mesh;
}

/** 沿 z 轴的圆柱；r1 在后（+z）、r2 在前（-z） */
function cylZ(g: THREE.Object3D, r1: number, r2: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 12) {
  const geo = new THREE.CylinderGeometry(r1, r2, len, seg);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function cylX(g: THREE.Object3D, r: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 18) {
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  geo.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

const Z = new THREE.Vector3(0, 0, 1);
function limbBetween(g: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, thick: number, m: THREE.Material) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Z, b.clone().sub(a).normalize());
  g.add(mesh);
  return mesh;
}

/** 给枪模加上双手和袖子 */
function addArms(g: THREE.Group, right: THREE.Vector3, left: THREE.Vector3) {
  const rh = box(g, 0.044, 0.066, 0.08, right.x, right.y - 0.005, right.z, M.skin);
  rh.rotation.x = -0.2;
  limbBetween(g, new THREE.Vector3(right.x + 0.01, right.y - 0.02, right.z + 0.05), new THREE.Vector3(right.x + 0.13, right.y - 0.3, right.z + 0.42), 0.075, M.sleeve);
  const lh = box(g, 0.048, 0.045, 0.085, left.x, left.y - 0.005, left.z, M.skin);
  lh.rotation.z = 0.3;
  limbBetween(g, new THREE.Vector3(left.x - 0.015, left.y - 0.02, left.z + 0.05), new THREE.Vector3(left.x - 0.2, left.y - 0.28, left.z + 0.38), 0.075, M.sleeve);
}

type Builder = (g: THREE.Group) => { muzzle: [number, number, number]; sightY: number; right: [number, number, number]; left: [number, number, number] };

const BUILDERS: Record<string, Builder> = {
  pistol(g) {
    box(g, 0.032, 0.036, 0.2, 0, 0.035, -0.06, M.metal);
    box(g, 0.03, 0.02, 0.15, 0, 0.012, -0.04, M.dark);
    box(g, 0.034, 0.1, 0.05, 0, -0.035, 0.03, M.wood, -0.25);
    box(g, 0.006, 0.006, 0.04, 0, -0.008, -0.02, M.dark);
    box(g, 0.005, 0.009, 0.007, 0, 0.057, -0.152, M.dark);
    box(g, 0.022, 0.009, 0.007, 0, 0.057, 0.03, M.dark);
    box(g, 0.012, 0.016, 0.012, 0, 0.05, 0.045, M.dark);
    return { muzzle: [0, 0.035, -0.165], sightY: 0.06, right: [0, -0.045, 0.035], left: [-0.014, -0.055, 0.02] };
  },
  revolver(g) {
    box(g, 0.026, 0.03, 0.2, 0, 0.04, -0.1, M.metal);
    box(g, 0.012, 0.012, 0.19, 0, 0.061, -0.1, M.metal);
    cylZ(g, 0.024, 0.024, 0.045, 0, 0.03, -0.005, M.metal, 8);
    box(g, 0.028, 0.03, 0.06, 0, 0.02, 0.03, M.metal);
    box(g, 0.034, 0.1, 0.045, 0, -0.035, 0.05, M.woodDark, -0.3);
    box(g, 0.006, 0.014, 0.008, 0, 0.074, -0.19, M.dark);
    return { muzzle: [0, 0.04, -0.205], sightY: 0.078, right: [0, -0.045, 0.055], left: [-0.014, -0.055, 0.04] };
  },
  mp40(g) {
    cylZ(g, 0.02, 0.02, 0.26, 0, 0.03, -0.08, M.dark);
    cylZ(g, 0.01, 0.009, 0.14, 0, 0.03, -0.28, M.metal);
    box(g, 0.02, 0.02, 0.025, 0, 0.012, -0.27, M.dark);
    box(g, 0.028, 0.17, 0.034, 0, -0.07, -0.13, M.dark);
    box(g, 0.032, 0.095, 0.042, 0, -0.03, 0.02, M.bakelite, -0.2);
    box(g, 0.006, 0.006, 0.2, 0.013, 0.012, 0.13, M.metal);
    box(g, 0.006, 0.006, 0.2, -0.013, 0.012, 0.13, M.metal);
    box(g, 0.04, 0.06, 0.008, 0, 0.005, 0.23, M.metal);
    box(g, 0.012, 0.022, 0.012, 0, 0.056, -0.33, M.dark);
    box(g, 0.016, 0.014, 0.012, 0, 0.054, 0.0, M.dark);
    box(g, 0.03, 0.008, 0.008, -0.026, 0.035, -0.02, M.metal);
    return { muzzle: [0, 0.03, -0.355], sightY: 0.064, right: [0, -0.045, 0.028], left: [0, -0.095, -0.13] };
  },
  thompson(g) {
    box(g, 0.036, 0.075, 0.22, 0, -0.005, 0.2, M.wood, 0.12);
    box(g, 0.042, 0.05, 0.2, 0, 0.03, -0.03, M.metal);
    cylZ(g, 0.017, 0.017, 0.09, 0, 0.03, -0.17, M.dark, 10);
    cylZ(g, 0.01, 0.01, 0.12, 0, 0.03, -0.27, M.metal);
    box(g, 0.03, 0.085, 0.036, 0, -0.025, -0.16, M.wood, 0.15);
    box(g, 0.026, 0.14, 0.032, 0, -0.07, -0.07, M.dark);
    box(g, 0.032, 0.09, 0.04, 0, -0.03, 0.04, M.wood, -0.2);
    box(g, 0.01, 0.018, 0.01, 0, 0.058, -0.31, M.dark);
    box(g, 0.02, 0.02, 0.014, 0, 0.062, 0.05, M.dark);
    return { muzzle: [0, 0.03, -0.335], sightY: 0.07, right: [0, -0.045, 0.045], left: [0, -0.06, -0.16] };
  },
  ppsh(g) {
    box(g, 0.045, 0.065, 0.46, 0, 0.0, 0.07, M.wood);
    box(g, 0.042, 0.1, 0.12, 0, -0.03, 0.26, M.wood, 0.18);
    box(g, 0.036, 0.04, 0.2, 0, 0.042, -0.06, M.dark);
    cylZ(g, 0.019, 0.019, 0.18, 0, 0.042, -0.24, M.dark, 10);
    cylZ(g, 0.008, 0.008, 0.04, 0, 0.042, -0.35, M.metal);
    cylX(g, 0.065, 0.045, 0, -0.07, -0.08, M.dark);
    box(g, 0.01, 0.02, 0.01, 0, 0.072, -0.32, M.dark);
    box(g, 0.02, 0.016, 0.02, 0, 0.068, 0.03, M.dark);
    return { muzzle: [0, 0.042, -0.37], sightY: 0.078, right: [0, -0.03, 0.08], left: [0, -0.01, -0.2] };
  },
  m14(g) {
    box(g, 0.045, 0.07, 0.36, 0, -0.005, 0.08, M.wood);
    box(g, 0.04, 0.1, 0.14, 0, -0.035, 0.26, M.wood, -0.15);
    box(g, 0.046, 0.046, 0.25, 0, 0.015, -0.22, M.wood);
    box(g, 0.036, 0.04, 0.2, 0, 0.042, -0.04, M.metal);
    cylZ(g, 0.01, 0.009, 0.32, 0, 0.035, -0.45, M.metal);
    box(g, 0.03, 0.085, 0.05, 0, -0.055, -0.08, M.dark);
    box(g, 0.006, 0.03, 0.008, 0, 0.058, -0.58, M.dark);
    box(g, 0.022, 0.022, 0.016, 0, 0.07, 0.04, M.dark);
    return { muzzle: [0, 0.035, -0.62], sightY: 0.079, right: [0, -0.05, 0.07], left: [0, -0.015, -0.25] };
  },
  stg44(g) {
    box(g, 0.04, 0.06, 0.3, 0, 0.035, -0.05, M.dark);
    box(g, 0.04, 0.085, 0.22, 0, 0.012, 0.2, M.wood, 0.05);
    box(g, 0.03, 0.17, 0.045, 0, -0.08, -0.1, M.dark, 0.22);
    cylZ(g, 0.01, 0.009, 0.24, 0, 0.035, -0.32, M.metal);
    box(g, 0.046, 0.04, 0.13, 0, 0.022, -0.24, M.dark);
    box(g, 0.032, 0.09, 0.04, 0, -0.03, 0.05, M.bakelite, -0.2);
    box(g, 0.01, 0.024, 0.01, 0, 0.066, -0.4, M.dark);
    box(g, 0.018, 0.018, 0.02, 0, 0.074, -0.1, M.dark);
    return { muzzle: [0, 0.035, -0.45], sightY: 0.08, right: [0, -0.045, 0.055], left: [0, -0.005, -0.24] };
  },
  bar(g) {
    box(g, 0.045, 0.08, 0.3, 0, 0.0, 0.17, M.wood, 0.05);
    box(g, 0.046, 0.062, 0.3, 0, 0.03, -0.1, M.metal);
    box(g, 0.05, 0.046, 0.2, 0, 0.02, -0.33, M.wood);
    cylZ(g, 0.011, 0.011, 0.35, 0, 0.035, -0.52, M.metal);
    box(g, 0.036, 0.1, 0.07, 0, -0.05, -0.1, M.dark);
    box(g, 0.032, 0.09, 0.04, 0, -0.035, 0.04, M.wood, -0.2);
    box(g, 0.008, 0.028, 0.008, 0, 0.063, -0.66, M.dark);
    box(g, 0.022, 0.03, 0.02, 0, 0.074, 0.02, M.dark);
    return { muzzle: [0, 0.035, -0.7], sightY: 0.08, right: [0, -0.05, 0.045], left: [0, -0.005, -0.33] };
  },
  kar98k(g) {
    box(g, 0.045, 0.065, 0.7, 0, 0.0, -0.1, M.wood);
    box(g, 0.042, 0.11, 0.16, 0, -0.035, 0.26, M.wood, -0.12);
    box(g, 0.032, 0.036, 0.16, 0, 0.046, -0.02, M.metal);
    cylZ(g, 0.01, 0.009, 0.32, 0, 0.04, -0.6, M.metal);
    cylX(g, 0.006, 0.06, 0.035, 0.045, 0.02, M.metal, 8);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), M.metal);
    knob.position.set(0.066, 0.04, 0.02);
    g.add(knob);
    box(g, 0.006, 0.024, 0.008, 0, 0.06, -0.73, M.dark);
    box(g, 0.02, 0.014, 0.02, 0, 0.066, -0.14, M.dark);
    return { muzzle: [0, 0.04, -0.77], sightY: 0.07, right: [0, -0.05, 0.1], left: [0, -0.015, -0.3] };
  },
  doublebarrel(g) {
    box(g, 0.045, 0.085, 0.3, 0, -0.012, 0.14, M.wood, -0.1);
    box(g, 0.05, 0.05, 0.08, 0, 0.02, -0.04, M.metal);
    cylZ(g, 0.014, 0.013, 0.5, 0.0135, 0.03, -0.33, M.metal);
    cylZ(g, 0.014, 0.013, 0.5, -0.0135, 0.03, -0.33, M.metal);
    box(g, 0.045, 0.03, 0.18, 0, 0.005, -0.2, M.wood);
    box(g, 0.006, 0.008, 0.008, 0, 0.049, -0.575, M.brass);
    return { muzzle: [0, 0.03, -0.585], sightY: 0.052, right: [0, -0.05, 0.03], left: [0, -0.012, -0.2] };
  },
  trench(g) {
    box(g, 0.045, 0.085, 0.3, 0, -0.012, 0.16, M.wood, -0.08);
    box(g, 0.046, 0.062, 0.16, 0, 0.025, -0.04, M.metal);
    cylZ(g, 0.012, 0.012, 0.45, 0, 0.037, -0.34, M.metal);
    box(g, 0.036, 0.018, 0.3, 0, 0.057, -0.32, M.dark);
    cylZ(g, 0.021, 0.021, 0.14, 0, 0.0, -0.25, M.woodDark, 10);
    cylZ(g, 0.009, 0.009, 0.35, 0, 0.008, -0.31, M.dark);
    box(g, 0.006, 0.01, 0.008, 0, 0.07, -0.55, M.brass);
    return { muzzle: [0, 0.037, -0.57], sightY: 0.074, right: [0, -0.05, 0.05], left: [0, -0.025, -0.25] };
  },
  mg42(g) {
    box(g, 0.05, 0.07, 0.3, 0, 0.03, -0.02, M.dark);
    cylZ(g, 0.025, 0.025, 0.36, 0, 0.035, -0.34, M.metal, 10);
    for (let i = 0; i < 6; i++) box(g, 0.052, 0.01, 0.018, 0, 0.035, -0.2 - i * 0.05, M.dark);
    cylZ(g, 0.03, 0.028, 0.05, 0, 0.035, -0.545, M.dark);
    box(g, 0.04, 0.075, 0.22, 0, 0.005, 0.23, M.bakelite, 0.05);
    box(g, 0.032, 0.09, 0.04, 0, -0.035, 0.07, M.bakelite, -0.2);
    box(g, 0.05, 0.05, 0.1, -0.048, 0.01, -0.05, M.brass);
    box(g, 0.008, 0.008, 0.2, 0.02, -0.005, -0.33, M.dark, 0.05);
    box(g, 0.008, 0.008, 0.2, -0.02, -0.005, -0.33, M.dark, 0.05);
    box(g, 0.012, 0.03, 0.01, 0, 0.078, -0.48, M.dark);
    box(g, 0.02, 0.028, 0.02, 0, 0.08, 0.07, M.dark);
    return { muzzle: [0, 0.035, -0.575], sightY: 0.092, right: [0, -0.05, 0.075], left: [0, -0.002, -0.2] };
  },
  raygun(g) {
    cylZ(g, 0.036, 0.034, 0.16, 0, 0.03, -0.05, M.rayBody, 18);
    cylZ(g, 0.034, 0.011, 0.085, 0, 0.03, -0.17, M.rayBody, 18);
    for (const z of [-0.02, -0.065, -0.11]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.006, 8, 22), M.rayGlow);
      ring.position.set(0, 0.03, z);
      g.add(ring);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 10), M.rayRed);
    dome.position.set(0, 0.03, 0.03);
    g.add(dome);
    box(g, 0.03, 0.095, 0.045, 0, -0.04, 0.025, M.rayRed, -0.3);
    box(g, 0.007, 0.045, 0.1, 0, 0.074, -0.05, M.rayRed);
    box(g, 0.007, 0.03, 0.06, 0, -0.008, -0.1, M.rayRed);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), M.rayGlow);
    tip.position.set(0, 0.03, -0.215);
    g.add(tip);
    return { muzzle: [0, 0.03, -0.225], sightY: 0.098, right: [0, -0.045, 0.03], left: [-0.01, -0.02, -0.07] };
  },
  c96(g) {
    box(g, 0.03, 0.035, 0.15, 0, 0.04, -0.03, M.metal);
    cylZ(g, 0.008, 0.008, 0.12, 0, 0.045, -0.16, M.metal);
    box(g, 0.026, 0.05, 0.04, 0, 0.0, -0.06, M.metal);
    box(g, 0.03, 0.09, 0.04, 0, -0.035, 0.05, M.woodDark, -0.35);
    box(g, 0.006, 0.006, 0.03, 0, 0.005, -0.005, M.dark);
    box(g, 0.006, 0.01, 0.006, 0, 0.066, -0.21, M.dark);
    box(g, 0.02, 0.012, 0.012, 0, 0.064, 0.0, M.dark);
    box(g, 0.012, 0.016, 0.012, 0, 0.05, 0.05, M.dark);
    return { muzzle: [0, 0.045, -0.225], sightY: 0.072, right: [0, -0.045, 0.055], left: [-0.014, -0.055, 0.04] };
  },
  type100(g) {
    box(g, 0.04, 0.065, 0.34, 0, 0.0, 0.14, M.wood);
    box(g, 0.04, 0.09, 0.12, 0, -0.03, 0.3, M.wood, 0.15);
    cylZ(g, 0.017, 0.017, 0.22, 0, 0.035, -0.1, M.dark);
    cylZ(g, 0.021, 0.021, 0.16, 0, 0.035, -0.28, M.dark, 10);
    for (let i = 0; i < 4; i++) box(g, 0.044, 0.008, 0.012, 0, 0.035, -0.22 - i * 0.035, M.metal);
    cylZ(g, 0.007, 0.007, 0.04, 0, 0.035, -0.38, M.metal);
    box(g, 0.14, 0.028, 0.03, -0.08, 0.03, -0.08, M.dark);
    box(g, 0.006, 0.02, 0.008, 0, 0.058, -0.35, M.dark);
    box(g, 0.016, 0.014, 0.016, 0, 0.058, 0.02, M.dark);
    return { muzzle: [0, 0.035, -0.4], sightY: 0.066, right: [0, -0.04, 0.07], left: [0, 0.0, -0.2] };
  },
  mp5k(g) {
    box(g, 0.04, 0.065, 0.26, 0, 0.03, -0.05, M.poly);
    cylZ(g, 0.009, 0.009, 0.05, 0, 0.04, -0.2, M.dark);
    box(g, 0.03, 0.14, 0.035, 0, -0.06, -0.08, M.dark, 0.25);
    box(g, 0.03, 0.09, 0.04, 0, -0.03, 0.04, M.poly, -0.2);
    box(g, 0.03, 0.08, 0.035, 0, -0.03, -0.15, M.poly);
    box(g, 0.02, 0.02, 0.03, 0, 0.072, 0.05, M.dark);
    box(g, 0.006, 0.024, 0.01, 0, 0.07, -0.17, M.dark);
    return { muzzle: [0, 0.04, -0.23], sightY: 0.084, right: [0, -0.045, 0.045], left: [0, -0.065, -0.15] };
  },
  ak74u(g) {
    box(g, 0.042, 0.055, 0.24, 0, 0.03, -0.03, M.metal);
    box(g, 0.036, 0.02, 0.2, 0, 0.065, -0.02, M.metal);
    box(g, 0.046, 0.045, 0.12, 0, 0.02, -0.2, M.akWood);
    cylZ(g, 0.01, 0.01, 0.08, 0, 0.035, -0.29, M.metal);
    cylZ(g, 0.017, 0.014, 0.05, 0, 0.035, -0.35, M.dark);
    box(g, 0.03, 0.16, 0.045, 0, -0.08, -0.06, M.akMag, 0.35);
    box(g, 0.032, 0.09, 0.04, 0, -0.03, 0.07, M.akWood, -0.25);
    box(g, 0.006, 0.006, 0.2, 0.015, 0.02, 0.2, M.metal);
    box(g, 0.006, 0.006, 0.2, -0.015, 0.02, 0.2, M.metal);
    box(g, 0.036, 0.06, 0.01, 0, 0.0, 0.3, M.metal);
    box(g, 0.006, 0.028, 0.008, 0, 0.064, -0.26, M.dark);
    box(g, 0.014, 0.012, 0.02, 0, 0.08, 0.02, M.dark);
    return { muzzle: [0, 0.035, -0.38], sightY: 0.085, right: [0, -0.05, 0.07], left: [0, -0.005, -0.2] };
  },
  gewehr43(g) {
    box(g, 0.045, 0.065, 0.5, 0, 0.0, 0.0, M.wood);
    box(g, 0.042, 0.11, 0.16, 0, -0.035, 0.28, M.wood, -0.12);
    box(g, 0.034, 0.04, 0.18, 0, 0.045, -0.02, M.metal);
    cylZ(g, 0.01, 0.009, 0.3, 0, 0.035, -0.45, M.metal);
    cylZ(g, 0.008, 0.008, 0.2, 0, 0.058, -0.3, M.metal);
    box(g, 0.03, 0.08, 0.05, 0, -0.05, -0.05, M.dark);
    box(g, 0.006, 0.03, 0.008, 0, 0.06, -0.58, M.dark);
    box(g, 0.02, 0.018, 0.02, 0, 0.072, 0.05, M.dark);
    return { muzzle: [0, 0.035, -0.6], sightY: 0.08, right: [0, -0.05, 0.09], left: [0, -0.015, -0.22] };
  },
  m16(g) {
    box(g, 0.04, 0.06, 0.22, 0, 0.03, -0.02, M.poly);
    box(g, 0.014, 0.03, 0.14, 0, 0.075, 0.0, M.poly);
    cylZ(g, 0.024, 0.024, 0.2, 0, 0.03, -0.22, M.poly, 10);
    cylZ(g, 0.008, 0.008, 0.16, 0, 0.03, -0.4, M.dark);
    cylZ(g, 0.011, 0.011, 0.04, 0, 0.03, -0.5, M.dark);
    box(g, 0.012, 0.06, 0.016, 0, 0.06, -0.33, M.poly);
    box(g, 0.028, 0.12, 0.05, 0, -0.07, -0.07, M.dark, 0.08);
    box(g, 0.03, 0.085, 0.04, 0, -0.03, 0.07, M.poly, -0.25);
    box(g, 0.04, 0.07, 0.24, 0, 0.015, 0.22, M.poly);
    return { muzzle: [0, 0.03, -0.52], sightY: 0.1, right: [0, -0.05, 0.07], left: [0, -0.01, -0.22] };
  },
  fg42(g) {
    box(g, 0.04, 0.06, 0.3, 0, 0.03, -0.06, M.metal);
    box(g, 0.046, 0.04, 0.14, 0, 0.015, -0.24, M.wood);
    cylZ(g, 0.01, 0.01, 0.22, 0, 0.035, -0.4, M.metal);
    cylZ(g, 0.015, 0.015, 0.05, 0, 0.035, -0.53, M.dark);
    box(g, 0.14, 0.03, 0.035, -0.085, 0.03, -0.07, M.dark);
    box(g, 0.03, 0.09, 0.04, 0, -0.035, 0.03, M.wood, -0.5);
    box(g, 0.035, 0.07, 0.2, 0, 0.01, 0.2, M.metal);
    box(g, 0.006, 0.006, 0.2, 0.015, 0.0, -0.3, M.dark);
    box(g, 0.006, 0.006, 0.2, -0.015, 0.0, -0.3, M.dark);
    box(g, 0.006, 0.03, 0.008, 0, 0.07, -0.5, M.dark);
    box(g, 0.016, 0.03, 0.016, 0, 0.075, -0.02, M.dark);
    return { muzzle: [0, 0.035, -0.56], sightY: 0.088, right: [0, -0.05, 0.04], left: [0, -0.01, -0.24] };
  },
  galil(g) {
    box(g, 0.042, 0.062, 0.26, 0, 0.03, -0.03, M.poly);
    box(g, 0.046, 0.045, 0.14, 0, 0.02, -0.22, M.poly);
    cylZ(g, 0.01, 0.01, 0.14, 0, 0.035, -0.34, M.dark);
    cylZ(g, 0.013, 0.013, 0.04, 0, 0.035, -0.43, M.dark);
    box(g, 0.03, 0.17, 0.045, 0, -0.085, -0.07, M.dark, 0.35);
    box(g, 0.03, 0.09, 0.04, 0, -0.035, 0.07, M.poly, -0.25);
    box(g, 0.006, 0.006, 0.22, 0.014, 0.03, 0.2, M.dark);
    box(g, 0.006, 0.006, 0.22, -0.014, 0.03, 0.2, M.dark);
    box(g, 0.03, 0.07, 0.01, 0, 0.0, 0.31, M.dark);
    box(g, 0.006, 0.03, 0.008, 0, 0.066, -0.36, M.dark);
    box(g, 0.016, 0.014, 0.016, 0, 0.074, 0.03, M.dark);
    return { muzzle: [0, 0.035, -0.45], sightY: 0.083, right: [0, -0.05, 0.07], left: [0, -0.005, -0.22] };
  },
  spas12(g) {
    box(g, 0.046, 0.07, 0.2, 0, 0.025, -0.03, M.poly);
    cylZ(g, 0.013, 0.013, 0.42, 0, 0.045, -0.33, M.dark);
    cylZ(g, 0.012, 0.012, 0.36, 0, 0.016, -0.3, M.dark);
    box(g, 0.034, 0.014, 0.26, 0, 0.063, -0.3, M.poly);
    box(g, 0.05, 0.045, 0.16, 0, 0.012, -0.24, M.poly);
    box(g, 0.03, 0.09, 0.04, 0, -0.035, 0.06, M.poly, -0.2);
    box(g, 0.008, 0.008, 0.24, 0.02, 0.045, 0.2, M.metal);
    box(g, 0.008, 0.008, 0.24, -0.02, 0.045, 0.2, M.metal);
    box(g, 0.05, 0.05, 0.01, 0, 0.03, 0.32, M.metal);
    box(g, 0.006, 0.012, 0.01, 0, 0.076, -0.52, M.brass);
    return { muzzle: [0, 0.045, -0.55], sightY: 0.08, right: [0, -0.05, 0.06], left: [0, -0.015, -0.24] };
  },
  m1919(g) {
    box(g, 0.055, 0.08, 0.3, 0, 0.035, -0.02, M.dark);
    cylZ(g, 0.028, 0.028, 0.34, 0, 0.03, -0.34, M.dark, 12);
    for (let i = 0; i < 5; i++) box(g, 0.058, 0.012, 0.02, 0, 0.03, -0.22 - i * 0.055, M.metal);
    cylZ(g, 0.02, 0.02, 0.04, 0, 0.03, -0.53, M.metal);
    box(g, 0.04, 0.075, 0.2, 0, 0.0, 0.22, M.wood);
    box(g, 0.03, 0.09, 0.04, 0, -0.035, 0.08, M.wood, -0.2);
    box(g, 0.07, 0.02, 0.05, -0.06, 0.045, -0.05, M.brass);
    box(g, 0.008, 0.008, 0.22, 0.03, -0.01, -0.4, M.dark, 0.1);
    box(g, 0.008, 0.008, 0.22, -0.03, -0.01, -0.4, M.dark, 0.1);
    box(g, 0.012, 0.03, 0.08, 0, 0.09, -0.1, M.dark);
    box(g, 0.01, 0.03, 0.01, 0, 0.065, -0.52, M.dark);
    box(g, 0.02, 0.03, 0.02, 0, 0.09, 0.08, M.dark);
    return { muzzle: [0, 0.03, -0.56], sightY: 0.104, right: [0, -0.05, 0.085], left: [0, 0.0, -0.2] };
  },
  rpk(g) {
    box(g, 0.042, 0.058, 0.26, 0, 0.03, -0.03, M.metal);
    box(g, 0.036, 0.02, 0.22, 0, 0.066, -0.02, M.metal);
    box(g, 0.046, 0.045, 0.16, 0, 0.02, -0.23, M.akWood);
    cylZ(g, 0.01, 0.01, 0.3, 0, 0.035, -0.45, M.metal);
    cylX(g, 0.07, 0.05, 0, -0.08, -0.06, M.dark);
    box(g, 0.032, 0.09, 0.04, 0, -0.03, 0.07, M.akWood, -0.25);
    box(g, 0.042, 0.08, 0.24, 0, 0.0, 0.22, M.akWood, 0.08);
    box(g, 0.006, 0.006, 0.2, 0.015, 0.01, -0.45, M.dark);
    box(g, 0.006, 0.006, 0.2, -0.015, 0.01, -0.45, M.dark);
    box(g, 0.006, 0.028, 0.008, 0, 0.064, -0.56, M.dark);
    box(g, 0.014, 0.012, 0.02, 0, 0.082, 0.02, M.dark);
    return { muzzle: [0, 0.035, -0.6], sightY: 0.087, right: [0, -0.05, 0.07], left: [0, -0.005, -0.23] };
  },
  ptrs(g) {
    cylZ(g, 0.014, 0.014, 0.9, 0, 0.04, -0.55, M.dark);
    box(g, 0.05, 0.035, 0.06, 0, 0.04, -1.02, M.dark);
    box(g, 0.05, 0.07, 0.3, 0, 0.03, -0.02, M.metal);
    box(g, 0.04, 0.06, 0.08, 0, -0.03, -0.05, M.dark);
    box(g, 0.05, 0.09, 0.3, 0, 0.0, 0.24, M.wood);
    box(g, 0.05, 0.035, 0.2, 0, 0.01, -0.25, M.wood);
    box(g, 0.032, 0.09, 0.04, 0, -0.035, 0.06, M.wood, -0.2);
    box(g, 0.01, 0.01, 0.3, 0.03, 0.01, -0.5, M.dark);
    box(g, 0.01, 0.01, 0.3, -0.03, 0.01, -0.5, M.dark);
    box(g, 0.02, 0.03, 0.03, 0, 0.085, -0.02, M.dark);
    box(g, 0.008, 0.04, 0.01, 0, 0.075, -0.9, M.dark);
    return { muzzle: [0, 0.04, -1.06], sightY: 0.1, right: [0, -0.05, 0.07], left: [0, -0.01, -0.26] };
  },
  panzerschreck(g) {
    cylZ(g, 0.045, 0.045, 1.1, 0, 0.06, -0.25, M.olive, 16);
    cylZ(g, 0.05, 0.053, 0.05, 0, 0.06, -0.8, M.olive, 16);
    cylZ(g, 0.049, 0.049, 0.04, 0, 0.06, 0.3, M.dark, 16);
    box(g, 0.03, 0.09, 0.04, 0, -0.03, -0.05, M.wood, -0.2);
    box(g, 0.03, 0.08, 0.035, 0, -0.02, -0.35, M.wood);
    box(g, 0.03, 0.05, 0.12, 0, 0.0, 0.18, M.dark);
    box(g, 0.006, 0.03, 0.006, 0, 0.12, -0.05, M.dark);
    box(g, 0.04, 0.04, 0.004, 0, 0.125, -0.45, M.dark);
    return { muzzle: [0, 0.06, -0.82], sightY: 0.13, right: [0, -0.05, -0.02], left: [0, -0.04, -0.35] };
  },
  wunderwaffe(g) {
    box(g, 0.045, 0.085, 0.3, 0, 0.0, 0.18, M.wood, 0.05);
    box(g, 0.06, 0.07, 0.26, 0, 0.03, -0.08, M.copper);
    cylZ(g, 0.022, 0.03, 0.2, 0, 0.03, -0.3, M.copper, 14);
    for (const z of [-0.24, -0.3, -0.36]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 8, 18), M.dark);
      ring.position.set(0, 0.03, z);
      g.add(ring);
    }
    for (const z of [-0.05, -0.14]) {
      cylZ(g, 0.015, 0.015, 0.012, -0.028, 0.068, z, M.dark);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), M.bulb);
      bulb.position.set(-0.028, 0.09, z);
      g.add(bulb);
      const fil = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), M.electric);
      fil.position.set(-0.028, 0.09, z);
      g.add(fil);
    }
    box(g, 0.012, 0.012, 0.2, 0.02, 0.07, -0.08, M.dark);
    box(g, 0.032, 0.09, 0.04, 0, -0.035, 0.04, M.wood, -0.2);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), M.electric);
    tip.position.set(0, 0.03, -0.42);
    g.add(tip);
    return { muzzle: [0, 0.03, -0.43], sightY: 0.082, right: [0, -0.045, 0.04], left: [0, -0.01, -0.24] };
  },
};

export function buildGun(model: string, withArms: boolean): GunModel {
  const group = new THREE.Group();
  const info = (BUILDERS[model] ?? BUILDERS.pistol)(group);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(...info.muzzle);
  group.add(muzzle);
  if (withArms) addArms(group, new THREE.Vector3(...info.right), new THREE.Vector3(...info.left));
  return { group, muzzle, sightY: info.sightY };
}

export function buildKnife() {
  const g = new THREE.Group();
  box(g, 0.004, 0.028, 0.16, 0, 0.0, -0.13, M.blade);
  box(g, 0.042, 0.012, 0.014, 0, 0.0, -0.045, M.metal);
  box(g, 0.022, 0.03, 0.09, 0, 0.0, 0.0, M.woodDark);
  box(g, 0.055, 0.075, 0.085, 0, -0.005, 0.01, M.skin);
  limbBetween(g, new THREE.Vector3(0.01, -0.02, 0.06), new THREE.Vector3(0.12, -0.2, 0.45), 0.075, M.sleeve);
  return g;
}

export function buildBottle() {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0xff3020, roughness: 0.15, metalness: 0.1, emissive: 0x401008 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.13, 14), glass);
  g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.026, 0.07, 12), glass);
  neck.position.y = 0.1;
  g.add(neck);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 10), M.brass);
  cap.position.y = 0.14;
  g.add(cap);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0305, 0.0305, 0.05, 14), new THREE.MeshStandardMaterial({ color: 0xf0e6c8, roughness: 0.8 }));
  g.add(label);
  box(g, 0.06, 0.08, 0.07, 0.03, -0.02, 0.0, M.skin);
  limbBetween(g, new THREE.Vector3(0.04, -0.05, 0.03), new THREE.Vector3(0.18, -0.3, 0.35), 0.075, M.sleeve);
  return { group: g, glass };
}
