import * as THREE from 'three';
import { seeded } from './util';
import { mk, noiseField, tex, c255 } from './textures';

/**
 * 城市研究中心（白天地图）用的程序化贴图：白墙、地砖、吊顶、外立面、城市楼群、地面、各种设备面板。
 * 纹理坐标都按世界米数算，所以尺寸注释里写的是一张贴图覆盖多大。
 */

/** 室内墙：米白乳胶漆 + 青色腰线 + 灰色踢脚线，少量污渍和血手印。覆盖 4m 宽 × 层高 */
export function labWallTexture(storey: number) {
  const W = 1024, H = 922;
  const r = seeded(301);
  const { c, g } = mk(W, H);
  const blot = noiseField(W, H, 8, 6, 5, r);
  const grain = noiseField(W, H, 160, 120, 2, r);
  const img = g.createImageData(W, H);
  const d = img.data;
  const pxPerM = H / storey;
  const yOf = (m: number) => Math.round(H - m * pxPerM);
  const bandTop = yOf(1.18), bandBot = yOf(1.02), base = yOf(0.12);
  for (let y = 0; y < H; y++) {
    const fromFloor = (H - y) / pxPerM;
    const grime = fromFloor < 0.5 ? 0.9 + fromFloor * 0.2 : 1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const b = blot[i], n = grain[i];
      let R = 226, G = 224, B = 216;
      if (y >= base) { R = 92; G = 98; B = 104; }
      else if (y >= bandTop && y <= bandBot) { R = 46; G = 138; B = 150; }
      const k = (0.9 + b * 0.14 + (n - 0.5) * 0.05) * grime;
      const o = i * 4;
      d[o] = c255(R * k);
      d[o + 1] = c255(G * k);
      d[o + 2] = c255(B * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 腰线上下细白边
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, bandTop - 3, W, 2);
  g.fillRect(0, bandBot + 1, W, 2);
  // 墙板接缝（每 1.2 米一道）
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let x = 0; x < W; x += W / (4 / 1.2)) g.fillRect(Math.round(x), 0, 2, base);
  // 擦痕
  g.strokeStyle = 'rgba(60,60,60,0.12)';
  g.lineWidth = 2;
  for (let k = 0; k < 14; k++) {
    const x = r() * W, y = base - r() * pxPerM * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 20 + r() * 60, y + (r() - 0.5) * 8);
    g.stroke();
  }
  return tex(c);
}

/** 墙上的血手印 / 拖痕（贴花，随机贴几处，不跟着墙面贴图重复） */
export function bloodHandTexture(seed: number) {
  const W = 256, H = 256;
  const r = seeded(seed);
  const { c, g } = mk(W, H);
  const hand = (x: number, y: number, a: number, alpha: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = `rgba(105,10,8,${alpha})`;
    g.beginPath();
    g.ellipse(0, 0, 22, 19, 0, 0, 7);
    g.fill();
    for (let f = 0; f < 4; f++) {
      g.beginPath();
      g.ellipse(-16 + f * 11, -30 - (f === 1 || f === 2 ? 6 : 0), 5, 14, (f - 1.5) * 0.12, 0, 7);
      g.fill();
    }
    g.beginPath();
    g.ellipse(24, -4, 5, 12, -0.9, 0, 7);
    g.fill();
    g.restore();
  };
  hand(90 + r() * 30, 80 + r() * 20, (r() - 0.5) * 0.6, 0.7);
  if (r() < 0.7) hand(160 + r() * 30, 110 + r() * 30, (r() - 0.5) * 0.8, 0.5);
  // 往下流的拖痕
  g.fillStyle = 'rgba(105,10,8,0.4)';
  for (let k = 0; k < 5; k++) g.fillRect(70 + r() * 120, 110 + r() * 30, 3 + r() * 4, 40 + r() * 100);
  return tex(c, false);
}

/** 地砖：50cm 浅灰水磨石，覆盖 2m × 2m */
export function labFloorTexture(tint: [number, number, number] = [196, 198, 196], seed = 311) {
  const S = 512;
  const r = seeded(seed);
  const { c, g } = mk(S, S);
  const blot = noiseField(S, S, 4, 4, 4, r);
  const img = g.createImageData(S, S);
  const d = img.data;
  const tile = S / 4;
  const tones: number[] = [];
  for (let k = 0; k < 16; k++) tones.push(0.94 + r() * 0.08);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = Math.floor(x / tile), ty = Math.floor(y / tile);
      let k = tones[ty * 4 + tx] * (0.9 + blot[i] * 0.16);
      const gx = x % tile, gy = y % tile;
      if (gx < 1.5 || gy < 1.5) k *= 0.72;
      const speck = r();
      let [R, G, B] = tint;
      if (speck > 0.985) { R *= 0.55; G *= 0.55; B *= 0.58; }
      else if (speck < 0.012) { R *= 1.08; G *= 1.08; B *= 1.08; }
      const o = i * 4;
      d[o] = c255(R * k);
      d[o + 1] = c255(G * k);
      d[o + 2] = c255(B * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 鞋印擦痕
  g.strokeStyle = 'rgba(40,40,40,0.08)';
  g.lineWidth = 3;
  for (let k = 0; k < 10; k++) {
    const x = r() * S, y = r() * S;
    g.beginPath();
    g.arc(x, y, 10 + r() * 30, r() * 6, r() * 6 + 1.5);
    g.stroke();
  }
  return tex(c);
}

/** 吊顶：50cm 矿棉板 + 铝龙骨，覆盖 2m × 2m */
export function labCeilingTexture() {
  const S = 512;
  const r = seeded(321);
  const { c, g } = mk(S, S);
  const n = noiseField(S, S, 64, 64, 2, r);
  const img = g.createImageData(S, S);
  const d = img.data;
  const tile = S / 4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let k = 0.9 + n[i] * 0.1;
      const gx = x % tile, gy = y % tile;
      let R = 232, G = 232, B = 228;
      if (gx < 3 || gy < 3) { R = 190; G = 192; B = 196; k = 1; }
      const o = i * 4;
      d[o] = c255(R * k);
      d[o + 1] = c255(G * k);
      d[o + 2] = c255(B * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 一块受潮微微发黄的板
  for (let k = 0; k < 1; k++) {
    const tx = Math.floor(r() * 4), ty = Math.floor(r() * 4);
    const grad = g.createRadialGradient(tx * tile + tile / 2, ty * tile + tile / 2, 5, tx * tile + tile / 2, ty * tile + tile / 2, tile * 0.6);
    grad.addColorStop(0, 'rgba(170,150,110,0.12)');
    grad.addColorStop(1, 'rgba(170,150,110,0)');
    g.fillStyle = grad;
    g.fillRect(tx * tile + 3, ty * tile + 3, tile - 3, tile - 3);
  }
  return tex(c);
}

/** 外立面：浅灰清水混凝土挂板，覆盖 4m × 层高 */
export function facadeTexture(storey: number) {
  const W = 512, H = 461;
  const r = seeded(331);
  const { c, g } = mk(W, H);
  const blot = noiseField(W, H, 6, 6, 5, r);
  const grain = noiseField(W, H, 128, 128, 2, r);
  const img = g.createImageData(W, H);
  const d = img.data;
  const pxPerM = H / storey;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = 0.82 + blot[i] * 0.22 + (grain[i] - 0.5) * 0.08;
      const o = i * 4;
      d[o] = c255(200 * k);
      d[o + 1] = c255(196 * k);
      d[o + 2] = c255(188 * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let x = 0; x < W; x += W / 2) g.fillRect(Math.round(x), 0, 3, H);
  g.fillRect(0, Math.round(H - 1.8 * pxPerM), W, 3);
  g.fillRect(0, 0, W, 4);
  // 模板螺栓孔
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let x = W / 8; x < W; x += W / 4) {
    for (const ym of [0.45, 1.35, 2.25, 3.15]) {
      g.beginPath();
      g.arc(x, H - ym * pxPerM, 3, 0, 7);
      g.fill();
    }
  }
  // 雨水流下的污迹
  for (let k = 0; k < 6; k++) {
    const x = r() * W;
    const grad = g.createLinearGradient(0, 0, 0, H * 0.7);
    grad.addColorStop(0, 'rgba(70,66,58,0.25)');
    grad.addColorStop(1, 'rgba(70,66,58,0)');
    g.fillStyle = grad;
    g.fillRect(x, 4, 6 + r() * 16, H * 0.7);
  }
  return tex(c);
}

/** 安全门：灰蓝钢门 + 竖条观察窗 + 底部黄黑警示条 */
export function labDoorTexture() {
  const W = 256, H = 512;
  const r = seeded(341);
  const { c, g } = mk(W, H);
  const n = noiseField(W, H, 16, 32, 3, r);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < W * H; i++) {
    const k = 0.85 + n[i] * 0.2;
    d[i * 4] = c255(118 * k);
    d[i * 4 + 1] = c255(132 * k);
    d[i * 4 + 2] = c255(146 * k);
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 4;
  g.strokeRect(8, 8, W - 16, H - 16);
  // 观察窗
  g.fillStyle = '#1c2630';
  g.fillRect(150, 70, 44, 170);
  const glass = g.createLinearGradient(150, 70, 194, 240);
  glass.addColorStop(0, 'rgba(160,200,230,0.5)');
  glass.addColorStop(0.5, 'rgba(160,200,230,0.05)');
  glass.addColorStop(1, 'rgba(160,200,230,0.3)');
  g.fillStyle = glass;
  g.fillRect(150, 70, 44, 170);
  g.strokeStyle = '#d8dde2';
  g.lineWidth = 5;
  g.strokeRect(148, 68, 48, 174);
  // 警示条
  g.save();
  g.beginPath();
  g.rect(8, H - 90, W - 16, 70);
  g.clip();
  g.fillStyle = '#e8b020';
  g.fillRect(8, H - 90, W - 16, 70);
  g.fillStyle = '#1a1a1a';
  for (let x = -80; x < W; x += 44) {
    g.beginPath();
    g.moveTo(x, H - 20);
    g.lineTo(x + 22, H - 20);
    g.lineTo(x + 92, H - 90);
    g.lineTo(x + 70, H - 90);
    g.fill();
  }
  g.restore();
  // 门禁牌
  g.fillStyle = '#b8261e';
  g.fillRect(40, 250, 80, 34);
  g.fillStyle = '#fff';
  g.font = 'bold 20px sans-serif';
  g.textAlign = 'center';
  g.fillText('授权进入', 80, 274);
  g.fillStyle = '#20252a';
  g.fillRect(30, 300, 16, 60);
  return tex(c, false);
}

/** 文字招牌 */
export function signTexture(text: string, sub: string, bg: string, fg: string, w = 512, h = 128) {
  const { c, g } = mk(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * (sub ? 0.4 : 0.55))}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  g.fillText(text, w / 2, sub ? h * 0.38 : h / 2);
  if (sub) {
    g.globalAlpha = 0.8;
    g.font = `600 ${Math.round(h * 0.2)}px "Helvetica Neue", Arial, sans-serif`;
    g.fillText(sub, w / 2, h * 0.78);
  }
  const t = tex(c, false);
  t.anisotropy = 4;
  return t;
}

/** 远处城市大楼的外墙：一张覆盖 4m × 3.5m（一层一开间） */
export function cityFacadeTexture(variant: 0 | 1 | 2) {
  const W = 128, H = 112;
  const r = seeded(351 + variant);
  const { c, g } = mk(W, H);
  const wall = ['#8d949c', '#b9ae9c', '#6f7f8f'][variant];
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
  if (variant === 2) {
    // 玻璃幕墙大楼
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#9fc2dc');
    grad.addColorStop(1, '#5d7f9c');
    g.fillStyle = grad;
    g.fillRect(2, 4, W - 4, H - 10);
    g.fillStyle = 'rgba(40,55,70,0.8)';
    for (let x = 0; x < W; x += W / 4) g.fillRect(x, 0, 3, H);
    g.fillRect(0, H - 8, W, 8);
  } else {
    const cols = variant === 0 ? 3 : 2;
    const cw = W / cols;
    for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.18;
      const lit = r() < 0.15;
      const grad = g.createLinearGradient(0, 20, 0, 90);
      grad.addColorStop(0, lit ? '#d8d0b0' : '#7e98ae');
      grad.addColorStop(1, lit ? '#b0a888' : '#3e5062');
      g.fillStyle = grad;
      g.fillRect(x, 22, cw * 0.64, 62);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, 22, cw * 0.64, 6);
    }
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(0, H - 6, W, 6);
  }
  return tex(c);
}

/** 地面：0 草地、1 沥青路、2 广场地砖。草地覆盖 8m，路面 8m，地砖 4m */
export function outdoorTexture(kind: 0 | 1 | 2) {
  const S = 512;
  const r = seeded(361 + kind);
  const { c, g } = mk(S, S);
  const blot = noiseField(S, S, 6, 6, 5, r);
  const img = g.createImageData(S, S);
  const d = img.data;
  const base = [[74, 104, 50], [70, 72, 76], [176, 170, 160]][kind];
  const tile = S / 8;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let k = 0.78 + blot[i] * 0.4 + (r() - 0.5) * (kind === 1 ? 0.2 : 0.12);
      if (kind === 2 && (x % tile < 2 || y % tile < 2)) k *= 0.72;
      const o = i * 4;
      d[o] = c255(base[0] * k);
      d[o + 1] = c255(base[1] * k);
      d[o + 2] = c255(base[2] * k);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (kind === 1) {
    // 沥青裂缝
    g.strokeStyle = 'rgba(20,20,22,0.5)';
    g.lineWidth = 1.5;
    for (let k = 0; k < 6; k++) {
      let x = r() * S, y = r() * S;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 12; s++) {
        x += (r() - 0.5) * 40;
        y += (r() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  return tex(c);
}

/** 服务器机柜正面：一格 1m 宽 × 2.1m 高，一排排服务器和指示灯 */
export function rackTextures() {
  const W = 128, H = 256;
  const r = seeded(371);
  const a = mk(W, H);
  const e = mk(W, H);
  a.g.fillStyle = '#16191d';
  a.g.fillRect(0, 0, W, H);
  e.g.fillStyle = '#000';
  e.g.fillRect(0, 0, W, H);
  for (let y = 10; y < H - 10; y += 12) {
    a.g.fillStyle = r() < 0.5 ? '#2a2f36' : '#23272d';
    a.g.fillRect(8, y, W - 16, 10);
    a.g.fillStyle = '#0c0e10';
    for (let x = 40; x < W - 12; x += 5) a.g.fillRect(x, y + 3, 3, 4);
    for (let k = 0; k < 3; k++) {
      if (r() < 0.6) {
        const col = r() < 0.75 ? '#40ff80' : '#ffb030';
        a.g.fillStyle = col;
        e.g.fillStyle = col;
        a.g.fillRect(12 + k * 6, y + 4, 3, 3);
        e.g.fillRect(12 + k * 6, y + 4, 3, 3);
      }
    }
  }
  a.g.strokeStyle = '#3a4048';
  a.g.lineWidth = 4;
  a.g.strokeRect(2, 2, W - 4, H - 4);
  return { map: tex(a.c, false), emissive: tex(e.c, false) };
}

/** 自动售货机正面 */
export function vendingTexture(variant: number) {
  const W = 128, H = 256;
  const r = seeded(381 + variant);
  const { c, g } = mk(W, H);
  g.fillStyle = variant ? '#1f4f9a' : '#b3261e';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0d1520';
  g.fillRect(10, 20, 80, 170);
  const cols = ['#e04030', '#f0c030', '#40a0e0', '#50c060', '#f07020', '#e0e0e0'];
  for (let row = 0; row < 5; row++) {
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(12, 50 + row * 32, 76, 2);
    for (let k = 0; k < 5; k++) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(15 + k * 15, 30 + row * 32, 9, 18);
    }
  }
  g.fillStyle = '#c8ccd0';
  g.fillRect(96, 60, 22, 60);
  g.fillStyle = '#20252a';
  g.fillRect(12, 205, 76, 30);
  g.fillStyle = '#fff';
  g.font = 'bold 16px sans-serif';
  g.textAlign = 'center';
  g.fillText(variant ? '饮料' : 'COLA', 50, 14);
  return tex(c, false);
}

/** 显示器画面：蓝色系统界面 / 监控曲线 */
export function screenTexture(variant: number) {
  const W = 128, H = 80;
  const r = seeded(391 + variant);
  const { c, g } = mk(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, variant % 2 ? '#0d3a2a' : '#0c2c52');
  grad.addColorStop(1, variant % 2 ? '#06140e' : '#061426');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = variant % 2 ? '#50ff90' : '#60c0ff';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let x = 0; x < W; x += 4) g.lineTo(x, H * 0.55 + Math.sin(x * 0.2 + variant) * 8 + (r() - 0.5) * 10);
  g.stroke();
  g.fillStyle = 'rgba(200,230,255,0.7)';
  for (let k = 0; k < 5; k++) g.fillRect(6, 6 + k * 6, 20 + r() * 50, 2);
  if (variant === 2) {
    g.fillStyle = '#ff3030';
    g.font = 'bold 14px sans-serif';
    g.fillText('⚠ 收容失败', 34, 70);
  }
  return tex(c, false);
}

/** 天空盒渐变色（给环境反射用） */
export function skyColors() {
  return { top: new THREE.Color(0x5f97d8), horizon: new THREE.Color(0xd6e4ef), ground: new THREE.Color(0x8c8a84) };
}
