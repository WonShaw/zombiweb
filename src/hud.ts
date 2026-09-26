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
    mag: $('mag'),
    prompt: $('prompt'),
    promptBar: $('prompt-bar'),
    announce: $('announce'),
    annBig: $('ann-big'),
    annSmall: $('ann-small'),
    hit: $('hitmarker'),
    cross: $('crosshair'),
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
  private last = { points: -1, wname: '', mag: -1, prompt: '' as string | null, round: -1 };
  private hitT = 0;
  private annT = 0;
  private flashT = 0;
  private puIcons: Record<string, HTMLDivElement> = {};

  constructor(private game: Game) {
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

  hitmarker(kill: boolean) {
    this.hitT = 0.18;
    this.el.hit.classList.toggle('kill', kill);
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
    const L = this.last;
    if (g.points !== L.points) {
      L.points = g.points;
      this.el.points.textContent = String(g.points);
    }
    const w = g.weapons.current;
    if (w.def.name !== L.wname) {
      L.wname = w.def.name;
      this.el.wname.textContent = w.def.name;
    }
    if (w.mag !== L.mag) {
      L.mag = w.mag;
      this.el.mag.textContent = String(w.mag);
      this.el.mag.classList.toggle('low', w.mag === 0 || (w.def.mag > 2 && w.mag <= Math.ceil(w.def.mag * 0.25)));
    }
    const needReload = w.mag <= Math.ceil(w.def.mag * 0.25) && w.def.mag > 2 && !g.weapons.reloading;
    this.el.reloadHint.textContent = needReload ? '按 R 换弹' : '';

    // 准星：随散布张开，开镜/冲刺时隐藏
    const cam = g.camera;
    const px = (g.weapons.spreadNow * (window.innerHeight / 2)) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const gap = Math.min(80, 5 + px);
    this.el.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    this.el.cross.style.opacity = String(Math.max(0, 1 - g.weapons.adsT * 2.5) * (g.player.sprinting || g.weapons.busy ? 0 : 1));

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
