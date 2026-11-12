// 💬 Chat with people near you. Tap someone (or their name tag) to open a
// conversation; messages arrive live while you're both in the same area.
// The 💬 Chat button lists everyone nearby. Nothing is stored: a chat lasts
// as long as you're both here.

const MAX = 200;
const KEEP = 60; // messages kept per person
const GAP_MS = 600; // slowest typist's friend: no flooding

export class Chat {
  constructor({ el, net, player, bubbles, toast, sfx }) {
    Object.assign(this, { el, net, player, bubbles, toast, sfx });
    this.logs = new Map(); // id -> [{ me, text, at }]
    this.unread = new Set();
    this.with = null; // id of the open conversation
    this.lastSent = 0;
    this.who = el.querySelector('.chat-who');
    this.status = el.querySelector('.chat-status');
    this.log = el.querySelector('.chat-log');
    this.list = el.querySelector('.chat-people');
    this.form = el.querySelector('.chat-form');
    this.input = this.form.querySelector('input');
    this.back = el.querySelector('.chat-back');
    el.querySelector('.chat-close').onclick = () => this.close();
    this.back.onclick = () => this.openList();
    this.form.onsubmit = (e) => {
      e.preventDefault();
      this.#send();
    };
    // Typing shouldn't walk you around (WASD) or trigger shortcuts.
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
    net.onChat = (m) => this.receive(m);
    net.onPeerTap = (id) => this.open(id);
    net.onPeerGone = (id) => this.#gone(id);
    this.onUnread = () => {};
  }

  get isOpen() {
    return !this.el.hidden;
  }

  // Everyone nearby, nearest first: pick who to talk to.
  openList() {
    this.with = null;
    this.el.hidden = false;
    this.el.classList.add('listing');
    this.who.textContent = '💬 Chat';
    this.status.textContent = 'People near you';
    const people = this.net.nearby(this.player.pos.x, this.player.pos.z);
    this.list.replaceChildren();
    if (!people.length) {
      const p = document.createElement('p');
      p.className = 'chat-empty';
      p.textContent = 'Nobody is near you right now. Walk to the plaza or the café to meet people.';
      this.list.append(p);
    }
    for (const person of people) {
      const b = document.createElement('button');
      b.type = 'button';
      const name = document.createElement('b');
      name.textContent = person.name;
      const meta = document.createElement('small');
      meta.textContent = this.unread.has(person.id) ? 'New message' : `${Math.round(person.dist)} m away`;
      b.append(name, meta);
      if (this.unread.has(person.id)) b.classList.add('unread');
      b.onclick = () => this.open(person.id);
      this.list.append(b);
    }
  }

  open(id) {
    const name = this.net.peerName(id);
    if (!name) return;
    this.with = id;
    this.el.hidden = false;
    this.el.classList.remove('listing');
    this.who.textContent = `💬 ${name}`;
    this.status.textContent = 'Nearby · live';
    this.input.disabled = false;
    this.#markRead(id);
    this.#render();
    // On phones the keyboard would cover the town: focus only with a mouse.
    if (matchMedia('(pointer: fine)').matches) this.input.focus();
  }

  close() {
    this.el.hidden = true;
    this.with = null;
    this.input.blur();
  }

  receive({ id, name, text }) {
    this.#push(id, { me: false, text });
    // Their words pop up over their head for a few seconds.
    this.bubbles.say(this.net.peerObject(id), text);
    if (this.with === id && this.isOpen) {
      this.#render();
      this.sfx?.click?.();
      return;
    }
    this.unread.add(id);
    this.net.setUnread(id, true);
    this.onUnread(this.unread.size);
    this.toast(`💬 ${name}: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}  (tap them to reply)`);
    if (this.isOpen && !this.with) this.openList();
  }

  #send() {
    const id = this.with;
    const text = this.input.value.replace(/\s+/g, ' ').trim().slice(0, MAX);
    if (!id || !text) return;
    const now = performance.now();
    if (now - this.lastSent < GAP_MS) return;
    if (this.net.hidden) return this.toast("You're hidden. Show yourself in ⚙️ Menu to chat.");
    if (!this.net.chat(id, text)) {
      this.status.textContent = 'Not connected: try again in a moment';
      return;
    }
    this.lastSent = now;
    this.input.value = '';
    this.#push(id, { me: true, text });
    this.bubbles.say(this.player.body, text);
    this.#render();
  }

  #push(id, msg) {
    const log = this.logs.get(id) || [];
    log.push({ ...msg, at: Date.now() });
    if (log.length > KEEP) log.splice(0, log.length - KEEP);
    this.logs.set(id, log);
  }

  #markRead(id) {
    if (!this.unread.delete(id)) return;
    this.net.setUnread(id, false);
    this.onUnread(this.unread.size);
  }

  #render() {
    const log = this.logs.get(this.with) || [];
    this.log.replaceChildren();
    if (!log.length) {
      const p = document.createElement('p');
      p.className = 'chat-empty';
      p.textContent = 'Say hi! Messages reach them live while you are both nearby.';
      this.log.append(p);
    }
    for (const m of log) {
      const row = document.createElement('div');
      row.className = `msg ${m.me ? 'me' : 'them'}`;
      row.textContent = m.text; // plain text only
      this.log.append(row);
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  #gone(id) {
    this.unread.delete(id);
    this.onUnread(this.unread.size);
    if (this.with === id && this.isOpen) {
      this.status.textContent = 'Left the area';
      this.input.disabled = true;
    }
  }
}
