import * as THREE from 'three';

// Sky dome, sun/moon, stars, drifting clouds and a day/night cycle.
// Time is derived from the wall clock (1 real minute = 1 town hour), so every
// visitor sees the same time of day without any network messages.

const DAY_MS = 24 * 60 * 1000;

// Keyframes over the day (0 = midnight, 0.5 = noon).
const KEYS = [
  { t: 0.0, top: 0x0b1433, horizon: 0x1d2b55, sun: 0x8fa6ff, sunI: 0.35, hemi: 0.55, ground: 0x223355 },
  { t: 0.22, top: 0x0f1d45, horizon: 0x2c3a6b, sun: 0x9fb2ff, sunI: 0.35, hemi: 0.6, ground: 0x2a3a5a },
  { t: 0.27, top: 0x4a6fb5, horizon: 0xffa66b, sun: 0xffb37a, sunI: 1.2, hemi: 1.0, ground: 0x6b6a55 },
  { t: 0.35, top: 0x5fa8f0, horizon: 0xcfe9ff, sun: 0xffe2b8, sunI: 2.2, hemi: 1.0, ground: 0xa3ae94 },
  { t: 0.65, top: 0x5aa2ec, horizon: 0xd8ecff, sun: 0xffe2b8, sunI: 2.2, hemi: 1.0, ground: 0xa3ae94 },
  { t: 0.74, top: 0x5a5fa8, horizon: 0xff8a5c, sun: 0xff9a5a, sunI: 1.3, hemi: 1.0, ground: 0x6b5a55 },
  { t: 0.8, top: 0x16224f, horizon: 0x3a3a70, sun: 0x9fb2ff, sunI: 0.4, hemi: 0.6, ground: 0x2a3a5a },
  { t: 1.0, top: 0x0b1433, horizon: 0x1d2b55, sun: 0x8fa6ff, sunI: 0.35, hemi: 0.55, ground: 0x223355 },
];

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

    this.uniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: [
          'uniform vec3 top;',
          'uniform vec3 horizon;',
          'varying vec3 vP;',
          'void main() {',
          '  float h = clamp(vP.y * 1.6, 0.0, 1.0);',
          '  gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0);',
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
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(14, 24), new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false }));
    scene.add(this.sunDisc, this.moonDisc);

    // Stars.
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.1;
      v.normalize().multiplyScalar(450);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false }));
    scene.add(this.stars);

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
  }

  time() {
    return this.fixed ?? ((Date.now() % DAY_MS) / DAY_MS);
  }

  // Returns 0 (deep night) .. 1 (full day): used for window glow, lamps.
  update(center, dt) {
    const t = this.time();
    const s = sample(t);
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
    this.sun.position.copy(center).addScaledVector(lightDir, 140);
    this.sun.target.position.copy(center);

    this.dome.position.copy(center);
    this.sunDisc.position.copy(center).addScaledVector(sunDir, 420);
    this.sunDisc.lookAt(center);
    this.moonDisc.position.copy(center).addScaledVector(sunDir, -420);
    this.moonDisc.lookAt(center);
    this.stars.position.copy(center);

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
