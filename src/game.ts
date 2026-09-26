import * as THREE from 'three';
import { Input } from './core/input';
import { Sfx } from './core/audio';
import { Level } from './world/level';
import { buildMap } from './world/map';
import { Player } from './entities/player';
import { ZombieManager } from './entities/zombies';
import { WeaponSystem } from './weapons/weaponSystem';
import { Projectiles } from './weapons/projectiles';
import { Interactables } from './world/interactables';
import { Powerups } from './world/powerups';
import { Turrets, TURRET } from './world/turrets';
import { Particles } from './fx/particles';
import { Decals } from './fx/decals';
import { Lightning } from './fx/lightning';
import { Hud } from './hud';
import { Shop } from './shop';
import { WEAPONS, UPGRADES, type UpgradeId } from './weapons/defs';
import { lerp } from './core/util';

type State = 'menu' | 'playing' | 'paused' | 'shop' | 'over';

const BASE_FOV = 75;
const ROUND_BREAK = 9;

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  vmScene = new THREE.Scene();
  vmCamera: THREE.PerspectiveCamera;

  input: Input;
  audio = new Sfx();
  hud: Hud;
  level: Level;
  particles: Particles;
  decals: Decals;
  lightning: Lightning;
  turrets: Turrets;
  shop: Shop;
  player: Player;
  weapons: WeaponSystem;
  zombies: ZombieManager;
  projectiles: Projectiles;
  powerups: Powerups;
  interactables: Interactables;

  state: State = 'menu';
  time = 0;
  points = 500;
  round = 0;
  stats = { kills: 0, headshots: 0, shots: 0, hits: 0, earned: 0, time: 0 };
  debug = false;

  private startDelay = 2.5;
  private intermission = -1;
  private lastFrame = performance.now();
  private overT = -1;
  private fwd = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.autoClear = false;

    this.scene.background = new THREE.Color(0x070a11);
    this.scene.fog = new THREE.FogExp2(0x0a0e16, 0.038);
    this.scene.add(new THREE.HemisphereLight(0x6a7aa0, 0x3a3028, 0.75));

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 300);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 5);
    this.vmScene.add(this.vmCamera);

    this.input = new Input(canvas);
    this.hud = new Hud(this);
    this.level = new Level(this, buildMap());
    this.particles = new Particles(this.scene);
    this.decals = new Decals(this.scene);
    this.lightning = new Lightning(this.scene);
    this.turrets = new Turrets(this);
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.zombies = new ZombieManager(this);
    this.projectiles = new Projectiles(this);
    this.powerups = new Powerups(this);
    this.interactables = new Interactables(this);
    this.shop = new Shop(this);

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.debug) this.pause();
      else if (locked && this.state === 'paused') this.resume();
    };
    // 商店里按 B 回到游戏（按键算用户手势，可以直接重新锁定鼠标），按 Esc 回到暂停菜单
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'shop' || e.repeat) return;
      if (e.code === 'KeyB') this.closeShop(true);
      else if (e.code === 'Escape') this.closeShop(false);
    });
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked && !this.debug) this.input.requestLock();
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.hud.setRound(0, false);
    this.hud.showMenu('menu');
    requestAnimationFrame(this.loop);
  }

  // ---------- 流程 ----------

  start() {
    this.audio.init();
    this.hud.showMenu(null);
    this.hud.show(true);
    this.state = 'playing';
    this.player.yaw = this.level.def.start.yaw;
    this.player.pitch = 0;
    this.input.requestLock();
  }

  /** 调试：不锁鼠标直接开始（自动化测试用） */
  debugStart() {
    this.debug = true;
    this.input.freeLook = true;
    this.hud.showMenu(null);
    this.hud.show(true);
    this.state = 'playing';
    this.player.yaw = this.level.def.start.yaw;
    this.player.pitch = 0;
  }

  /** 调试：手动推进模拟（后台标签页里 requestAnimationFrame 不触发时用） */
  debugStep(seconds: number, dt = 1 / 60) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) {
      if (this.state === 'playing' || this.state === 'over') this.tick(dt);
      this.input.endFrame();
    }
    this.render();
    this.debugSnapshot();
  }

  /** 调试：把当前画面拷到一张覆盖图上（后台标签页的 canvas 不会刷新到屏幕） */
  debugSnapshot() {
    this.render();
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.85);
    let img = document.getElementById('debug-shot') as HTMLImageElement | null;
    if (!img) {
      img = document.createElement('img');
      img.id = 'debug-shot';
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
      this.renderer.domElement.after(img);
    }
    img.src = url;
  }

  openShop() {
    if (this.state !== 'playing' || this.player.dead) return;
    this.state = 'shop';
    this.hud.setPrompt(null);
    this.shop.open();
    this.input.exitLock();
  }

  closeShop(relock: boolean) {
    if (this.state !== 'shop') return;
    this.shop.close();
    this.input.clearPressed();
    if (this.debug) {
      this.state = 'playing';
      return;
    }
    this.state = 'paused';
    if (!relock) {
      this.hud.showMenu('pause');
      return;
    }
    this.input.requestLock();
    // 浏览器拒绝重新锁定鼠标时，退回暂停菜单让玩家点一下继续
    setTimeout(() => {
      if (this.state === 'paused' && !this.input.locked) this.hud.showMenu('pause');
    }, 300);
  }

  buyWeapon(id: string, slot: number) {
    const def = WEAPONS[id];
    if (!def || !def.shop || this.weapons.has(id)) return;
    if (this.spend(def.cost)) this.weapons.give(id, slot);
  }

  /** 买一台自动机枪，放在玩家面前 / 身边的空位上。失败时返回原因 */
  buyTurret(): string | null {
    if (!this.turrets.canPlace) return `最多只能放 ${TURRET.max} 台`;
    if (this.points < TURRET.cost) {
      this.spend(TURRET.cost);
      return '积分不够';
    }
    // 先确认有地方放，再扣分
    if (!this.turrets.place()) return '这里放不下，换个开阔点的位置';
    this.spend(TURRET.cost);
    return null;
  }

  buyUpgrade(id: UpgradeId) {
    const lv = this.level.upgrades[id];
    const next = UPGRADES[id].levels[lv];
    if (!next) return;
    if (this.spend(next.cost)) this.level.setUpgrade(id, lv + 1);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.showMenu('pause');
    this.audio.suspend(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.showMenu(null);
    this.audio.suspend(false);
  }

  requestResume() {
    this.input.requestLock();
    if (this.debug) this.resume();
  }

  gameOver() {
    if (this.state === 'over') return;
    this.state = 'over';
    this.overT = 3.5;
    this.audio.gameOver();
    this.hud.setPrompt(null);
  }

  addPoints(n: number) {
    if (this.powerups.double > 0) n *= 2;
    this.points += n;
    this.stats.earned += n;
    this.hud.popup(n);
  }

  spend(cost: number) {
    if (this.points < cost) {
      this.audio.denied();
      this.hud.deny();
      return false;
    }
    this.points -= cost;
    this.audio.purchase();
    this.hud.popup(-cost);
    return true;
  }

  private startRound(n: number) {
    this.round = n;
    this.zombies.beginRound(n);
    this.interactables.repairPoints = 0;
    this.hud.setRound(n, true);
    this.hud.announce(`第 ${n} 回合`, `ROUND ${n}`);
    this.audio.roundStart();
  }

  private updateRounds(dt: number) {
    if (this.round === 0) {
      this.startDelay -= dt;
      if (this.startDelay <= 0) this.startRound(1);
      return;
    }
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startRound(this.round + 1);
    } else if (this.zombies.roundClear) {
      this.intermission = ROUND_BREAK;
      this.audio.roundEnd();
      this.hud.roundEnding();
    }
  }

  // ---------- 主循环 ----------

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.state === 'playing' || this.state === 'over') this.tick(dt);
    else if (this.state === 'menu') this.menuTick(dt);
    this.render();
    this.input.endFrame();
  };

  private tick(dt: number) {
    this.time += dt;
    if (this.state === 'playing') this.stats.time += dt;
    const pl = this.player;
    if (this.state === 'playing' && this.input.wasPressed('KeyB')) {
      this.openShop();
      return;
    }
    pl.update(dt);
    pl.applyCamera(this.camera);
    this.camera.fov = lerp(BASE_FOV, this.weapons.current.def.adsFov, this.weapons.adsT);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.weapons.update(dt);
    this.interactables.update(dt);
    this.level.updateFlow(pl.pos.x, pl.pos.z);
    this.zombies.update(dt);
    this.projectiles.update(dt);
    this.turrets.update(dt);
    this.powerups.update(dt);
    this.level.update(dt);
    this.particles.update(dt);
    this.lightning.update(dt);
    if (this.state === 'playing') this.updateRounds(dt);
    this.hud.update(dt);
    this.audio.setListener(this.camera.position, this.camera.getWorldDirection(this.fwd));

    if (this.state === 'over' && this.overT > 0) {
      this.overT -= dt;
      if (this.overT <= 0) {
        this.input.exitLock();
        this.hud.showGameOver(this.round, this.stats);
      }
    }
  }

  /** 主菜单背景：镜头在起始房间里缓慢环视 */
  private menuTick(dt: number) {
    this.time += dt;
    this.player.yaw += dt * 0.06;
    this.player.pitch = Math.sin(this.time * 0.2) * 0.05;
    this.player.applyCamera(this.camera);
    this.level.update(dt);
  }

  private render() {
    this.particles.setViewport(this.renderer.domElement.height, this.camera.fov);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.state !== 'menu') {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  setSensitivity(v: number) {
    this.player.sensitivity = v;
  }
  setVolume(v: number) {
    this.audio.setVolume(v);
  }
}
