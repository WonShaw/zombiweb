import * as THREE from 'three';
import type { Game } from './game';
import { WEAPONS, CLASS_NAMES, UPGRADES, type WeaponDef, type WeaponClass, type UpgradeId } from './weapons/defs';
import { buildGun } from './weapons/models';
import { MAX_GUNS } from './weapons/weaponSystem';
import { TURRET, TURRET_UPGRADES, buildTurretModel, type TurretUpgradeId } from './world/turrets';
import { clamp } from './core/util';

const $ = (id: string) => document.getElementById(id)!;

type Cat = WeaponClass | 'all';
type Tab = 'weapons' | 'turret' | 'barricade';
const CATS: Cat[] = ['all', 'pistol', 'smg', 'rifle', 'shotgun', 'lmg', 'sniper', 'launcher', 'wonder'];

function statBars(d: WeaponDef): [string, number][] {
  const dmg = d.chain ? d.damage : d.projectile ? d.projectile.splashDamage : d.damage * d.pellets;
  const rpm = rpmOf(d);
  return [
    ['伤害', clamp(Math.sqrt(dmg / 1800), 0.06, 1)],
    ['射速', clamp(rpm / 1100, 0.05, 1)],
    ['弹匣', clamp(Math.sqrt(d.mag / 125), 0.08, 1)],
    ['机动', clamp((d.move - 0.8) / 0.25, 0.1, 1)],
  ];
}

function rpmOf(d: WeaponDef) {
  if (d.burst) return (60 * d.burst) / (d.interval * (d.burst - 1) + (d.burstDelay ?? 0.25));
  return 60 / d.interval;
}

function tagsOf(d: WeaponDef) {
  const t: string[] = [];
  if (d.chain) t.push('连锁闪电');
  else if (d.projectile?.kind === 'rocket') t.push('火箭弹');
  else if (d.projectile) t.push('能量弹');
  else if (d.burst) t.push(`${d.burst} 连发`);
  else if (d.auto) t.push('全自动');
  else t.push('半自动');
  if (d.pellets > 1) t.push(`${d.pellets} 颗弹丸`);
  if (d.penetrate > 0) t.push(`穿透 ${d.penetrate}`);
  if (d.projectile) t.push('范围伤害');
  t.push(`${Math.round(rpmOf(d))} 发/分`);
  return t;
}

/**
 * 商店页面：按 B 打开，游戏暂停。
 * 武器页可以选择“买来的枪替换哪个槽位”，路障页升级全部窗户。
 */
export class Shop {
  private thumbs = new Map<string, string>();
  private tab: Tab = 'weapons';
  private turretMsg: { text: string; ok: boolean } | null = null;
  private cat: Cat = 'all';
  private slot = 0;

  constructor(private game: Game) {
    $('shop-tabs').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab as Tab;
      this.turretMsg = null;
      this.render();
    });
    $('shop-cats').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
      if (!b) return;
      this.cat = b.dataset.cat as Cat;
      this.render();
    });
    $('shop-loadout').addEventListener('click', (e) => {
      const sell = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sell]');
      if (sell) {
        if (!sell.disabled) this.game.sellWeapon(Number(sell.dataset.sell));
        this.render();
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (!b) return;
      this.slot = Number(b.dataset.slot);
      this.render();
    });
    $('shop-grid').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (!b || b.disabled) return;
      this.game.buyWeapon(b.dataset.buy!, this.slot);
      this.render();
    });
    $('shop-upgrades').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-upg]');
      if (!b || b.disabled) return;
      this.game.buyUpgrade(b.dataset.upg as UpgradeId);
      this.render();
    });
    $('shop-turret').addEventListener('click', (e) => {
      const up = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tupg]');
      if (up) {
        if (!up.disabled) this.game.buyTurretUpgrade(up.dataset.tupg as TurretUpgradeId);
        this.turretMsg = null;
        this.render();
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-turret]');
      if (!b || b.disabled) return;
      const err = this.game.buyTurret();
      this.turretMsg = err ? { text: err, ok: false } : { text: '已买下。按 B 回到游戏，挑好位置按左键或 F 放下', ok: true };
      this.render();
    });
    $('shop-close').addEventListener('click', () => this.game.closeShop(true));
  }

  open() {
    this.renderThumbs();
    this.slot = this.game.weapons.cur;
    this.turretMsg = null;
    $('shop').classList.remove('hidden');
    this.render();
  }

  close() {
    $('shop').classList.add('hidden');
  }

  render() {
    const g = this.game;
    $('shop-points').textContent = String(g.points);
    document.querySelectorAll<HTMLElement>('#shop-tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
    $('tab-weapons').classList.toggle('hidden', this.tab !== 'weapons');
    $('tab-turret').classList.toggle('hidden', this.tab !== 'turret');
    $('tab-barricade').classList.toggle('hidden', this.tab !== 'barricade');
    if (this.tab === 'weapons') this.renderWeapons();
    else if (this.tab === 'turret') this.renderTurret();
    else this.renderUpgrades();
  }

  private renderWeapons() {
    const g = this.game;
    const owned = g.weapons.owned;
    const full = owned.length >= MAX_GUNS;
    this.slot = Math.min(this.slot, owned.length - 1);
    $('shop-loadout').innerHTML =
      `<span class="lbl">${full ? '买新枪会替换：' : `还有 ${MAX_GUNS - owned.length} 个空槽位，新枪会放进去`}</span>` +
      Array.from({ length: MAX_GUNS }, (_, i) => {
        const o = owned[i];
        const sel = full && i === this.slot ? ' sel' : '';
        const sell = o
          ? `<button class="sell" data-sell="${i}" ${owned.length > 1 ? '' : 'disabled title="最后一把枪不能卖"'}>出售 +${g.weapons.sellPrice(o)}</button>`
          : '';
        return `<span class="slot-wrap"><button class="slot${sel}" data-slot="${i}" ${full ? '' : 'disabled'}><kbd>${i + 1}</kbd>${o ? o.def.name : '空槽位'}</button>${sell}</span>`;
      }).join('');

    $('shop-cats').innerHTML = CATS.map((c) => {
      const n = c === 'all' ? Object.keys(WEAPONS).length : Object.values(WEAPONS).filter((w) => w.cls === c).length;
      return `<button data-cat="${c}" class="${c === this.cat ? 'active' : ''}">${c === 'all' ? '全部' : CLASS_NAMES[c]}<small>${n}</small></button>`;
    }).join('');

    const list = Object.values(WEAPONS).filter((w) => this.cat === 'all' || w.cls === this.cat);
    $('shop-grid').innerHTML = list
      .map((d) => {
        const has = g.weapons.has(d.id);
        const afford = g.points >= d.cost;
        let state = '';
        let label: string;
        let disabled = false;
        if (!d.shop) {
          state = 'boxonly';
          label = '神秘箱专属';
          disabled = true;
        } else if (has) {
          state = 'owned';
          label = '已拥有';
          disabled = true;
        } else if (!afford) {
          state = 'poor';
          label = `${d.cost} 积分`;
          disabled = true;
        } else label = `购买 · ${d.cost}`;
        const bars = statBars(d)
          .map(([k, v]) => `<div class="bar"><span>${k}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`)
          .join('');
        const tags = tagsOf(d).map((t) => `<em>${t}</em>`).join('');
        return `<div class="card ${state}">
          <div class="thumb"><img src="${this.thumbs.get(d.id) ?? ''}" alt="" /></div>
          <div class="row"><b>${d.name}</b><span class="cls">${CLASS_NAMES[d.cls]}</span></div>
          <div class="desc">${d.desc}</div>
          <div class="tags">${tags}<em>弹匣 ${d.mag}</em></div>
          <div class="bars">${bars}</div>
          <button class="buy" data-buy="${d.id}" ${disabled ? 'disabled' : ''}>${label}</button>
        </div>`;
      })
      .join('');
  }

  private renderTurret() {
    const g = this.game;
    const list = g.turrets.list;
    const carry = g.turrets.carry;
    const max = g.turrets.maxAmmo;
    const auto = g.turrets.upgrades.autoload > 0;
    const count = g.turrets.count;
    const poor = g.points < TURRET.cost;
    const label = carry ? '先放下手上的机枪' : poor ? `${TURRET.cost} 积分` : `购买 · ${TURRET.cost}`;
    const p = g.player.pos;
    const deployed = list.length
      ? list
          .map((t, i) => {
            const d = Math.round(Math.hypot(t.pos.x - p.x, t.pos.z - p.z));
            const status = t.carried
              ? '搬运中'
              : t.reloadT >= 0
                ? '上弹中'
                : t.ammo <= 0
                  ? auto ? '没子弹了，即将自动上弹' : '没子弹了，需要上弹'
                  : `弹药 ${t.ammo} / ${max}`;
            const cls = t.ammo <= 0 && t.reloadT < 0 ? ' empty' : '';
            const frac = t.reloadT >= 0 ? 1 - t.reloadT / TURRET.reload : Math.min(1, t.ammo / max);
            return `<div class="dep${cls}"><b>#${i + 1}</b><span>${status}</span><i><s style="width:${Math.round(frac * 100)}%"></s></i><em>距你 ${d} 米</em></div>`;
          })
          .join('')
      : '';
    const pending = carry && !carry.turret ? '<div class="dep pending"><b>新</b><span>刚买的机枪，回到游戏里放下</span><i></i><em>搬运中</em></div>' : '';
    const deployedHtml = list.length || pending ? deployed + pending : '<div class="dep none">还没有部署自动机枪。</div>';
    const msg = this.turretMsg ? `<div class="msg ${this.turretMsg.ok ? 'ok' : 'err'}">${this.turretMsg.text}</div>` : '';
    const reloadText = auto ? '打空后自动上弹' : '打空后走过去短按 <kbd>F</kbd> 上弹';
    $('shop-turret').innerHTML = `
      <div class="turret-top">
      <div class="card turret${poor ? ' poor' : ''}">
        <div class="thumb"><img src="${this.thumbs.get('turret') ?? ''}" alt="" /></div>
        <div class="row"><b>自动机枪</b><span class="cls">部署装备</span></div>
        <div class="desc">买下后回到游戏，面前会出现虚影，选好位置按左键或 <kbd>F</kbd> 放下（右键取消并退款）。
          自动扫射 ${TURRET.range} 米内看得见的丧尸，一次装 ${max} 发，${reloadText}；
          按住 <kbd>F</kbd> 可以搬到别处。机枪打中 +10 分，击杀 +50 分。</div>
        <div class="tags"><em>${Math.round(60 / TURRET.interval)} 发/分</em><em>每发 ${g.turrets.damage} 伤害</em><em>射程 ${TURRET.range} 米</em><em>上弹 ${TURRET.reload} 秒</em><em>数量不限</em></div>
        <button class="buy" data-turret ${carry || poor ? 'disabled' : ''}>${label}</button>
        ${msg}
      </div>
      <div class="deployed">
        <h3>已部署 <small>${count} 台</small></h3>
        ${deployedHtml}
      </div>
      </div>
      <h3 class="turret-upg-title">机枪升级 <small>对所有机枪生效，包括以后买的</small></h3>
      <div class="upgrades">${this.turretUpgradeCards()}</div>`;
  }

  private turretUpgradeCards() {
    const lv = this.game.turrets.upgrades;
    return (Object.keys(TURRET_UPGRADES) as TurretUpgradeId[])
      .map((id) => {
        const u = TURRET_UPGRADES[id];
        const next = u.levels[lv[id]];
        const btn = next ? `<button class="buy" data-tupg="${id}" ${this.game.points < next.cost ? 'disabled' : ''}>升级 · ${next.cost}</button>` : '';
        return this.upgradeCard(u, lv[id], btn);
      })
      .join('');
  }

  private upgradeCard(u: { name: string; icon: string; base: string; levels: { cost: number; name: string; desc: string }[] }, cur: number, buyBtn: string) {
    const next = u.levels[cur];
    const pips = u.levels.map((_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('');
    const curText = cur === 0 ? u.base : `${u.levels[cur - 1].name}：${u.levels[cur - 1].desc}`;
    const btn = next ? buyBtn : `<button class="buy" disabled>已满级</button>`;
    return `<div class="upg${next ? '' : ' maxed'}">
      <div class="upg-head"><span class="ico">${u.icon}</span><b>${u.name}</b><span class="pips">${pips}</span></div>
      <div class="upg-cur"><span>当前</span>${curText}</div>
      <div class="upg-next">${next ? `<span>下一级 · ${next.name}</span>${next.desc}` : '<span>已满级</span>这条线已经升满了。'}</div>
      ${btn}
    </div>`;
  }

  private renderUpgrades() {
    const g = this.game;
    const lv = g.level.upgrades;
    $('shop-upgrades').innerHTML = (Object.keys(UPGRADES) as UpgradeId[])
      .map((id) => {
        const u = UPGRADES[id];
        const next = u.levels[lv[id]];
        const btn = next ? `<button class="buy" data-upg="${id}" ${g.points < next.cost ? 'disabled' : ''}>升级 · ${next.cost}</button>` : '';
        return this.upgradeCard(u, lv[id], btn);
      })
      .join('');
  }

  /** 缩略图渲染用的离屏场景，渲染完全部缩略图后释放 */
  private thumbRig: {
    rt: THREE.WebGLRenderTarget;
    scene: THREE.Scene;
    cam: THREE.OrthographicCamera;
    buf: Uint8Array;
    ctx: CanvasRenderingContext2D;
    img: ImageData;
    queue: [string, () => THREE.Object3D][];
  } | null = null;
  private static readonly TW = 480;
  private static readonly TH = 200;

  /** 菜单界面空闲时一把一把地预渲染缩略图，第一次打开商店就不会卡一下 */
  prewarmThumbs() {
    const step = () => {
      if (this.renderNextThumb()) setTimeout(step, 40);
    };
    setTimeout(step, 300);
  }

  /** 把还没渲染的缩略图一次性渲染完 */
  private renderThumbs() {
    while (this.renderNextThumb());
  }

  /** 用游戏渲染器离屏渲染一把枪的侧视图。返回是否还有没渲染的 */
  private renderNextThumb(): boolean {
    const W = Shop.TW, H = Shop.TH;
    if (!this.thumbRig) {
      if (this.thumbs.size) return false;
      const rt = new THREE.WebGLRenderTarget(W, H);
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.environment = this.game.vmScene.environment;
      scene.environmentIntensity = 0.7;
      scene.add(new THREE.AmbientLight(0xffffff, 0.5));
      const key = new THREE.DirectionalLight(0xfff0dd, 2.4);
      key.position.set(1, 3, 4);
      const rim = new THREE.DirectionalLight(0x9fb8ff, 1.2);
      rim.position.set(-2, 1, -3);
      scene.add(key, rim);
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      const queue: [string, () => THREE.Object3D][] = Object.values(WEAPONS).map((d) => [d.id, () => buildGun(d.model, false).group]);
      queue.push(['turret', () => buildTurretModel().group]);
      this.thumbRig = {
        rt, scene, ctx, queue,
        cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20),
        buf: new Uint8Array(W * H * 4),
        img: ctx.createImageData(W, H),
      };
    }
    const rig = this.thumbRig;
    const item = rig.queue.shift();
    if (!item) {
      rig.rt.dispose();
      this.thumbRig = null;
      return false;
    }
    const [id, make] = item;
    const r = this.game.renderer;
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevTarget = r.getRenderTarget();
    const model = make();
    const wrap = new THREE.Group();
    model.rotation.y = -Math.PI / 2; // 枪口朝右
    wrap.add(model);
    wrap.rotation.set(0.22, 0, 0.04);
    rig.scene.add(wrap);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const aspect = W / H;
    const halfW = Math.max(size.x / 2, (size.y / 2) * aspect) * 1.12;
    const cam = rig.cam;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfW / aspect;
    cam.bottom = -halfW / aspect;
    cam.position.set(center.x, center.y, center.z + 5);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    r.setRenderTarget(rig.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(rig.scene, cam);
    r.readRenderTargetPixels(rig.rt, 0, 0, W, H, rig.buf);
    // WebGL 读出来是上下颠倒的
    for (let y = 0; y < H; y++) rig.img.data.set(rig.buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    rig.ctx.putImageData(rig.img, 0, 0);
    this.thumbs.set(id, rig.ctx.canvas.toDataURL('image/png'));
    rig.scene.remove(wrap);
    wrap.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    return true;
  }
}
