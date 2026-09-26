import * as THREE from 'three';
import type { Game } from './game';
import { PERKS } from './weapons/defs';
import type { PerkId } from './world/map';
import * as TX from './core/textures';
import type { PowerupKind } from './core/textures';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** 回合数 1–5 用粉笔计数线，之后用数字 */
function tallySvg(n: number) {
  const lines: string[] = [];
  const stroke = (x1: number, y1: number, x2: number, y2: number) =>
    `<path d="M${x1} ${y1} Q ${(x1 + x2) / 2 + 3} ${(y1 + y2) / 2} ${x2} ${y2}" />`;
  const count = Math.min(n, 4);
  for (let i = 0; i < count; i++) {
    const x = 14 + i * 20;
    lines.push(stroke(x + (i % 2 ? 2 : -1), 8, x + (i % 2 ? -2 : 2), 92));
  }
  if (n >= 5) lines.push(stroke(2, 70, 90, 26));
  return `<svg viewBox="0 0 100 100" class="tally">${lines.join('')}</svg>`;
}

export class Hud {
  private el = {
    hud: $('hud'),
    points: $('points'),
    popups: $('popups'),
    round: $('round'),
    wname: $('wname'),
    weapon: $('weapon'),
    loadout: $('loadout'),
    mag: $('mag'),
    prompt: $('prompt'),
    promptBar: $('prompt-bar'),
    announce: $('announce'),
    annBig: $('ann-big'),
    annSmall: $('ann-small'),
    hit: $('hitmarker'),
    cross: $('crosshair'),
    scope: $('scope'),
    damage: $('damage'),
    flash: $('flash'),
    hurtdir: $('hurtdir'),
    perks: $('perks'),
    powerups: $('powerups'),
    reloadHint: $('reload-hint'),
    menu: $('menu'),
    pause: $('pause'),
    over: $('gameover'),
    overRound: $('over-round'),
    overStats: $('over-stats'),
  };
  private last = { points: -1, wname: '', mag: -1, prompt: '' as string | null, round: -1, loadout: '' };
  private hitT = 0;
  private annT = 0;
  private flashT = 0;
  private puIcons: Record<string, HTMLDivElement> = {};

  private scopeKind: string | null = null;

  constructor(private game: Game) {
    // 三种瞄准镜分划（坐标以镜头中心为原点，半径 500）
    this.el.scope.innerHTML = `
      <svg class="aug" viewBox="-500 -500 1000 1000"><circle r="58" fill="none" stroke="#000" stroke-width="9"/><circle r="5" fill="#000"/></svg>
      <svg class="acog" viewBox="-500 -500 1000 1000">
        <path d="M-30 26 L0 -4 L30 26" fill="none" stroke="#ff3a20" stroke-width="6" stroke-linejoin="miter" style="filter:drop-shadow(0 0 4px #ff2a10)"/>
        <line x1="0" y1="30" x2="0" y2="230" stroke="#111" stroke-width="3"/>
        <g stroke="#111" stroke-width="3"><line x1="-22" y1="80" x2="22" y2="80"/><line x1="-17" y1="125" x2="17" y2="125"/><line x1="-12" y1="170" x2="12" y2="170"/><line x1="-8" y1="210" x2="8" y2="210"/></g>
      </svg>
      <svg class="sniper" viewBox="-500 -500 1000 1000">
        <g stroke="#000"><line x1="-500" y1="0" x2="500" y2="0" stroke-width="2"/><line x1="0" y1="-500" x2="0" y2="500" stroke-width="2"/>
        <line x1="-500" y1="0" x2="-170" y2="0" stroke-width="10"/><line x1="170" y1="0" x2="500" y2="0" stroke-width="10"/><line x1="0" y1="170" x2="0" y2="500" stroke-width="10"/></g>
        <g fill="#000">${[-120, -80, -40, 40, 80, 120].map((d) => `<circle cx="${d}" r="4"/><circle cy="${d}" r="4"/>`).join('')}</g>
        <circle r="3" fill="#e0281a"/>
      </svg>`;
    for (const k of ['instakill', 'double', 'firesale'] as PowerupKind[]) {
      const d = document.createElement('div');
      d.className = 'pu hidden';
      const img = document.createElement('img');
      img.src = (TX.powerupTexture(k).image as HTMLCanvasElement).toDataURL();
      d.appendChild(img);
      const t = document.createElement('span');
      d.appendChild(t);
      this.el.powerups.appendChild(d);
      this.puIcons[k] = d;
    }
  }

  show(on: boolean) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  showMenu(which: 'menu' | 'pause' | 'over' | null) {
    this.el.menu.classList.toggle('hidden', which !== 'menu');
    this.el.pause.classList.toggle('hidden', which !== 'pause');
    this.el.over.classList.toggle('hidden', which !== 'over');
  }

  showGameOver(round: number, stats: Game['stats']) {
    this.el.overRound.textContent = `你坚持到了第 ${round} 回合`;
    const m = Math.floor(stats.time / 60), s = Math.floor(stats.time % 60);
    const acc = stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
    this.el.overStats.innerHTML = [
      ['击杀', stats.kills],
      ['爆头', stats.headshots],
      ['累计积分', stats.earned],
      ['命中率', `${acc}%`],
      ['存活时间', `${m}:${String(s).padStart(2, '0')}`],
    ]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('');
    this.show(false);
    this.showMenu('over');
  }

  popup(n: number) {
    const d = document.createElement('div');
    d.className = 'popup' + (n < 0 ? ' neg' : '');
    d.textContent = n > 0 ? `+${n}` : `${n}`;
    d.style.setProperty('--dx', `${-30 - Math.random() * 50}px`);
    d.style.setProperty('--dy', `${-20 - Math.random() * 40}px`);
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }

  private mergedPts = 0;
  private mergedT = 0;

  /** 攒起来，每 0.4 秒飘一次总数 */
  popupMerged(n: number) {
    if (this.mergedPts === 0) this.mergedT = 0.4;
    this.mergedPts += n;
  }

  deny() {
    this.el.points.classList.remove('deny');
    void this.el.points.offsetWidth;
    this.el.points.classList.add('deny');
  }

  setRound(n: number, animate: boolean) {
    if (n === this.last.round) return;
    this.last.round = n;
    this.el.round.innerHTML = n <= 5 ? tallySvg(n) : `<span class="num">${n}</span>`;
    if (animate) {
      this.el.round.classList.remove('pulse');
      void this.el.round.offsetWidth;
      this.el.round.classList.add('pulse');
    }
  }

  roundEnding() {
    this.el.round.classList.remove('pulse');
    void this.el.round.offsetWidth;
    this.el.round.classList.add('ending');
    setTimeout(() => this.el.round.classList.remove('ending'), 8000);
  }

  /** 显示 / 隐藏全屏瞄准镜画面 */
  setScope(kind: string | null) {
    if (kind === this.scopeKind) return;
    this.scopeKind = kind;
    this.el.scope.className = kind ? `on ${kind}` : '';
  }

  setPrompt(text: string | null) {
    if (text === this.last.prompt) return;
    this.last.prompt = text;
    this.el.prompt.textContent = text ?? '';
    this.el.prompt.classList.toggle('hidden', !text);
  }

  /** 按住 F 的进度条（null 隐藏） */
  setPromptProgress(frac: number | null) {
    this.el.promptBar.classList.toggle('hidden', frac === null);
    if (frac !== null) (this.el.promptBar.firstElementChild as HTMLElement).style.width = `${Math.round(frac * 100)}%`;
  }

  hitmarker(kill: boolean, head = false) {
    this.hitT = kill ? 0.32 : 0.18;
    this.el.hit.classList.toggle('kill', kill);
    this.el.hit.classList.toggle('head', head);
    // 重新触发放大动画
    this.el.hit.classList.remove('pop');
    void this.el.hit.offsetWidth;
    this.el.hit.classList.add('pop');
  }

  announce(big: string, small = '') {
    this.el.annBig.textContent = big;
    this.el.annSmall.textContent = small;
    this.annT = 2.6;
  }

  flash() {
    this.flashT = 1;
  }

  setPerks(ids: PerkId[]) {
    this.el.perks.innerHTML = ids
      .map((id) => `<div class="perk" style="--c:${PERKS[id].hud}" title="${PERKS[id].name}">${PERKS[id].icon}</div>`)
      .join('');
  }

  update(dt: number) {
    const g = this.game;
    if (this.mergedPts) {
      this.mergedT -= dt;
      if (this.mergedT <= 0) {
        this.popup(this.mergedPts);
        this.mergedPts = 0;
      }
    }
    const L = this.last;
    if (g.points !== L.points) {
      L.points = g.points;
      this.el.points.textContent = String(g.points);
    }
    const w = g.weapons.current;
    // 右下角的武器列表：当前这把高亮，最后一行是近战武器
    const ws = g.weapons;
    const melee = ws.meleeOut;
    const key = ws.owned.map((o) => o.def.id).join(',') + '|' + ws.cur + '|' + ws.melee.id + '|' + melee;
    if (key !== L.loadout) {
      L.loadout = key;
      this.el.loadout.innerHTML =
        ws.owned.map((o, i) => `<div class="lo${!melee && i === ws.cur ? ' cur' : ''}"><kbd>${i + 1}</kbd>${o.def.name}</div>`).join('') +
        `<div class="lo${melee ? ' cur' : ''}"><kbd>V</kbd>${ws.melee.name}</div>` +
        `<div class="lo-hint">Q / E 切换${ws.owned.length > 1 ? ' · 按住 G 出售' : ''}</div>`;
    }
    const name = melee ? ws.melee.name : w.def.name;
    if (name !== L.wname) {
      L.wname = name;
      this.el.wname.textContent = name;
    }
    const mag = melee ? -2 : w.mag;
    if (mag !== L.mag) {
      L.mag = mag;
      this.el.weapon.classList.toggle('melee', melee);
      this.el.mag.textContent = melee ? '左键轻击 · 右键重击' : String(w.mag);
      this.el.mag.classList.toggle('low', !melee && (w.mag === 0 || (w.def.mag > 2 && w.mag <= Math.ceil(w.def.mag * 0.25))));
    }
    const needReload = !melee && w.mag <= Math.ceil(w.def.mag * 0.25) && w.def.mag > 2 && !g.weapons.reloading;
    this.el.reloadHint.textContent = needReload ? '按 R 换弹' : '';

    // 准星：随散布张开，开镜/冲刺时隐藏
    const cam = g.camera;
    const px = (g.weapons.spreadNow * (window.innerHeight / 2)) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const gap = Math.min(80, 5 + px);
    this.el.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    this.el.cross.style.opacity = String(Math.max(0, 1 - g.weapons.adsT * 2.5) * (g.player.sprinting || (g.weapons.busy && !g.weapons.swinging) ? 0 : 1));

    this.hitT -= dt;
    this.el.hit.style.opacity = this.hitT > 0 ? '1' : '0';

    this.annT -= dt;
    this.el.announce.style.opacity = String(Math.max(0, Math.min(1, this.annT / 0.5)));

    this.flashT = Math.max(0, this.flashT - dt * 0.7);
    this.el.flash.style.opacity = String(this.flashT);

    const pl = g.player;
    const hurt = 1 - pl.health / pl.maxHealth;
    this.el.damage.style.opacity = String(Math.min(1, hurt * 1.1 + pl.hurtFlash * 0.4));
    this.el.hurtdir.style.opacity = String(Math.min(1, pl.hurtDirT));
    this.el.hurtdir.style.transform = `translate(-50%, -50%) rotate(${-pl.hurtAngle}rad)`;

    const pu = g.powerups;
    this.updatePu('instakill', pu.instakill);
    this.updatePu('double', pu.double);
    this.updatePu('firesale', pu.firesale);
  }

  private updatePu(k: string, t: number) {
    const d = this.puIcons[k];
    d.classList.toggle('hidden', t <= 0);
    if (t > 0) {
      (d.lastChild as HTMLElement).textContent = String(Math.ceil(t));
      d.classList.toggle('blink', t < 5);
    }
  }
}
