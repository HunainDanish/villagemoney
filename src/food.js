import * as THREE from 'three';

// Little low-poly dishes that appear on the café table when someone orders.
// Index matches the café menu (hangout.js FOODS): pasta, sushi, burger, cake,
// mocktail, juice, coffee.

const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
function add(g, geo, color, x, y, z) {
  const m = new THREE.Mesh(geo, lam(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}
const plate = (g, r = 0.42) => add(g, new THREE.CylinderGeometry(r, r * 0.8, 0.05, 18), 0xffffff, 0, 0.025, 0);

const DISHES = [
  // Pasta: a nest of noodles with sauce and basil.
  (g) => {
    plate(g);
    add(g, new THREE.TorusKnotGeometry(0.15, 0.05, 40, 6, 2, 3), 0xf3d27a, 0, 0.14, 0).scale.set(1, 0.45, 1);
    add(g, new THREE.SphereGeometry(0.1, 8, 6), 0xd94141, 0, 0.2, 0);
    add(g, new THREE.BoxGeometry(0.08, 0.02, 0.05), 0x3f8f3a, 0.05, 0.27, 0.02);
  },
  // Sushi: a board of nigiri and maki rolls.
  (g) => {
    add(g, new THREE.BoxGeometry(0.8, 0.05, 0.36), 0x9a6b42, 0, 0.025, 0);
    for (const [x, fish] of [[-0.26, 0xff8a5c], [-0.09, 0xff8a5c], [0.08, 0xf2efe8]]) {
      add(g, new THREE.BoxGeometry(0.13, 0.07, 0.2), 0xffffff, x, 0.085, 0);
      add(g, new THREE.BoxGeometry(0.14, 0.03, 0.22), fish, x, 0.135, 0);
    }
    for (const z of [-0.08, 0.08]) {
      add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.09, 10), 0x1d3324, 0.27, 0.095, z);
      add(g, new THREE.CylinderGeometry(0.04, 0.04, 0.092, 10), 0xffffff, 0.27, 0.096, z);
    }
  },
  // Burger with a few fries.
  (g) => {
    plate(g);
    add(g, new THREE.CylinderGeometry(0.17, 0.17, 0.06, 14), 0xd9a15a, 0, 0.08, 0);
    add(g, new THREE.CylinderGeometry(0.18, 0.18, 0.06, 14), 0x6b3f22, 0, 0.14, 0);
    add(g, new THREE.CylinderGeometry(0.19, 0.19, 0.02, 14), 0x7cc35d, 0, 0.18, 0);
    add(g, new THREE.CylinderGeometry(0.18, 0.18, 0.02, 4), 0xffd166, 0, 0.2, 0);
    add(g, new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xd9a15a, 0, 0.21, 0);
    for (let i = 0; i < 5; i++) add(g, new THREE.BoxGeometry(0.03, 0.03, 0.18), 0xffcc4d, 0.28 + (i % 2) * 0.04, 0.07, -0.1 + i * 0.05).rotation.y = i * 0.3;
  },
  // Strawberry cake slice.
  (g) => {
    plate(g, 0.34);
    const slice = add(g, new THREE.CylinderGeometry(0.28, 0.28, 0.22, 3, 1, false, 0, Math.PI / 3), 0xfff1d6, 0, 0.16, 0);
    slice.rotation.y = -Math.PI / 6;
    add(g, new THREE.CylinderGeometry(0.29, 0.29, 0.04, 3, 1, false, 0, Math.PI / 3), 0xff8fab, 0, 0.29, 0).rotation.y = -Math.PI / 6;
    add(g, new THREE.SphereGeometry(0.05, 8, 6), 0xd94141, 0.1, 0.34, 0.02);
  },
  // Berry mocktail: tall glass, straw, berry.
  (g) => {
    add(g, new THREE.CylinderGeometry(0.1, 0.08, 0.36, 12), 0xc77dff, 0, 0.18, 0);
    add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), 0xffffff, 0.04, 0.4, 0).rotation.z = 0.25;
    add(g, new THREE.SphereGeometry(0.04, 8, 6), 0xd94141, -0.05, 0.38, 0);
  },
  // Fresh juice: orange glass with a slice.
  (g) => {
    add(g, new THREE.CylinderGeometry(0.1, 0.09, 0.3, 12), 0xffa63d, 0, 0.15, 0);
    add(g, new THREE.CylinderGeometry(0.07, 0.07, 0.015, 12), 0xffd166, 0.09, 0.3, 0).rotation.z = Math.PI / 2;
  },
  // Coffee: cup and saucer.
  (g) => {
    add(g, new THREE.CylinderGeometry(0.17, 0.15, 0.03, 16), 0xffffff, 0, 0.015, 0);
    add(g, new THREE.CylinderGeometry(0.1, 0.08, 0.14, 14), 0xffffff, 0, 0.1, 0);
    add(g, new THREE.CylinderGeometry(0.09, 0.09, 0.01, 14), 0x6b3f22, 0, 0.17, 0);
    add(g, new THREE.TorusGeometry(0.045, 0.012, 6, 10), 0xffffff, 0.11, 0.1, 0);
  },
];

export const dishCount = DISHES.length;

export function makeDish(i) {
  const g = new THREE.Group();
  (DISHES[i] || DISHES[0])(g);
  return g;
}
