/** 键鼠输入：按 KeyboardEvent.code 记录按键，鼠标位移只在指针锁定时累计 */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = [false, false, false];
  mousePressed = [false, false, false];
  wheel = 0;
  locked = false;
  /** 调试模式下不锁鼠标也接收鼠标位移 */
  freeLook = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'KeyF', 'KeyR', 'KeyV', 'KeyB'].includes(e.code) || e.code.startsWith('Digit')) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown.fill(false);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.freeLook) return;
      // 某些浏览器在锁定瞬间会给出异常大的位移，过滤掉
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.freeLook) return;
      if (e.button < 3) {
        this.mouseDown[e.button] = true;
        this.mousePressed[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.mouseDown[e.button] = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouseDown.fill(false);
        this.keys.clear();
      }
      this.onLockChange(this.locked);
    });
  }

  requestLock() {
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      // Chrome 在刚按 ESC 退出后短时间内会拒绝重新锁定，忽略即可
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* 忽略 */
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string) {
    return this.keys.has(code);
  }
  wasPressed(code: string) {
    return this.pressed.has(code);
  }
  /** 调试用：模拟按键 */
  simulate(code: string, isDown: boolean) {
    if (isDown) {
      this.keys.add(code);
      this.pressed.add(code);
    } else this.keys.delete(code);
  }

  clearPressed() {
    this.pressed.clear();
    this.mousePressed.fill(false);
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed.fill(false);
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
