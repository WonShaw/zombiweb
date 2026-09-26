import * as THREE from 'three';

interface Bolt {
  a: THREE.Vector3;
  b: THREE.Vector3;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  t: number;
  next: number;
}

const LIFE = 0.32;

/** 连锁闪电 / 电网的电弧：锯齿折线做成细管子，短时间内闪烁几次后消失 */
export class Lightning {
  private bolts: Bolt[] = [];
  private coreMat = new THREE.MeshBasicMaterial({ color: 0xe6f6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private glowMat = new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  constructor(private scene: THREE.Scene) {}

  bolt(a: THREE.Vector3, b: THREE.Vector3) {
    const core = new THREE.Mesh(this.geo(a, b, 0.012), this.coreMat.clone());
    const glow = new THREE.Mesh(this.geo(a, b, 0.055), this.glowMat.clone());
    this.scene.add(core, glow);
    this.bolts.push({ a: a.clone(), b: b.clone(), core, glow, t: 0, next: 0.07 });
  }

  private geo(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    const len = a.distanceTo(b);
    const n = Math.max(4, Math.ceil(len * 3));
    const pts: THREE.Vector3[] = [];
    const jitter = Math.min(0.35, len * 0.08);
    for (let i = 0; i <= n; i++) {
      const p = new THREE.Vector3().lerpVectors(a, b, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(jitter));
      pts.push(p);
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), n * 2, r, 5, false);
  }

  update(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= LIFE) {
        this.scene.remove(b.core, b.glow);
        b.core.geometry.dispose();
        b.glow.geometry.dispose();
        (b.core.material as THREE.Material).dispose();
        (b.glow.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
        continue;
      }
      // 重新抖动形状，制造噼啪闪烁
      if (b.t >= b.next) {
        b.next += 0.07;
        b.core.geometry.dispose();
        b.glow.geometry.dispose();
        b.core.geometry = this.geo(b.a, b.b, 0.012);
        b.glow.geometry = this.geo(b.a, b.b, 0.055);
      }
      const k = 1 - b.t / LIFE;
      (b.core.material as THREE.MeshBasicMaterial).opacity = k * (0.7 + Math.random() * 0.3);
      (b.glow.material as THREE.MeshBasicMaterial).opacity = 0.35 * k;
    }
  }
}
