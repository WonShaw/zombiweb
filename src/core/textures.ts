import * as THREE from 'three';
import { seeded } from './util';

/**
 * 所有贴图都在运行时用 canvas 程序化生成：墙面、地板、木板、箱子、招牌、图标……
 * 不需要任何外部图片素材。
 */

type Rand = () => number;

function mk(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return { c, g };
}

/** 可平铺的多倍频值噪声，返回 0..1 */
function noiseField(w: number, h: number, cellsX: number, cellsY: number, octaves: number, r: Rand): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const gx = cellsX << o;
    const gy = cellsY << o;
    const grid = new Float32Array(gx * gy);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * gy;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % gy) * gx;
      const r1 = ((y0 + 1) % gy) * gx;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * gx;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % gx;
        const a = grid[r0 + x0] + (grid[r0 + x1] - grid[r0 + x0]) * sx;
        const b = grid[r1 + x0] + (grid[r1 + x1] - grid[r1 + x0]) * sx;
        out[y * w + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function tex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const c255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** 墙面：上半米黄灰泥、下半军绿墙裙、踢脚线、水渍和裂缝。纹理覆盖 4m 宽 × 3m 高 */
export function wallTexture() {
  const W = 1024;
  const H = 768;
  const r = seeded(11);
  const { c, g } = mk(W, H);
  const blot = noiseField(W, H, 8, 6, 5, r);
  const grain = noiseField(W, H, 128, 96, 2, r);
  const img = g.createImageData(W, H);
  const d = img.data;
  const split = Math.round(H * (1 - 1.1 / 3));
  const base = Math.round(H * (1 - 0.14 / 3));
  for (let y = 0; y < H; y++) {
    const fy = y / H;
    const grime = fy > 0.78 ? 1 - (fy - 0.78) * 1.6 : 1;
    const top = fy < 0.08 ? 0.7 + (fy / 0.08) * 0.3 : 1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const b = blot[i];
      const n = grain[i];
      let R: number, G: number, B: number;
      if (y >= base) {
        R = 44; G = 32; B = 22;
      } else if (y > split) {
        if (b > 0.74 && n > 0.5) {
          R = 80; G = 82; B = 72;
        } else {
          R = 60; G = 72; B = 60;
        }
      } else if (b < 0.3 && n > 0.55) {
        R = 104; G = 98; B = 86;
      } else {
        R = 142; G = 132; B = 110;
      }
      const shade = (0.7 + b * 0.55 + (n - 0.5) * 0.2) * grime * top;
      const o = i * 4;
      d[o] = c255(R * shade);
      d[o + 1] = c255(G * shade);
      d[o + 2] = c255(B * shade);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(28,24,18,0.85)';
  g.fillRect(0, split - 3, W, 7);
  g.fillStyle = 'rgba(150,140,110,0.25)';
  g.fillRect(0, split - 4, W, 1);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(0, base - 2, W, 3);
  for (let k = 0; k < 11; k++) {
    const x = r() * W;
    const w = 6 + r() * 34;
    const len = H * (0.2 + r() * 0.5);
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(48,38,22,0.4)');
    grad.addColorStop(1, 'rgba(48,38,22,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, w, len);
  }
  g.strokeStyle = 'rgba(18,16,12,0.6)';
  g.lineWidth = 1.3;
  for (let k = 0; k < 7; k++) {
    let x = r() * W;
    let y = r() * H * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 18; s++) {
      x += (r() - 0.5) * 22;
      y += r() * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // 两道干涸的血迹
  for (let k = 0; k < 2; k++) {
    const x = 60 + r() * (W - 120);
    const y = H * (0.3 + r() * 0.25);
    g.fillStyle = 'rgba(70,8,6,0.55)';
    for (let s = 0; s < 5; s++) {
      const len = 40 + r() * 140;
      g.fillRect(x + s * 7 + r() * 4, y + r() * 10, 3 + r() * 3, len);
    }
  }
  return tex(c);
}

/** 旧木地板：2m × 2m，10 条木板 */
export function floorTexture(dark = false) {
  const S = 512;
  const r = seeded(dark ? 33 : 21);
  const { c, g } = mk(S, S);
  const grain = noiseField(S, S, 4, 96, 3, r);
  const dirt = noiseField(S, S, 4, 4, 4, r);
  const rows = 10;
  const rowH = S / rows;
  const seams: number[][] = [];
  const tones: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const n = 1 + Math.floor(r() * 2);
    const s: number[] = [];
    for (let k = 0; k < n; k++) s.push(Math.floor(r() * S));
    s.sort((a, b) => a - b);
    seams.push(s);
    const t: number[] = [];
    for (let k = 0; k <= n; k++) t.push(0.7 + r() * 0.45);
    t[n] = t[0];
    tones.push(t);
  }
  const img = g.createImageData(S, S);
  const d = img.data;
  const baseC = dark ? [70, 56, 44] : [100, 70, 45];
  for (let y = 0; y < S; y++) {
    const row = Math.min(rows - 1, Math.floor(y / rowH));
    const within = y - row * rowH;
    const sm = seams[row];
    for (let x = 0; x < S; x++) {
      let si = 0;
      while (si < sm.length && sm[si] <= x) si++;
      const tone = tones[row][si];
      const i = y * S + x;
      let k = tone * (0.72 + grain[i] * 0.55) * (0.65 + dirt[i] * 0.55);
      if (within < 1.6 || within > rowH - 1.6) k *= 0.3;
      for (const sx of sm) if (Math.abs(x - sx) < 1.5) k *= 0.35;
      const o = i * 4;
      d[o] = c255(baseC[0] * k);
      d[o + 1] = c255(baseC[1] * k);
      d[o + 2] = c255(baseC[2] * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

/** 室外泥地 */
export function groundTexture() {
  const S = 512;
  const r = seeded(5);
  const { c, g } = mk(S, S);
  const blot = noiseField(S, S, 4, 4, 5, r);
  const patch = noiseField(S, S, 6, 6, 3, r);
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    const b = blot[i];
    const p = patch[i];
    let R = 56, G = 50, B = 42;
    if (p > 0.58) {
      R = 40; G = 50; B = 32;
    }
    const k = 0.55 + b * 0.7 + (r() - 0.5) * 0.12;
    const o = i * 4;
    d[o] = c255(R * k);
    d[o + 1] = c255(G * k);
    d[o + 2] = c255(B * k);
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 300; k++) {
    g.fillStyle = `rgba(${90 + r() * 40},${85 + r() * 30},${75 + r() * 30},0.5)`;
    g.beginPath();
    g.arc(r() * S, r() * S, 1 + r() * 2.5, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/**
 * 窗户路障用的板子：
 * 0 普通木板，1 厚木板，2 带铆钉厚木板，3 普通钢板，4 加厚钢板，5 带铆钉钢板
 */
export function plankTexture(variant: 0 | 1 | 2 | 3 | 4 | 5 = 0) {
  const W = 256;
  const H = 48;
  const r = seeded(9 + variant);
  const { c, g } = mk(W, H);
  const steel = variant >= 3;
  const grain = noiseField(W, H, steel ? 16 : 3, steel ? 4 : 24, 3, r);
  const img = g.createImageData(W, H);
  const d = img.data;
  const base = [
    [140, 104, 68],
    [112, 78, 48],
    [112, 78, 48],
    [112, 122, 136],
    [82, 90, 102],
    [106, 110, 118],
  ][variant];
  // 厚板和加厚钢板有明显的倒角：上沿亮、下沿暗
  const bevel = variant === 1 || variant === 2 || variant === 4 ? 6 : 3;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let k = steel ? 0.8 + grain[i] * 0.3 : 0.66 + grain[i] * (variant === 0 ? 0.55 : 0.7);
      if (y < bevel) k *= bevel > 3 ? 1.25 : 0.55;
      else if (y > H - 1 - bevel) k *= 0.5;
      if (steel && variant !== 5 && (x < 3 || x > W - 4)) k *= 0.6;
      const o = i * 4;
      d[o] = c255(base[0] * k);
      d[o + 1] = c255(base[1] * k);
      d[o + 2] = c255(base[2] * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const rivet = (x: number, y: number, rad: number) => {
    g.fillStyle = '#1e1e20';
    g.beginPath();
    g.arc(x, y, rad, 0, 7);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath();
    g.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.45, 0, 7);
    g.fill();
  };
  const scratches = (n: number, alpha: number) => {
    g.strokeStyle = `rgba(255,255,255,${alpha})`;
    g.lineWidth = 1;
    for (let k = 0; k < n; k++) {
      const x = r() * W, y = r() * H;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 10 + r() * 30, y + (r() - 0.5) * 6);
      g.stroke();
    }
  };
  switch (variant) {
    case 0:
      for (const x of [12, W - 14]) {
        rivet(x, H * 0.35, 3);
        rivet(x, H * 0.7, 3);
      }
      break;
    case 1:
      for (const x of [14, W / 2, W - 16]) rivet(x, H / 2, 3);
      break;
    case 2:
      for (const x of [8, W / 2 - 14, W - 36]) {
        g.fillStyle = '#35373b';
        g.fillRect(x, 0, 28, H);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x, 0, 28, 3);
        rivet(x + 14, H * 0.3, 4.5);
        rivet(x + 14, H * 0.72, 4.5);
      }
      break;
    case 3:
      scratches(14, 0.18);
      break;
    case 4:
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(W / 2 - 2, 0, 4, H);
      g.fillStyle = 'rgba(255,220,160,0.18)';
      for (let y = 4; y < H - 4; y += 5) g.fillRect(W / 2 - 3, y, 6, 2);
      scratches(8, 0.12);
      break;
    case 5:
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 3;
      g.strokeRect(2, 2, W - 4, H - 4);
      for (let x = 12; x < W; x += 34) {
        rivet(x, 9, 3.2);
        rivet(x, H - 9, 3.2);
      }
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(120,60,20,${0.2 + r() * 0.25})`;
        g.beginPath();
        g.ellipse(r() * W, r() * H, 6 + r() * 16, 3 + r() * 6, 0, 0, 7);
        g.fill();
      }
      break;
  }
  return tex(c);
}

/** 木门：竖木板 + 横撑 + 斜撑 + 铁合页 */
export function doorTexture() {
  const W = 256;
  const H = 512;
  const r = seeded(17);
  const { c, g } = mk(W, H);
  const grain = noiseField(W, H, 32, 4, 3, r);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const plank = Math.floor(x / 64);
      let k = (0.62 + grain[i] * 0.5) * (0.85 + ((plank * 37) % 10) / 40);
      const px = x % 64;
      if (px < 2 || px > 61) k *= 0.3;
      const o = i * 4;
      d[o] = c255(110 * k);
      d[o + 1] = c255(76 * k);
      d[o + 2] = c255(48 * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const brace = (y: number) => {
    g.fillStyle = 'rgba(70,46,28,1)';
    g.fillRect(0, y, W, 40);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, y + 38, W, 4);
  };
  brace(70);
  brace(400);
  g.save();
  g.translate(0, 110);
  g.rotate(Math.atan2(290, W));
  g.fillStyle = 'rgba(78,52,30,1)';
  g.fillRect(0, 0, Math.hypot(W, 290), 34);
  g.restore();
  g.fillStyle = '#1d1d1f';
  for (const y of [78, 408]) g.fillRect(0, y + 6, 70, 26);
  g.fillStyle = '#3a3a3c';
  for (const y of [78, 408]) for (let x = 10; x < 70; x += 18) {
    g.beginPath();
    g.arc(x, y + 19, 3, 0, 7);
    g.fill();
  }
  return tex(c, false);
}

/** 木箱 */
export function crateTexture() {
  const S = 256;
  const r = seeded(23);
  const { c, g } = mk(S, S);
  const grain = noiseField(S, S, 3, 32, 3, r);
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let k = 0.68 + grain[i] * 0.5;
      if (y % 64 < 2) k *= 0.35;
      const o = i * 4;
      d[o] = c255(122 * k);
      d[o + 1] = c255(92 * k);
      d[o + 2] = c255(58 * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(66,46,26,1)';
  g.lineWidth = 26;
  g.strokeRect(13, 13, S - 26, S - 26);
  g.save();
  g.beginPath();
  g.rect(26, 26, S - 52, S - 52);
  g.clip();
  g.lineWidth = 24;
  g.beginPath();
  g.moveTo(20, S - 20);
  g.lineTo(S - 20, 20);
  g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.strokeRect(26, 26, S - 52, S - 52);
  g.fillStyle = 'rgba(30,26,20,0.75)';
  g.font = 'bold 26px monospace';
  g.textAlign = 'center';
  g.fillText('MUNITION', S / 2, S / 2 + 50);
  return tex(c, false);
}

/** 神秘箱：木箱侧面 + 发光问号 */
export function boxTextures() {
  const W = 512;
  const H = 192;
  const r = seeded(41);
  const a = mk(W, H);
  const grain = noiseField(W, H, 4, 16, 3, r);
  const img = a.g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let k = 0.55 + grain[i] * 0.5;
      if (y % 48 < 2) k *= 0.35;
      const o = i * 4;
      d[o] = c255(82 * k);
      d[o + 1] = c255(56 * k);
      d[o + 2] = c255(38 * k);
      d[o + 3] = 255;
    }
  }
  a.g.putImageData(img, 0, 0);
  a.g.fillStyle = '#2b2b2e';
  for (const x of [0, W - 22]) a.g.fillRect(x, 0, 22, H);
  const e = mk(W, H);
  e.g.fillStyle = '#000';
  e.g.fillRect(0, 0, W, H);
  for (const ctx of [a.g, e.g]) {
    ctx.font = 'bold 150px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ctx === a.g ? '#9fe8ff' : '#ffffff';
    ctx.fillText('?', W * 0.3, H / 2 + 6);
    ctx.fillText('?', W * 0.7, H / 2 + 6);
  }
  const map = tex(a.c, false);
  const em = tex(e.c, false);
  return { map, emissive: em };
}

/** 饮料机招牌 */
export function perkSignTexture(name: string, color: string) {
  const W = 512;
  const H = 128;
  const { c, g } = mk(W, H);
  g.fillStyle = '#0c0a0a';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.strokeRect(8, 8, W - 16, H - 16);
  g.font = 'italic 900 64px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillStyle = color;
  g.fillText(name, W / 2, H / 2 + 3);
  g.shadowBlur = 0;
  g.fillStyle = '#fff';
  g.globalAlpha = 0.55;
  g.fillText(name, W / 2, H / 2 + 3);
  return tex(c, false);
}

export function glowTexture() {
  const S = 128;
  const { c, g } = mk(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return tex(c, false);
}

export function flashTexture() {
  const S = 128;
  const { c, g } = mk(S, S);
  g.translate(S / 2, S / 2);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.2, 'rgba(255,200,90,0.9)');
  grad.addColorStop(0.6, 'rgba(255,120,30,0.25)');
  grad.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = grad;
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7);
    g.beginPath();
    g.moveTo(-7, 0);
    g.lineTo(0, -S / 2);
    g.lineTo(7, 0);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, S * 0.22, 0, 7);
  g.fill();
  return tex(c, false);
}

export function dotTexture() {
  const S = 64;
  const { c, g } = mk(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return tex(c, false);
}

export function bulletHoleTexture() {
  const S = 64;
  const { c, g } = mk(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.25, 'rgba(10,8,6,0.95)');
  grad.addColorStop(0.4, 'rgba(40,34,28,0.6)');
  grad.addColorStop(1, 'rgba(40,34,28,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return tex(c, false);
}

export function bloodSplatTexture(seed: number) {
  const S = 256;
  const r = seeded(seed);
  const { c, g } = mk(S, S);
  g.fillStyle = 'rgba(80,6,4,0.9)';
  const blob = (x: number, y: number, rad: number) => {
    g.beginPath();
    g.arc(x, y, rad, 0, 7);
    g.fill();
  };
  blob(S / 2, S / 2, 30 + r() * 20);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const dist = 20 + r() * 90;
    blob(S / 2 + Math.cos(a) * dist, S / 2 + Math.sin(a) * dist, 2 + r() * 12 * (1 - dist / 120));
  }
  g.fillStyle = 'rgba(40,2,2,0.5)';
  blob(S / 2 + 5, S / 2 - 4, 18);
  return tex(c, false);
}

export type PowerupKind = 'carpenter' | 'instakill' | 'double' | 'nuke' | 'firesale';

export function powerupTexture(kind: PowerupKind) {
  const S = 256;
  const { c, g } = mk(S, S);
  g.translate(S / 2, S / 2);
  g.lineJoin = 'round';
  if (kind === 'carpenter') {
    // 锤子
    g.rotate(-0.6);
    g.fillStyle = '#8a5a30';
    g.fillRect(-12, -30, 24, 130);
    g.strokeStyle = '#3a2410';
    g.lineWidth = 5;
    g.strokeRect(-12, -30, 24, 130);
    g.fillStyle = '#9aa0a8';
    g.fillRect(-70, -78, 120, 50);
    g.beginPath();
    g.moveTo(50, -78);
    g.lineTo(88, -92);
    g.lineTo(78, -58);
    g.lineTo(50, -40);
    g.fill();
    g.strokeStyle = '#2a2d31';
    g.strokeRect(-70, -78, 120, 50);
  } else if (kind === 'firesale') {
    // 价格标签
    g.rotate(-0.25);
    g.fillStyle = '#e8342a';
    g.beginPath();
    g.moveTo(-100, -50);
    g.lineTo(60, -50);
    g.lineTo(105, 0);
    g.lineTo(60, 50);
    g.lineTo(-100, 50);
    g.closePath();
    g.fill();
    g.strokeStyle = '#5a0a06';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(68, 0, 9, 0, 7);
    g.fill();
    g.font = '900 60px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SALE', -18, 4);
  } else if (kind === 'instakill') {
    g.fillStyle = '#f0ece0';
    g.beginPath();
    g.arc(0, -18, 72, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-42, 30, 84, 50);
    g.fillStyle = '#111';
    g.beginPath();
    g.ellipse(-28, -14, 20, 24, 0, 0, 7);
    g.ellipse(28, -14, 20, 24, 0, 0, 7);
    g.fill();
    g.beginPath();
    g.moveTo(0, 16);
    g.lineTo(-10, 34);
    g.lineTo(10, 34);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#111';
    for (let x = -30; x <= 30; x += 15) {
      g.beginPath();
      g.moveTo(x, 52);
      g.lineTo(x, 80);
      g.stroke();
    }
  } else if (kind === 'double') {
    g.font = '900 150px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 14;
    g.strokeStyle = '#2a1a00';
    g.strokeText('x2', 0, 8);
    g.fillStyle = '#ffd23a';
    g.fillText('x2', 0, 8);
  } else {
    g.fillStyle = '#ffd400';
    g.beginPath();
    g.arc(0, 0, 100, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    for (let i = 0; i < 3; i++) {
      const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 3 - Math.PI / 6;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 88, a0, a0 + Math.PI / 3);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#ffd400';
    g.beginPath();
    g.arc(0, 0, 22, 0, 7);
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(0, 0, 14, 0, 7);
    g.fill();
  }
  return tex(c, false);
}

export function moonTexture() {
  const S = 256;
  const { c, g } = mk(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,250,235,1)');
  grad.addColorStop(0.28, 'rgba(240,235,215,1)');
  grad.addColorStop(0.32, 'rgba(180,190,220,0.35)');
  grad.addColorStop(1, 'rgba(120,140,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(160,155,140,0.45)';
  for (const [x, y, rr] of [[110, 112, 10], [140, 130, 14], [122, 146, 7], [146, 104, 6]]) {
    g.beginPath();
    g.arc(x, y, rr, 0, 7);
    g.fill();
  }
  return tex(c, false);
}
