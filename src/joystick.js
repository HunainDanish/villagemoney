// On-screen joystick for touch screens. Drag the knob; `value` is a vector
// in [-1, 1] (x = right, y = down on screen), length 0 when released.
export class Joystick {
  constructor(parent) {
    this.value = { x: 0, y: 0 };
    this.el = document.createElement('div');
    this.el.className = 'joy';
    this.el.innerHTML = '<div class="joy-knob"></div>';
    parent.append(this.el);
    this.knob = this.el.firstElementChild;
    this.onStart = () => {};
    let id = null;
    let cx = 0;
    let cy = 0;
    const radius = () => this.el.clientWidth / 2;
    const move = (e) => {
      if (e.pointerId !== id) return;
      const r = radius();
      let dx = (e.clientX - cx) / r;
      let dy = (e.clientY - cy) / r;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      this.value = { x: dx, y: dy };
      this.knob.style.transform = `translate(${dx * r * 0.6}px, ${dy * r * 0.6}px)`;
      e.preventDefault();
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.value = { x: 0, y: 0 };
      this.knob.style.transform = '';
      this.el.classList.remove('active');
    };
    this.el.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const rect = this.el.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
      this.el.setPointerCapture(id);
      this.el.classList.add('active');
      this.onStart();
      move(e);
    });
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  get length() {
    return Math.hypot(this.value.x, this.value.y);
  }
}
