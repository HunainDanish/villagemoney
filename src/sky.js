import * as THREE from 'three';

// Sky dome, sun/moon, stars, drifting clouds and a day/night cycle.
// The time of day is the visitor's own local clock: at 7 PM where you are,
// the town is at sunset too. Sunrise and sunset shift with the season.
// ?time=0.5 forces a fixed time (0 = midnight, 0.5 = noon) for testing.

// Keyframes over a "sun day": 0.25 is sunrise, 0.5 solar noon, 0.75 sunset.
const KEYS = [
  { t: 0.0, top: 0x0a1230, horizon: 0x1b2852, sun: 0x8fa6ff, sunI: 0.35, hemi: 0.5, ground: 0x223355 },
  { t: 0.21, top: 0x0f1d45, horizon: 0x2c3a6b, sun: 0x9fb2ff, sunI: 0.35, hemi: 0.55, ground: 0x2a3a5a },
  { t: 0.25, top: 0x3f63ad, horizon: 0xff9a5c, sun: 0xffa868, sunI: 1.2, hemi: 0.9, ground: 0x6b6a55 },
  { t: 0.3, top: 0x3b8ff5, horizon: 0xffd7a8, sun: 0xffe2b0, sunI: 2.6, hemi: 1.15, ground: 0xa8b783 },
  { t: 0.4, top: 0x2f8cff, horizon: 0xc6eeff, sun: 0xfff6e0, sunI: 3.4, hemi: 1.3, ground: 0xbccc92 },
  { t: 0.6, top: 0x2d89fc, horizon: 0xcdf0ff, sun: 0xfff3da, sunI: 3.4, hemi: 1.3, ground: 0xbccc92 },
  { t: 0.7, top: 0x4b78c8, horizon: 0xffcf9a, sun: 0xffcf8a, sunI: 2.4, hemi: 1.1, ground: 0x9a9a70 },
  { t: 0.75, top: 0x5a4f9c, horizon: 0xff7a4a, sun: 0xff8a4a, sunI: 1.2, hemi: 0.9, ground: 0x6b5a55 },
  { t: 0.79, top: 0x16224f, horizon: 0x3a3a70, sun: 0x9fb2ff, sunI: 0.4, hemi: 0.6, ground: 0x2a3a5a },
  { t: 1.0, top: 0x0a1230, horizon: 0x1b2852, sun: 0x8fa6ff, sunI: 0.35, hemi: 0.5, ground: 0x223355 },
];

// Southern-hemisphere time zones get their summer in December.
const SOUTH = /^(Australia|Antarctica|Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea)|America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima|Punta_Arenas)|Africa\/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane)|Indian\/(Mauritius|Reunion|Antananarivo))/;
let south = false;
try {
  south = SOUTH.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
} catch {
  /* unknown zone: assume north */
}

// Sunrise and sunset in local hours for a date (a mid-latitude town).
export function sunTimes(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const doy = (date - start) / 86400000;
  let k = Math.sin(((doy - 80) / 365) * Math.PI * 2); // +1 midsummer (north)
  if (south) k = -k;
  const len = 12 + 2.6 * k; // day length in hours
  const noon = 12.5; // solar noon sits a little after 12 on most clocks
  return { rise: noon - len / 2, set: noon + len / 2 };
}

// Local wall-clock hours (0..24) -> sun day (0.25 sunrise, 0.75 sunset).
export function sunPhase(hours, rise, set) {
  if (hours >= rise && hours <= set) return 0.25 + 0.5 * ((hours - rise) / (set - rise));
  const night = 24 - (set - rise);
  const since = hours > set ? hours - set : hours + 24 - set;
  return (0.75 + 0.5 * (since / night)) % 1;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,250,225,0.9)');
  grd.addColorStop(0.4, 'rgba(255,230,170,0.3)');
  grd.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ca = new THREE.Color();
const cb = new THREE.Color();
function sample(t) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = THREE.MathUtils.smoothstep((t - a.t) / (b.t - a.t), 0, 1);
  const mix = (p) => ca.setHex(a[p]).lerp(cb.setHex(b[p]), k).getHex();
  return {
    top: mix('top'), horizon: mix('horizon'), sun: mix('sun'), ground: mix('ground'),
    sunI: a.sunI + (b.sunI - a.sunI) * k, hemi: a.hemi + (b.hemi - a.hemi) * k,
  };
}

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    const override = Number(new URLSearchParams(location.search).get('time'));
    this.fixed = Number.isFinite(override) && override > 0 && override <= 1 ? override : null;

    this.uniforms = {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunCol: { value: new THREE.Color() },
      glow: { value: 1 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: [
          'uniform vec3 top;',
          'uniform vec3 horizon;',
          'uniform vec3 sunDir;',
          'uniform vec3 sunCol;',
          'uniform float glow;',
          'varying vec3 vP;',
          'void main() {',
          '  float h = clamp(vP.y * 1.6, 0.0, 1.0);',
          '  vec3 col = mix(horizon, top, pow(h, 0.7));',
          '  float d = max(dot(normalize(vP), sunDir), 0.0);',
          // Wide warm wash round the sun plus a tight bright halo.
          '  col += sunCol * (pow(d, 6.0) * 0.35 + pow(d, 60.0) * 0.6) * glow;',
          '  gl_FragColor = vec4(col, 1.0);',
          '  #include <tonemapping_fragment>',
          '  #include <colorspace_fragment>',
          '}',
        ].join('\n'),
      }),
    );
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x88aa77, 1.3);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -55;
    sc.right = sc.top = 55;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    // Sun / moon discs.
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(28, 32), new THREE.MeshBasicMaterial({ color: 0xfffbe8, fog: false, toneMapped: false }));
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(18, 32), new THREE.MeshBasicMaterial({ color: 0xeef1ff, fog: false }));
    const glow = glowTexture();
    const sprite = (size, opacity) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff1c8, transparent: true, opacity, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(size);
      return sp;
    };
    this.sunGlow = sprite(260, 0.9);
    this.sunGlow2 = sprite(560, 0.35);
    this.moonGlow = sprite(110, 0.4);
    for (const o of [this.sunDisc, this.moonDisc, this.sunGlow, this.sunGlow2, this.moonGlow]) o.renderOrder = -0.8;
    scene.add(this.sunDisc, this.moonDisc, this.sunGlow, this.sunGlow2, this.moonGlow);

    // Stars.
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.1;
      v.normalize().multiplyScalar(860);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false }));
    this.starPivot = new THREE.Group();
    this.starPivot.add(this.stars);
    scene.add(this.starPivot);

    // Clouds: puffy instanced clusters that drift and wrap around the player.
    const puff = new THREE.IcosahedronGeometry(1, 1);
    this.clouds = new THREE.InstancedMesh(puff, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92 }), 22 * 5);
    this.cloudData = Array.from({ length: 22 }, () => ({
      x: (Math.random() - 0.5) * 700,
      z: (Math.random() - 0.5) * 700,
      y: 70 + Math.random() * 40,
      s: 5 + Math.random() * 6,
    }));
    scene.add(this.clouds);

    this.renderer = renderer;
    this.dayness = 1;
    this.horizon = 0xcdeeff;
    this.tmpV = new THREE.Vector3();
    this.tmp = new THREE.Color();
  }

  // Local clock, 0..1 over the day (0.5 = 12:00 noon).
  time() {
    if (this.fixed != null) return this.fixed;
    const d = new Date();
    return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000) / 86400;
  }

  // Where the sun is in its day (0.25 sunrise .. 0.75 sunset).
  phase() {
    if (this.fixed != null) return this.fixed;
    const now = new Date();
    if (!this.sunCache || this.sunCache.day !== now.getDate()) this.sunCache = { day: now.getDate(), ...sunTimes(now) };
    return sunPhase(this.time() * 24, this.sunCache.rise, this.sunCache.set);
  }

  // Returns 0 (deep night) .. 1 (full day): used for window glow, lamps.
  // view: { x, z, r, scale } in the aerial view: the sky is centred on the
  // whole town and grown to fit, and the sun's shadows cover all of it.
  update(center, dt, view = null) {
    const k0 = view?.scale ?? 1;
    const vc = view ? this.tmpV.set(view.x, 0, view.z) : center;
    const shadowR = view ? view.r : 55;
    if (shadowR !== this.shadowR) {
      this.shadowR = shadowR;
      const sc = this.sun.shadow.camera;
      sc.left = sc.bottom = -shadowR;
      sc.right = sc.top = shadowR;
      sc.far = Math.max(260, shadowR * 5);
      sc.updateProjectionMatrix();
    }
    const t = this.phase();
    const s = sample(t);
    this.horizon = s.horizon;
    this.uniforms.top.value.setHex(s.top);
    this.uniforms.horizon.value.setHex(s.horizon);
    this.scene.fog.color.setHex(s.horizon);
    this.hemi.intensity = s.hemi;
    this.hemi.color.setHex(s.top).lerp(new THREE.Color(0xffffff), 0.6);
    this.hemi.groundColor.setHex(s.ground);

    // Sun path: rises in the east (+x), sets in the west.
    const ang = (t - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    const day = sunDir.y > -0.05;
    const lightDir = day ? sunDir : sunDir.clone().multiplyScalar(-1); // moonlight at night
    this.sun.color.setHex(s.sun);
    this.sun.intensity = s.sunI;
    this.sun.position.copy(vc).addScaledVector(lightDir, Math.max(140, shadowR * 2.5));
    this.sun.target.position.copy(vc);

    this.dome.position.copy(vc);
    this.dome.scale.setScalar(k0);
    this.sunDisc.position.copy(vc).addScaledVector(sunDir, 850 * k0);
    this.sunDisc.lookAt(vc);
    this.moonDisc.position.copy(vc).addScaledVector(sunDir, -850 * k0);
    this.moonDisc.lookAt(vc);
    for (const o of [this.sunDisc, this.moonDisc, this.sunGlow2, this.moonGlow]) o.scale.setScalar(k0 * (o.userData.base ??= o.scale.x));
    this.sunGlow.position.copy(this.sunDisc.position);
    this.sunGlow2.position.copy(this.sunDisc.position);
    this.moonGlow.position.copy(this.moonDisc.position);
    // Low sun: bigger and warmer, like a real sunset.
    const low = 1 - THREE.MathUtils.clamp(sunDir.y / 0.4, 0, 1);
    const up = sunDir.y > -0.08;
    this.sunGlow.material.color.setHex(s.sun);
    this.sunGlow.scale.setScalar((260 + low * 160) * k0);
    this.sunGlow.visible = this.sunGlow2.visible = this.sunDisc.visible = up;
    this.sunDisc.material.color.setHex(0xfffbe8).lerp(this.tmp.setHex(0xffb066), low * 0.8);
    this.moonDisc.visible = this.moonGlow.visible = sunDir.y < 0.1;
    this.uniforms.sunDir.value.copy(up ? sunDir : sunDir.clone().negate());
    this.uniforms.sunCol.value.setHex(up ? s.sun : 0x6a7aa8);
    this.uniforms.glow.value = up ? 1 + low * 0.8 : 0.25;
    // The night sky turns round the pole as the hours pass.
    this.starPivot.position.copy(vc);
    this.starPivot.scale.setScalar(k0);
    this.clouds.visible = !view; // from the air they'd sit in front of the town
    this.starPivot.rotation.set(0.6, 0, this.time() * Math.PI * 2);

    this.dayness = THREE.MathUtils.clamp((sunDir.y + 0.1) / 0.35, 0, 1);
    this.stars.material.opacity = 1 - this.dayness;
    this.clouds.material.color.setHex(s.horizon).lerp(new THREE.Color(0xffffff), 0.75);

    const m = new THREE.Matrix4();
    let k = 0;
    for (const c of this.cloudData) {
      c.x += dt * 2.5;
      // Wrap clouds within a square around the player.
      const rx = ((c.x - center.x + 350) % 700 + 700) % 700 - 350;
      const rz = ((c.z - center.z + 350) % 700 + 700) % 700 - 350;
      for (let i = 0; i < 5; i++) {
        const ox = (i - 2) * c.s * 0.9;
        const sy = c.s * (i === 2 ? 1.3 : i % 2 ? 1 : 0.75);
        m.makeScale(sy * 1.3, sy * 0.8, sy);
        m.setPosition(center.x + rx + ox, c.y + (i === 2 ? c.s * 0.3 : 0), center.z + rz);
        this.clouds.setMatrixAt(k++, m);
      }
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    return this.dayness;
  }

  // Town clock label, e.g. "7:42 PM".
  clock() {
    const mins = Math.floor(this.time() * 24 * 60);
    const h = Math.floor(mins / 60);
    const m = String(mins % 60).padStart(2, '0');
    return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  }
}
