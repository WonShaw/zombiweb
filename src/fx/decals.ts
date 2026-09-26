import * as THREE from 'three';
import * as TX from '../core/textures';

/** 弹孔 / 血迹贴花：固定数量循环复用 */
export class Decals {
  private holes: THREE.Mesh[] = [];
  private splats: THREE.Mesh[] = [];
  private hi = 0;
  private si = 0;
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const holeMat = new THREE.MeshStandardMaterial({
      map: TX.bulletHoleTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 1,
    });
    const holeGeo = new THREE.PlaneGeometry(0.09, 0.09);
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat);
      m.visible = false;
      scene.add(m);
      this.holes.push(m);
    }
    const splatMats = [7, 8, 9].map(
      (s) =>
        new THREE.MeshStandardMaterial({
          map: TX.bloodSplatTexture(s * 13),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          roughness: 0.75,
        }),
    );
    const splatGeo = new THREE.PlaneGeometry(1, 1);
    splatGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(splatGeo, splatMats[i % 3]);
      m.visible = false;
      scene.add(m);
      this.splats.push(m);
    }
  }

  bulletHole(p: THREE.Vector3, n: THREE.Vector3) {
    const m = this.holes[this.hi];
    this.hi = (this.hi + 1) % this.holes.length;
    m.visible = true;
    m.position.copy(p).addScaledVector(n, 0.004);
    m.lookAt(this.tmp.copy(m.position).add(n));
    m.rotateZ(Math.random() * Math.PI * 2);
    const s = 0.7 + Math.random() * 0.6;
    m.scale.set(s, s, 1);
  }

  bloodPool(x: number, z: number, y = 0) {
    const m = this.splats[this.si];
    this.si = (this.si + 1) % this.splats.length;
    m.visible = true;
    m.position.set(x, y + 0.006 + this.si * 0.0002, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.8 + Math.random() * 0.7;
    m.scale.set(s, 1, s);
  }
}
