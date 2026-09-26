import './style.css';
import { Game } from './game';
import { MAP_LIST, type MapId } from './world/map';

const SETTINGS_KEY = 'zombie.settings';
const MAP_KEY = 'zombie.map';

/** 选的地图：网址里的 ?map= 优先，其次是上次选的 */
function loadMap(): MapId {
  const ok = (m: string | null): m is MapId => MAP_LIST.some((x) => x.id === m);
  const q = new URLSearchParams(location.search).get('map');
  if (ok(q)) return q;
  try {
    const m = localStorage.getItem(MAP_KEY);
    if (ok(m)) return m;
  } catch {
    /* 忽略 */
  }
  return 'manor';
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { sens: typeof s.sens === 'number' ? s.sens : 1, vol: typeof s.vol === 'number' ? s.vol : 0.8 };
  } catch {
    return { sens: 1, vol: 0.8 };
  }
}
function saveSettings(s: { sens: number; vol: number }) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式下可能写不了，忽略 */
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const mapId = loadMap();
const game = new Game(canvas, mapId);
(window as unknown as { game: Game }).game = game;

const settings = loadSettings();
game.setSensitivity(settings.sens);
game.setVolume(settings.vol);

// 主菜单和暂停菜单各有一组滑块，保持同步
document.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((el) => {
  const key = el.dataset.setting as 'sens' | 'vol';
  el.value = String(settings[key]);
  const label = el.parentElement?.querySelector('output');
  const show = () => {
    if (label) label.textContent = key === 'vol' ? `${Math.round(settings[key] * 100)}%` : settings[key].toFixed(2);
  };
  show();
  el.addEventListener('input', () => {
    settings[key] = parseFloat(el.value);
    document.querySelectorAll<HTMLInputElement>(`input[data-setting="${key}"]`).forEach((o) => {
      if (o !== el) o.value = el.value;
      const l = o.parentElement?.querySelector('output');
      if (l) l.textContent = key === 'vol' ? `${Math.round(settings[key] * 100)}%` : settings[key].toFixed(2);
    });
    if (key === 'sens') game.setSensitivity(settings.sens);
    else game.setVolume(settings.vol);
    saveSettings(settings);
  });
});

// 主菜单的地图选择：换地图时记下来并重新载入页面
const pick = document.getElementById('map-pick')!;
for (const m of MAP_LIST) {
  const btn = document.createElement('button');
  btn.className = m.id === mapId ? 'on' : '';
  btn.innerHTML = `${m.name}<small>${m.desc}</small>`;
  btn.addEventListener('click', () => {
    if (m.id === mapId) return;
    try {
      localStorage.setItem(MAP_KEY, m.id);
    } catch {
      /* 忽略 */
    }
    const url = new URL(location.href);
    url.searchParams.set('map', m.id);
    location.href = url.toString();
  });
  pick.appendChild(btn);
}

document.getElementById('btn-start')!.addEventListener('click', () => game.start());
document.getElementById('btn-resume')!.addEventListener('click', () => game.requestResume());
for (const id of ['btn-restart', 'btn-again']) {
  document.getElementById(id)!.addEventListener('click', () => location.reload());
}
