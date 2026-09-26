import * as THREE from 'three';
import * as TX from '../core/textures';
import { rand } from '../core/util';

const VERT = /* glsl */ `
uniform float uScale;
attribute float size;
attribute vec4 color4;
varying vec4 vColor;
void main() {
  vColor = color4;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(-mv.z, 0.05);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec4 vColor;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

/** 一个固定容量的 CPU 粒子池，用单个 THREE.Points 绘制 */
class Pool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private baseA: Float32Array;
  private baseSize: Float32Array;
  private grow: Float32Array;
  private next = 0;
  private mat: THREE.ShaderMaterial;

  constructor(private max: number, additive: boolean, map: THREE.Texture) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.baseA = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grow = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color4', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, map: { value: map } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }

  setScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, a: number, grav: number, grow = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.baseA[i] = a;
    this.col[i * 4 + 3] = a;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.grav[i] = grav;
    this.grow[i] = grow;
  }

  update(dt: number) {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.01) {
        this.pos[i * 3 + 1] = 0.01;
        this.vel[i * 3 + 1] *= -0.2;
        this.vel[i * 3] *= 0.5;
        this.vel[i * 3 + 2] *= 0.5;
      }
      this.col[i * 4 + 3] = this.baseA[i] * Math.min(1, k * 1.6);
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - k));
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color4.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  }
}

export class Particles {
  private normal: Pool;
  private additive: Pool;

  constructor(scene: THREE.Scene) {
    const dot = TX.dotTexture();
    this.normal = new Pool(1600, false, dot);
    this.additive = new Pool(800, true, dot);
    scene.add(this.normal.points, this.additive.points);
  }

  /** 根据相机 FOV 与画布高度换算点精灵的世界尺寸 */
  setViewport(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.normal.setScale(s);
    this.additive.setScale(s);
  }

  blood(p: THREE.Vector3, dir: THREE.Vector3, n: number, power: number) {
    for (let i = 0; i < n; i++) {
      const s = rand(0.6, 2.4) * power;
      this.normal.emit(
        p.x, p.y, p.z,
        dir.x * s + rand(-1, 1) * power, dir.y * s + rand(-0.3, 1.8) * power, dir.z * s + rand(-1, 1) * power,
        rand(0.35, 0.8), rand(0.03, 0.08), rand(0.3, 0.45), 0.01, 0.01, 0.95, 9.8,
      );
    }
    // 一小团血雾
    this.normal.emit(p.x, p.y, p.z, dir.x * 0.4, 0.2, dir.z * 0.4, 0.35, 0.18, 0.4, 0.02, 0.02, 0.45, 0, 1.8);
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, sparks: boolean) {
    for (let i = 0; i < 5; i++) {
      this.normal.emit(
        p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02,
        n.x * rand(0.3, 1.2) + rand(-0.4, 0.4), n.y * rand(0.3, 1.2) + rand(0, 0.6), n.z * rand(0.3, 1.2) + rand(-0.4, 0.4),
        rand(0.4, 0.9), rand(0.06, 0.14), 0.45, 0.42, 0.38, 0.5, 0.6, 1.5,
      );
    }
    if (sparks) {
      for (let i = 0; i < 4; i++) {
        this.additive.emit(
          p.x, p.y, p.z,
          n.x * rand(1, 4) + rand(-2, 2), n.y * rand(1, 4) + rand(-0.5, 2.5), n.z * rand(1, 4) + rand(-2, 2),
          rand(0.08, 0.2), 0.025, 1, 0.75, 0.35, 1, 12,
        );
      }
    }
  }

  wood(p: THREE.Vector3) {
    for (let i = 0; i < 14; i++) {
      this.normal.emit(
        p.x + rand(-0.4, 0.4), p.y + rand(-0.4, 0.4), p.z + rand(-0.4, 0.4),
        rand(-2, 2), rand(0, 3), rand(-2, 2),
        rand(0.5, 1.1), rand(0.03, 0.07), 0.55, 0.4, 0.25, 1, 9.8,
      );
    }
    this.normal.emit(p.x, p.y, p.z, 0, 0.3, 0, 0.8, 0.5, 0.4, 0.36, 0.3, 0.35, 0, 2);
  }

  raygunBurst(p: THREE.Vector3) {
    for (let i = 0; i < 26; i++) {
      this.additive.emit(
        p.x, p.y, p.z,
        rand(-4, 4), rand(-1, 4), rand(-4, 4),
        rand(0.2, 0.5), rand(0.05, 0.12), 0.35, 1, 0.4, 1, 4,
      );
    }
    this.additive.emit(p.x, p.y, p.z, 0, 0, 0, 0.3, 1.2, 0.3, 1, 0.45, 0.9, 0, 1.5);
  }

  /** 电火花（连锁闪电、电网） */
  sparks(p: THREE.Vector3, color: number) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 14; i++) {
      this.additive.emit(
        p.x, p.y, p.z,
        rand(-3, 3), rand(-1, 3.5), rand(-3, 3),
        rand(0.1, 0.3), rand(0.02, 0.05), c.r, c.g, c.b, 1, 8,
      );
    }
    this.additive.emit(p.x, p.y, p.z, 0, 0, 0, 0.18, 0.7, c.r, c.g, c.b, 0.8, 0, 1.2);
  }

  /** 火箭弹爆炸：火球 + 烟 + 碎屑 */
  explosion(p: THREE.Vector3) {
    for (let i = 0; i < 40; i++) {
      this.additive.emit(
        p.x, p.y, p.z,
        rand(-6, 6), rand(-1, 6), rand(-6, 6),
        rand(0.2, 0.5), rand(0.12, 0.3), 1, rand(0.45, 0.75), 0.15, 1, 3, 1.5,
      );
    }
    for (let i = 0; i < 18; i++) {
      this.normal.emit(
        p.x + rand(-0.5, 0.5), p.y + rand(-0.3, 0.5), p.z + rand(-0.5, 0.5),
        rand(-1.2, 1.2), rand(0.4, 2), rand(-1.2, 1.2),
        rand(1.2, 2.4), rand(0.5, 0.9), 0.2, 0.19, 0.18, 0.55, -0.3, 2.2,
      );
    }
    for (let i = 0; i < 16; i++) {
      this.normal.emit(p.x, p.y, p.z, rand(-7, 7), rand(2, 8), rand(-7, 7), rand(0.6, 1.2), rand(0.03, 0.06), 0.15, 0.12, 0.1, 1, 14);
    }
    this.additive.emit(p.x, p.y, p.z, 0, 0, 0, 0.25, 3.2, 1, 0.7, 0.3, 0.9, 0, 0.6);
  }

  /** 火箭尾焰的烟 */
  smoke(p: THREE.Vector3) {
    this.normal.emit(p.x, p.y, p.z, rand(-0.2, 0.2), rand(0.1, 0.4), rand(-0.2, 0.2), rand(0.6, 1.0), 0.18, 0.55, 0.53, 0.5, 0.35, -0.2, 2.5);
    this.additive.emit(p.x, p.y, p.z, 0, 0, 0, 0.06, 0.16, 1, 0.6, 0.2, 0.9, 0);
  }

  update(dt: number) {
    this.normal.update(dt);
    this.additive.update(dt);
  }
}
