import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Münze groß (4× vorher): Ø 14 cm
const COIN_DIAMETER = 0.14;
const GRAVITY = -3.8;      // m/s²
const LIFETIME = 1.2;      // Sek.

// Partikel-Einstellungen
const SPARK_COUNT = 28;
const SPARK_LIFETIME = 0.5;   // Sek.
const SPARK_SPEED = 1.2;      // m/s (Start)
const SPARK_GRAVITY = -3.0;   // m/s²
const SPARK_SIZE = 10;        // Pixel

export class CoinManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null;
    this.scale = 1;
    this.coins = []; // {mesh, vel:Vector3, rotSpeed:number, t:number}
    this.sparkSystems = []; // {points:THREE.Points, velocities:Float32Array, t:number}
    this.score = 0;
  }

  async ensureLoaded() {
    if (this.template) return;
    await this._loadTemplate();
  }

  async _loadTemplate() {
    const gltf = await this._load('./assets/coin.glb');
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('coin.glb ohne Szene');

    // Auto-Scale: auf Ø 14 cm
    const bounds = new THREE.Box3().setFromObject(root);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const srcDiameter = (isFinite(sphere.radius) && sphere.radius > 0) ? sphere.radius * 2 : 1;
    this.scale = COIN_DIAMETER / srcDiameter;

    root.traverse(o => {
      if (o.isMesh && o.material) {
        // Etwas „heller“ im Passthrough
        if (!o.material.emissive) o.material.emissive = new THREE.Color(0x6a5200);
        if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = Math.max(0.35, o.material.emissiveIntensity ?? 0.35);
        if ('metalness' in o.material) o.material.metalness = Math.max(0.75, o.material.metalness ?? 0.75);
        if ('roughness' in o.material) o.material.roughness = Math.min(0.3, o.material.roughness ?? 0.3);
        // für Fade-out
        if ('opacity' in o.material) { o.material.transparent = true; o.material.opacity = 1.0; }
      }
    });

    this.template = root;
  }

  _makePreviewInstance() {
    if (!this.template) return null;
    const coin = this.template.clone(true);
    coin.scale.setScalar(this.scale);
    coin.position.set(0, -100, 0); // weit außerhalb
    coin.rotateY(Math.random() * Math.PI * 2);
    coin.rotateX(Math.PI / 2);
    return coin;
  }

  async spawnBurst(worldPos, upNormal = new THREE.Vector3(0,1,0)) {
    if (!this.template) await this._loadTemplate();

    // === Coin ===
    const coin = this.template.clone(true);
    coin.scale.setScalar(this.scale);
    coin.position.copy(worldPos);
    coin.rotateY(Math.random() * Math.PI * 2);
    coin.rotateX(Math.PI / 2);

    coin.traverse(o => {
      if (o.isMesh && o.material && ('emissiveIntensity' in o.material)) {
        o.material = o.material.clone();
        o.material.emissiveIntensity = (o.material.emissiveIntensity ?? 0.35) * (0.95 + Math.random() * 0.25);
        if ('opacity' in o.material) { o.material.transparent = true; o.material.opacity = 1.0; }
      }
    });

    this.scene.add(coin);

    // Startgeschwindigkeit: nach oben + kleine seitliche Varianz
    const vel = upNormal.clone().multiplyScalar(1.6);
    vel.x += (Math.random()-0.5) * 0.25;
    vel.z += (Math.random()-0.5) * 0.25;

    const rotSpeed = 9 + Math.random()*3; // rad/s
    this.coins.push({ mesh: coin, vel, rotSpeed, t: 0 });

    // === Sparkles ===
    this._spawnSparks(worldPos, upNormal);

    this.score += 1;
  }

  _spawnSparks(worldPos, upNormal) {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(SPARK_COUNT * 3);
    const velocities = new Float32Array(SPARK_COUNT * 3);
    const colors = new Float32Array(SPARK_COUNT * 3);

    // Farbverlauf: gold -> weiß
    for (let i = 0; i < SPARK_COUNT; i++) {
      const idx = i * 3;
      positions[idx] = worldPos.x;
      positions[idx+1] = worldPos.y;
      positions[idx+2] = worldPos.z;

      // Velocity in einer „Halbkugel“ nach oben
      const dir = randomHemisphere(upNormal);
      velocities[idx]   = dir.x * (SPARK_SPEED * (0.7 + Math.random()*0.6));
      velocities[idx+1] = dir.y * (SPARK_SPEED * (0.7 + Math.random()*0.6));
      velocities[idx+2] = dir.z * (SPARK_SPEED * (0.7 + Math.random()*0.6));

      // leicht variiertes Gold/Weiß
      const c = new THREE.Color().setHSL(0.12 + Math.random()*0.06, 0.9, 0.6 + Math.random()*0.3);
      colors[idx] = c.r; colors[idx+1] = c.g; colors[idx+2] = c.b;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: SPARK_SIZE,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false
    });

    const points = new THREE.Points(geom, mat);
    this.scene.add(points);

    this.sparkSystems.push({ points, velocities, t: 0 });
  }

  update(dtMs) {
    const dt = (dtMs ?? 16.666) / 1000;

    // === Coins ===
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt;

      // Physik
      c.vel.y += GRAVITY * dt;
      c.mesh.position.addScaledVector(c.vel, dt);

      // Rotation
      c.mesh.rotateY(c.rotSpeed * dt);

      // Fade-out
      const k = Math.min(1, c.t / LIFETIME);
      const scale = 1 + 0.25 * Math.sin(k * Math.PI);
      c.mesh.scale.setScalar(this.scale * scale);

      c.mesh.traverse(o => {
        if (o.isMesh && o.material && ('emissiveIntensity' in o.material)) {
          o.material.emissiveIntensity = (1 - k) * 0.8;
          if ('opacity' in o.material) {
            o.material.opacity = 1 - k;
          }
        }
      });

      if (c.t >= LIFETIME) {
        c.mesh.removeFromParent();
        this.coins.splice(i, 1);
      }
    }

    // === Sparks ===
    for (let i = this.sparkSystems.length - 1; i >= 0; i--) {
      const s = this.sparkSystems[i];
      s.t += dt;

      const k = Math.min(1, s.t / SPARK_LIFETIME);
      const posAttr = s.points.geometry.getAttribute('position');
      const vels = s.velocities;

      for (let p = 0; p < posAttr.count; p++) {
        const idx = p * 3;
        // Gravitation
        vels[idx+1] += SPARK_GRAVITY * dt;
        // Position
        posAttr.array[idx]   += vels[idx] * dt;
        posAttr.array[idx+1] += vels[idx+1] * dt;
        posAttr.array[idx+2] += vels[idx+2] * dt;
      }
      posAttr.needsUpdate = true;

      // Opazität weich ausfaden
      s.points.material.opacity = 1 - k;

      if (s.t >= SPARK_LIFETIME) {
        s.points.removeFromParent();
        s.points.geometry.dispose();
        s.points.material.dispose();
        this.sparkSystems.splice(i, 1);
      }
    }
  }

  _load(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }
}

// Hilfsfunktion: Zufallsrichtung in Hemisphäre um 'up'
function randomHemisphere(up) {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(v); // 0..pi/2 für obere Halbkugel erzwingen:
  const x = Math.sin(phi) * Math.cos(theta);
  const y = Math.cos(phi);
  const z = Math.sin(phi) * Math.sin(theta);

  // Rotationsbasis: align (0,1,0) auf 'up'
  const from = new THREE.Vector3(0,1,0);
  const axis = new THREE.Vector3().crossVectors(from, up).normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(from.dot(up), -1, 1));
  const q = new THREE.Quaternion().setFromAxisAngle(axis.lengthSq() < 1e-6 ? from : axis, angle);
  return new THREE.Vector3(x, y, z).applyQuaternion(q).normalize();
}
