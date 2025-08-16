import * as THREE from 'https://unpkg.com/three@0.166.1/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.166.1/examples/jsm/loaders/GLTFLoader.js';

export class CoinManager {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.coins = []; // { mesh, radius, anchor?, state: 'live'|'vanish'|'gone', t }
    this.score = 0;

    // GLB wird lazy geladen (einmal) und dann geklont
    this._loader = new GLTFLoader();
    this._coinTemplate = null;     // THREE.Object3D (geklonbar)
    this._coinRadius = 0.07;       // Default, wird nach dem Laden anhand der Geometrie verfeinert
    this._loadingPromise = null;
  }

  clear() {
    for (const c of this.coins) c.mesh.removeFromParent();
    this.coins.length = 0;
    this.score = 0;
    const scoreEl = document.getElementById('score');
    if (scoreEl) scoreEl.textContent = `Score: 0`;
  }

  /**
   * Laden der GLB-Münze (einmalig), ermittelt einen sinnvollen Kollisionsradius.
   * Du kannst die Datei unter ./assets/coin.glb ablegen.
   */
  async _ensureCoinLoaded() {
    if (this._coinTemplate) return this._coinTemplate;
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = new Promise((resolve, reject) => {
      this._loader.load(
        './assets/coin.glb',
        (gltf) => {
          const root = gltf.scene || gltf.scenes?.[0];
          if (!root) {
            reject(new Error('coin.glb enthält keine Scene.'));
            return;
          }

          // Material leicht „golden“ pushen (falls das GLB kein PBR-Gold hat)
          root.traverse((obj) => {
            if (obj.isMesh) {
              obj.castShadow = false;
              obj.receiveShadow = false;
              // Wenn bereits ein Standard/Physical-Material existiert, lassen wir es weitgehend in Ruhe,
              // erhöhen aber ggf. Emissive leicht für bessere Sichtbarkeit im Passthrough.
              const m = obj.material;
              if (m && ('emissiveIntensity' in m)) {
                if (!m.emissive || m.emissive.equals(new THREE.Color(0x000000))) {
                  m.emissive = new THREE.Color(0x7a5c00);
                }
                m.emissiveIntensity = Math.max(0.25, m.emissiveIntensity ?? 0.25);
                if ('metalness' in m) m.metalness = Math.max(0.7, m.metalness ?? 0.7);
                if ('roughness' in m) m.roughness = Math.min(0.35, m.roughness ?? 0.35);
              }
            }
          });

          // Kollisionsradius grob aus BoundingSphere ableiten
          const bounds = new THREE.Box3().setFromObject(root);
          const sphere = bounds.getBoundingSphere(new THREE.Sphere());
          if (isFinite(sphere.radius) && sphere.radius > 0) {
            // leicht kleiner, damit der „Touch“ nicht zu empfindlich ist
            this._coinRadius = Math.max(0.04, Math.min(0.12, sphere.radius * 0.6));
          }

          // Template für schnelle Klone vorbereiten (matrixAutoUpdate lassen wir an)
          this._coinTemplate = root;
          resolve(this._coinTemplate);
        },
        undefined,
        (err) => reject(err)
      );
    });

    return this._loadingPromise;
  }

  // Fallback-Cluster (z. B. wenn nur Hit-Test verfügbar)
  async spawnClusterAtPose(hitPose, { floorCount = 18, radius = 1.0 } = {}) {
    await this._ensureCoinLoaded();
    const base = new THREE.Vector3(
      hitPose.transform.position.x,
      hitPose.transform.position.y,
      hitPose.transform.position.z
    );
    const q = new THREE.Quaternion(
      hitPose.transform.orientation.x,
      hitPose.transform.orientation.y,
      hitPose.transform.orientation.z,
      hitPose.transform.orientation.w,
    );

    for (let i = 0; i < floorCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const p = base.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.01, Math.sin(ang) * r));
      this._spawnAtWorld(p, q);
    }
  }

  /**
   * Spawn an einer Pose. Nutzt Anchors, wenn verfügbar.
   * poseLike: { position: THREE.Vector3, orientation: THREE.Quaternion }
   */
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
    // Tiefen-Klon der geladenen GLB-Szene
    const coin = this._coinTemplate.clone(true);
    // Optional leichte Variation in der Emissive-Intensität für „Funkeln“
    coin.traverse((obj) => {
      if (obj.isMesh && obj.material && ('emissiveIntensity' in obj.material)) {
        obj.material = obj.material.clone();
        obj.material.emissiveIntensity = (obj.material.emissiveIntensity ?? 0.25) * (0.9 + Math.random() * 0.3);
      }
    });
    return coin;
  }

  testCollect(spheres, frame, refSpace, ui) {
    // Update Anchors → aktualisiere Posen
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

    // Kollision & Sammel-Animation
    let scoreChanged = false;
    const center = new THREE.Vector3();

    for (const c of this.coins) {
      if (c.state === 'live') {
        // Kollisionszentrum (Bounding-Sphere-Mitte): nutze Objektposition.
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
        c.mesh.scale.setScalar(Math.max(0.01, 1 + scale));

        // Emissive visuell „ausklingen“ lassen
        c.mesh.traverse((obj) => {
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
