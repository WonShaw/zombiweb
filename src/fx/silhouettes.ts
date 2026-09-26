import * as THREE from 'three';
import type { Game } from '../game';
import { SIL_LAYERS, type ZombieTier } from '../entities/zombieModel';

/** 路障写入模板缓冲的值：只有被路障挡住的像素才画轮廓，墙后面不画 */
export const BARRICADE_STENCIL = 1;

/** 给路障材质打开模板写入 */
export function markBarricade(m: THREE.Material) {
  m.stencilWrite = true;
  m.stencilRef = BARRICADE_STENCIL;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = THREE.ReplaceStencilOp;
}

const COLORS: Record<ZombieTier, number> = { normal: 0xffb040, elite: 0xff4030, super: 0xc060ff };

/**
 * 路障透视轮廓：窗外被木板 / 钢板挡住的丧尸，挡住的部分画成半透明的剪影（颜色和眼睛一样），
 * 方便隔着路障瞄准（子弹本来就能穿过路障）。只透过路障，不透墙。
 */
export class Silhouettes {
  private mats = {} as Record<ZombieTier, THREE.MeshBasicMaterial>;

  constructor(private game: Game) {
    for (const tier of Object.keys(COLORS) as ZombieTier[]) {
      this.mats[tier] = new THREE.MeshBasicMaterial({
        color: COLORS[tier],
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        depthFunc: THREE.GreaterDepth,
        fog: false,
        stencilWrite: true,
        stencilWriteMask: 0x00,
        stencilRef: BARRICADE_STENCIL,
        stencilFunc: THREE.EqualStencilFunc,
      });
    }
  }

  render() {
    const g = this.game;
    const present = new Set<ZombieTier>();
    for (const z of g.zombies.list) if (!z.dead && z.outsideWindow) present.add(z.tier);
    if (!present.size) return;
    const { scene, camera, renderer } = g;
    const bg = scene.background;
    const mask = camera.layers.mask;
    scene.background = null;
    for (const tier of present) {
      scene.overrideMaterial = this.mats[tier];
      camera.layers.set(SIL_LAYERS[tier]);
      renderer.render(scene, camera);
    }
    scene.overrideMaterial = null;
    camera.layers.mask = mask;
    scene.background = bg;
  }
}
