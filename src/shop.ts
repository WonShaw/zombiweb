import * as THREE from 'three';
import type { Game } from './game';
import { WEAPONS, CLASS_NAMES, UPGRADES, type WeaponDef, type WeaponClass, type UpgradeId } from './weapons/defs';
import { buildGun } from './weapons/models';
import { clamp } from './core/util';

const $ = (id: string) => document.getElementById(id)!;

type Cat = WeaponClass | 'all';
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
  private tab: 'weapons' | 'barricade' = 'weapons';
  private cat: Cat = 'all';
  private slot = 0;

  constructor(private game: Game) {
    $('shop-tabs').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab as 'weapons' | 'barricade';
      this.render();
    });
    $('shop-cats').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
      if (!b) return;
      this.cat = b.dataset.cat as Cat;
      this.render();
    });
    $('shop-loadout').addEventListener('click', (e) => {
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
    $('shop-close').addEventListener('click', () => this.game.closeShop(true));
  }

  open() {
    if (!this.thumbs.size) this.renderThumbs();
    this.slot = this.game.weapons.cur;
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
    $('tab-barricade').classList.toggle('hidden', this.tab !== 'barricade');
    if (this.tab === 'weapons') this.renderWeapons();
    else this.renderUpgrades();
  }

  private renderWeapons() {
    const g = this.game;
    const owned = g.weapons.owned;
    const full = owned.length >= 2;
    $('shop-loadout').innerHTML =
      `<span class="lbl">${full ? '买新枪会替换：' : '有空槽位，新枪会放进去'}</span>` +
      [0, 1]
        .map((i) => {
          const o = owned[i];
          const sel = full && i === this.slot ? ' sel' : '';
          return `<button class="slot${sel}" data-slot="${i}" ${full ? '' : 'disabled'}><kbd>${i + 1}</kbd>${o ? o.def.name : '空槽位'}</button>`;
        })
        .join('');

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

  private renderUpgrades() {
    const g = this.game;
    const lv = g.level.upgrades;
    $('shop-upgrades').innerHTML = (Object.keys(UPGRADES) as UpgradeId[])
      .map((id) => {
        const u = UPGRADES[id];
        const cur = lv[id];
        const next = u.levels[cur];
        const pips = u.levels.map((_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('');
        const curText = cur === 0 ? u.base : `${u.levels[cur - 1].name}：${u.levels[cur - 1].desc}`;
        const btn = next
          ? `<button class="buy" data-upg="${id}" ${g.points < next.cost ? 'disabled' : ''}>升级 · ${next.cost}</button>`
          : `<button class="buy" disabled>已满级</button>`;
        return `<div class="upg${next ? '' : ' maxed'}">
          <div class="upg-head"><span class="ico">${u.icon}</span><b>${u.name}</b><span class="pips">${pips}</span></div>
          <div class="upg-cur"><span>当前</span>${curText}</div>
          <div class="upg-next">${next ? `<span>下一级 · ${next.name}</span>${next.desc}` : '<span>已满级</span>这条线已经升满了。'}</div>
          ${btn}
        </div>`;
      })
      .join('');
  }

  /** 用游戏渲染器离屏渲染每把枪的侧视图做缩略图 */
  private renderThumbs() {
    const r = this.game.renderer;
    const W = 480, H = 200;
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
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    const buf = new Uint8Array(W * H * 4);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();

    for (const d of Object.values(WEAPONS)) {
      const m = buildGun(d.model, false);
      const wrap = new THREE.Group();
      m.group.rotation.y = -Math.PI / 2; // 枪口朝右
      wrap.add(m.group);
      wrap.rotation.set(0.22, 0, 0.04);
      scene.add(wrap);
      wrap.updateMatrixWorld(true);
      box.setFromObject(wrap);
      box.getSize(size);
      box.getCenter(center);
      const aspect = W / H;
      const halfW = Math.max(size.x / 2, (size.y / 2) * aspect) * 1.12;
      cam.left = -halfW;
      cam.right = halfW;
      cam.top = halfW / aspect;
      cam.bottom = -halfW / aspect;
      cam.position.set(center.x, center.y, center.z + 5);
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      // WebGL 读出来是上下颠倒的
      for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      ctx.putImageData(img, 0, 0);
      this.thumbs.set(d.id, canvas.toDataURL('image/png'));
      scene.remove(wrap);
      wrap.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    r.setRenderTarget(null);
    r.setClearColor(prevColor, prevAlpha);
    rt.dispose();
  }
}
