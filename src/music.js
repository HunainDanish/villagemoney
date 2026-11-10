// Gentle background music, generated on the fly (no audio files): soft pad
// chords with a slow plucked melody. Off by default; the choice is remembered.

const CHORDS = [
  [261.63, 329.63, 392.0], // C
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [196.0, 246.94, 293.66], // G
];
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0];

export class Music {
  constructor() {
    this.on = false;
    try {
      this.on = localStorage.getItem('pl_music') === '1';
    } catch {
      /* storage blocked */
    }
    this.ctx = null;
    this.timer = null;
  }

  // Browsers only allow sound after a tap, so call this from a click.
  toggle(force) {
    this.on = force ?? !this.on;
    try {
      localStorage.setItem('pl_music', this.on ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.on) this.#start();
    else this.#stop();
    return this.on;
  }

  // Resume after the first tap if it was on last time.
  resume() {
    if (this.on && !this.timer) this.#start();
  }

  #start() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx ||= new C();
    this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.07;
    this.master.connect(this.ctx.destination);
    let bar = 0;
    const play = () => {
      const t = this.ctx.currentTime + 0.05;
      const chord = CHORDS[bar % CHORDS.length];
      for (const f of chord) this.#note(f / 2, t, 3.8, 'triangle', 0.5);
      for (let i = 0; i < 4; i++) {
        if (Math.random() < 0.7) this.#note(SCALE[Math.floor(Math.random() * SCALE.length)], t + i * 0.95, 0.9, 'sine', 0.22);
      }
      bar++;
    };
    play();
    this.timer = setInterval(play, 3800);
  }

  #note(freq, t, dur, type, gain) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  #stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.master?.disconnect();
  }
}
