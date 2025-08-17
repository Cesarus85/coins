import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Münze groß (4× vorher): Ø 14 cm
const COIN_DIAMETER = 0.14;
const GRAVITY = -3.8;        // m/s²
const LIFETIME = 1.2;        // s

// Kompaktere Sparkle-Settings (deutlich kleiner & enger)
const SPARK_COUNT    = 6;    // viel weniger Partikel
const SPARK_LIFETIME = 0.35; // kürzer
const SPARK_SPEED    = 0.5;  // langsamer
const SPARK_GRAVITY  = -3.0;
const SPARK_SIZE     = 3;    // kleiner
const SPARK_CONE_DEG = 8;   // enger Kegel

// Spawn-Offset (Münze & Funken) über Blockoberkante
const COIN_SPAWN_LIFT = 0.12; // 12 cm

export class CoinManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null;
    this.scale = 1;
    this.coins = [];        // { mesh, vel:Vector3, rotSpeed:number, t:number }
    this.sparkSystems = []; // { points:THREE.Points, velocities:Float32Array, t:number }
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

    // Material etwas heller für Passthrough
    root.traverse(o => {
      if (o.isMesh && o.material) {
        if (!o.material.emissive) o.material.emissive = new THREE.Color(0x6a5200);
        if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = Math.max(0.35, o.material.emissiveIntensity ?? 0.35);
        if ('metalness' in o.material) o.material.metalness = Math.max(0.75, o.material.metalness ?? 0.75);
        if ('roughness' in o.material) o.material.roughness = Math.min(0.3, o.material.roughness ?? 0.3);
        if ('opacity' in o.material) { o.material.transparent = true; o.material.opacity = 1.0; }
      }
    });

    this.template = root;
  }

  _makePreviewInstance() {
    if (!this.template) return null;
    const coin = this.template.clone(true);
    coin.scale.setScalar(this.scale);
    coin.position.set(0, -100, 0);
    coin.rotateY(Math.random() * Math.PI * 2);
    coin.rotateX(Math.PI / 2);
    return coin;
  }

  async spawnBurst(worldPos, upNormal = new THREE.Vector3(0,1,0)) {
    if (!this.template) await this._loadTemplate();

    // === Coin ===
    const coin = this.template.clone(true);
    coin.scale.setScalar(this.scale);

    // Coin deutlich über Oberkante spawnen (12 cm)
    const liftedPos = worldPos.clone().add(upNormal.clone().multiplyScalar(COIN_SPAWN_LIFT));
    coin.position.copy(liftedPos);

    // 90°-Drehung, zufällige Y-Rotation
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

    // Startgeschwindigkeit: nach oben + sehr kleine seitliche Varianz (kompakt)
    const vel = upNormal.clone().multiplyScalar(1.4);
    vel.x += (Math.random() - 0.5) * 0.08;
    vel.z += (Math.random() - 0.5) * 0.08;

    const rotSpeed = 9 + Math.random() * 3; // rad/s
    this.coins.push({ mesh: coin, vel, rotSpeed, t: 0 });

    // === Sparkles (deutlich kompakter) ===
    this._spawnSparks(liftedPos, upNormal);

    this.score += 1;
  }

  _spawnSparks(worldPos, upNormal) {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(SPARK_COUNT * 3);
    const velocities = new Float32Array(SPARK_COUNT * 3);
    const colors = new Float32Array(SPARK_COUNT * 3);

    for (let i = 0; i < SPARK_COUNT; i++) {
      const idx = i * 3;
      positions[idx]   = worldPos.x;
      positions[idx+1] = worldPos.y;
      positions[idx+2] = worldPos.z;

      // Richtung in sehr engem Kegel um 'upNormal'
      const dir = randomCone(upNormal, SPARK_CONE_DEG);
      const speed = SPARK_SPEED * (0.9 + Math.random() * 0.2);
      velocities[idx]   = dir.x * speed;
      velocities[idx+1] = dir.y * speed;
      velocities[idx+2] = dir.z * speed;

      // gold -> weiß Varianz
      const c = new THREE.Color().setHSL(0.12 + Math.random()*0.05, 0.9, 0.6 + Math.random()*0.25);
      colors[idx] = c.r; colors[idx+1] = c.g; colors[idx+2] = c.b;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: SPARK_SIZE,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true
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
          if ('opacity' in o.material) o.material.opacity = 1 - k;
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
        vels[idx+1] += SPARK_GRAVITY * dt;
        posAttr.array[idx]   += vels[idx] * dt;
        posAttr.array[idx+1] += vels[idx+1] * dt;
        posAttr.array[idx+2] += vels[idx+2] * dt;
      }
      posAttr.needsUpdate = true;

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

// Zufallsrichtung in engem Kegel (deg) um 'up'
function randomCone(up, deg) {
  const halfAngle = THREE.MathUtils.degToRad(deg);
  const theta = Math.random() * 2 * Math.PI;
  const phi = Math.random() * halfAngle; // 0..halfAngle
  const x = Math.sin(phi) * Math.cos(theta);
  const y = Math.cos(phi);
  const z = Math.sin(phi) * Math.sin(theta);

  const from = new THREE.Vector3(0,1,0);
  const axis = new THREE.Vector3().crossVectors(from, up).normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(from.dot(up), -1, 1));
  const q = new THREE.Quaternion().setFromAxisAngle(axis.lengthSq() < 1e-6 ? from : axis, angle);
  return new THREE.Vector3(x, y, z).applyQuaternion(q).normalize();
}
