// coins.js – GLB-Coins mit Auto-Scale auf Ziel-Durchmesser

const THREE_URL = 'https://unpkg.com/three@0.166.1/build/three.module.js';
const THREE = await import(THREE_URL);
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

const { Group, Vector3, Quaternion, Box3, Sphere, Color } = THREE;

// Zielgröße in Metern (Durchmesser der Münze im AR-Raum)
const TARGET_DIAMETER_M = 0.035; // 3.5 cm
const TARGET_RADIUS_M   = TARGET_DIAMETER_M / 2;

export class CoinManager {
  constructor(scene) {
    this.group = new Group();
    scene.add(this.group);

    this.coins = []; // { mesh, radius, anchor?, state: 'live'|'vanish'|'gone', t }
    this.score = 0;

    this._loader = new GLTFLoader();
    this._coinTemplate = null;
    this._coinScale = 1.0;
    this._coinRadius = Math.max(0.02, TARGET_RADIUS_M * 0.6); // Kollisions-Radius (etwas kleiner als sichtbarer)
    this._loadingPromise = null;
  }

  clear() {
    for (const c of this.coins) c.mesh.removeFromParent();
    this.coins.length = 0;
    this.score = 0;
    const scoreEl = document.getElementById('score');
    if (scoreEl) scoreEl.textContent = `Score: 0`;
  }

  async _ensureCoinLoaded() {
    if (this._coinTemplate) return this._coinTemplate;
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = new Promise((resolve, reject) => {
      this._loader.load(
        './assets/coin.glb',
        (gltf) => {
          const root = gltf.scene || gltf.scenes?.[0];
          if (!root) return reject(new Error('coin.glb enthält keine Scene.'));

          // Sichtbarkeit in Passthrough erhöhen (optional, dezent)
          root.traverse(obj => {
            if (obj.isMesh && obj.material) {
              if (!obj.material.emissive) obj.material.emissive = new Color(0x5a4300);
              if ('emissiveIntensity' in obj.material) obj.material.emissiveIntensity = Math.max(0.18, obj.material.emissiveIntensity ?? 0.18);
              if ('metalness' in obj.material) obj.material.metalness = Math.max(0.7, obj.material.metalness ?? 0.7);
              if ('roughness' in obj.material) obj.material.roughness = Math.min(0.4, obj.material.roughness ?? 0.4);
              obj.castShadow = false;
              obj.receiveShadow = false;
            }
          });

          // Auto-Scaling: Bounding-Sphere → auf Ziel-Durchmesser skalieren
          const bounds = new Box3().setFromObject(root);
          const sphere = bounds.getBoundingSphere(new Sphere());
          const srcDiameter = (isFinite(sphere.radius) && sphere.radius > 0) ? sphere.radius * 2 : 1;
          this._coinScale = (srcDiameter > 0) ? (TARGET_DIAMETER_M / srcDiameter) : 1.0;

          // Kollisionsradius passend zur Zielgröße
          this._coinRadius = Math.max(0.012, TARGET_RADIUS_M * 0.6);

          // Template speichern (unskaliert); wir skalieren pro Klon
          this._coinTemplate = root;
          resolve(this._coinTemplate);
        },
        undefined,
        (err) => reject(err)
      );
    });

    return this._loadingPromise;
  }

  // Fallback-Cluster (Hit-Test)
  async spawnClusterAtPose(hitPose, { floorCount = 12, radius = 0.8 } = {}) {
    await this._ensureCoinLoaded();
    const base = new Vector3(
      hitPose.transform.position.x,
      hitPose.transform.position.y,
      hitPose.transform.position.z
    );
    const q = new Quaternion(
      hitPose.transform.orientation.x,
      hitPose.transform.orientation.y,
      hitPose.transform.orientation.z,
      hitPose.transform.orientation.w,
    );

    for (let i = 0; i < floorCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const p = base.clone().add(new Vector3(Math.cos(ang) * r, 0.005, Math.sin(ang) * r));
      this._spawnAtWorld(p, q);
    }
  }

  async spawnAtPose(frame, refSpace, poseLike, { useAnchors = false } = {}) {
    await this._ensureCoinLoaded();

    if (!useAnchors || !('createAnchor' in XRFrame.prototype)) {
      this._spawnAtWorld(poseLike.position, poseLike.orientation);
      return;
    }
    try {
      const anchor = await frame.createAnchor(
        new XRRigidTransform(
          { x: poseLike.position.x, y: poseLike.position.y, z: poseLike.position.z },
          { x: poseLike.orientation.x, y: poseLike.orientation.y, z: poseLike.orientation.z, w: poseLike.orientation.w }
        ),
        refSpace
      );
      const mesh = this._makeCoinMesh();
      mesh.userData.anchor = anchor;
      this.group.add(mesh);
      this.coins.push({ mesh, radius: this._coinRadius, anchor, state: 'live', t: 0 });
    } catch {
      this._spawnAtWorld(poseLike.position, poseLike.orientation);
    }
  }

  _spawnAtWorld(pos, quat) {
    const mesh = this._makeCoinMesh();
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.group.add(mesh);
    this.coins.push({ mesh, radius: this._coinRadius, anchor: null, state: 'live', t: 0 });
  }

  _makeCoinMesh() {
    const coin = this._coinTemplate.clone(true);
    coin.scale.setScalar(this._coinScale);

    // kleines Funkeln
    coin.traverse(obj => {
      if (obj.isMesh && obj.material && ('emissiveIntensity' in obj.material)) {
        obj.material = obj.material.clone();
        obj.material.emissiveIntensity = (obj.material.emissiveIntensity ?? 0.18) * (0.9 + Math.random() * 0.3);
      }
    });
    return coin;
  }

  testCollect(spheres, frame, refSpace, ui) {
    // Anchor-Posen aktualisieren
    for (const c of this.coins) {
      if (c.anchor && frame) {
        const pose = frame.getPose(c.anchor.anchorSpace, refSpace);
        if (pose) {
          c.mesh.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
          c.mesh.quaternion.set(
            pose.transform.orientation.x,
            pose.transform.orientation.y,
            pose.transform.orientation.z,
            pose.transform.orientation.w
          );
        }
      }
    }

    // Kollisionsprüfung & Einsammel-Animation
    let scoreChanged = false;
    const center = new Vector3();

    for (const c of this.coins) {
      if (c.state === 'live') {
        center.copy(c.mesh.position);
        for (const s of spheres) {
          if (center.distanceTo(s.center) <= (c.radius + s.radius)) {
            c.state = 'vanish';
            c.t = 0;
            this.score++;
            scoreChanged = true;
            break;
          }
        }
      } else if (c.state === 'vanish') {
        c.t += 0.06;
        const k = Math.min(1, c.t);
        const scale = 1 + 0.6 * (1 - k) - 1.2 * k;
        c.mesh.scale.setScalar(Math.max(0.01, this._coinScale * (1 + scale)));

        c.mesh.traverse(obj => {
          if (obj.isMesh && obj.material && ('emissiveIntensity' in obj.material)) {
            obj.material.emissiveIntensity = 0.6 * (1 - k);
          }
        });
        if (k >= 1) {
          c.mesh.removeFromParent();
          c.state = 'gone';
        }
      }
    }

    if (scoreChanged) ui.setScore(this.score);
  }
}
