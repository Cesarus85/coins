// coins.js – GLB-Coins mit Auto-Scale, 90°-Drehung, Rotation + Bobbing

const THREE_URL = 'https://unpkg.com/three@0.166.1/build/three.module.js';
const THREE = await import(THREE_URL);
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

const { Group, Vector3, Quaternion, Box3, Sphere, Color, Euler, Matrix4 } = THREE;

const TARGET_DIAMETER_M = 0.035; // 3.5 cm
const TARGET_RADIUS_M   = TARGET_DIAMETER_M / 2;

export class CoinManager {
  constructor(scene) {
    this.group = new Group();
    scene.add(this.group);

    // coins: { mesh, radius, anchor?, state, t, basePos, baseQuat, normal, kind, phase, rotSpeed }
    this.coins = [];
    this.score = 0;

    this._loader = new GLTFLoader();
    this._coinTemplate = null;
    this._coinScale = 1.0;
    this._coinRadius = Math.max(0.012, TARGET_RADIUS_M * 0.6);
    this._loadingPromise = null;

    // Animation-Zeit
    this._time0 = performance.now() / 1000;
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

          // Sichtbarkeit in Passthrough leicht erhöhen
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

          // Auto-Scaling auf Zielgröße
          const bounds = new Box3().setFromObject(root);
          const sphere = bounds.getBoundingSphere(new Sphere());
          const srcDiameter = (isFinite(sphere.radius) && sphere.radius > 0) ? sphere.radius * 2 : 1;
          this._coinScale = (srcDiameter > 0) ? (TARGET_DIAMETER_M / srcDiameter) : 1.0;
          this._coinRadius = Math.max(0.012, TARGET_RADIUS_M * 0.6);

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
    // Als „floor“-Coins behandeln
    for (let i = 0; i < floorCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const p = base.clone().add(new Vector3(Math.cos(ang) * r, 0.005, Math.sin(ang) * r));
      this._spawnAtWorld(p, q, { kind: 'floor', normal: new Vector3(0,1,0) });
    }
  }

  /**
   * poseLike: { position: THREE.Vector3, orientation: THREE.Quaternion }
   * meta: { kind: 'floor'|'wall', normal: THREE.Vector3 }
   */
  async spawnAtPose(frame, refSpace, poseLike, { useAnchors = false, meta = { kind:'floor', normal: new Vector3(0,1,0) } } = {}) {
    await this._ensureCoinLoaded();
    if (!useAnchors || !('createAnchor' in XRFrame.prototype)) {
      this._spawnAtWorld(poseLike.position, poseLike.orientation, meta);
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

      // Basispose + Meta speichern
      const coin = {
        mesh,
        radius: this._coinRadius,
        anchor,
        state: 'live',
        t: 0,
        basePos: poseLike.position.clone(),
        baseQuat: poseLike.orientation.clone(),
        normal: meta.normal.clone().normalize(),
        kind: meta.kind,
        phase: Math.random() * Math.PI * 2,
        rotSpeed: 0.6 + Math.random() * 0.5 // rad/s
      };
      this._applyInitialTransform(coin);
      this.coins.push(coin);
    } catch {
      this._spawnAtWorld(poseLike.position, poseLike.orientation, meta);
    }
  }

  _spawnAtWorld(pos, quat, meta) {
    const mesh = this._makeCoinMesh();
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.group.add(mesh);

    const coin = {
      mesh,
      radius: this._coinRadius,
      anchor: null,
      state: 'live',
      t: 0,
      basePos: pos.clone(),
      baseQuat: quat.clone(),
      normal: (meta?.normal ?? new Vector3(0,1,0)).clone().normalize(),
      kind: meta?.kind ?? 'floor',
      phase: Math.random() * Math.PI * 2,
      rotSpeed: 0.6 + Math.random() * 0.5
    };
    this._applyInitialTransform(coin);
    this.coins.push(coin);
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

  // 90°-Drehung + kleiner Wandabstand
  _applyInitialTransform(coin) {
    const { mesh, basePos, baseQuat, normal, kind } = coin;

    // leichte Abstände zur Fläche
    const baseOffset = (kind === 'wall') ? 0.025 : 0.008; // 2.5cm von der Wand, 0.8cm über Boden
    const pos = basePos.clone().add(normal.clone().multiplyScalar(baseOffset));
    mesh.position.copy(pos);

    // Grundausrichtung: an Plane-Orientierung (baseQuat) ausrichten
    mesh.quaternion.copy(baseQuat);

    // Zusatz: 90° um die lokale Y-Achse, damit die Prägung „schöner“ sichtbar ist
    const qAdd = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0, 'YXZ'));
    mesh.quaternion.multiply(qAdd);
  }

  // pro-Frame Animation + Kollisionen
  testCollect(spheres, frame, refSpace, ui) {
    const tNow = performance.now() / 1000 - this._time0;

    // Update Anchor-Pose (Positionsbasis), Animation anwenden
    for (const c of this.coins) {
      // Update anchor -> neue basePos/baseQuat
      if (c.anchor && frame) {
        const pose = frame.getPose(c.anchor.anchorSpace, refSpace);
        if (pose) {
          c.basePos.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
          c.baseQuat.set(
            pose.transform.orientation.x,
            pose.transform.orientation.y,
            pose.transform.orientation.z,
            pose.transform.orientation.w
          );
        }
      }

      // nur „live“-Coins animieren (vanish wird separat animiert)
      if (c.state === 'live') {
        const amp = (c.kind === 'wall') ? 0.01 : 0.012; // Amplitude (m)
        const offset = (c.kind === 'wall') ? 0.025 : 0.008; // Grundabstand
        const bob = Math.sin(tNow * 1.6 + c.phase) * amp;  // Bobbing
        const pos = c.basePos.clone().add(c.normal.clone().multiplyScalar(offset + bob));
        c.mesh.position.copy(pos);

        // stetige Rotation um die (lokale) Y-Achse
        const rotDelta = c.rotSpeed * (1/60); // ~pro Frame
        c.mesh.rotateY(rotDelta);
      }
    }

    // Kollisionsprüfung + Einsammel-Animation
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
        // Skaliere relativ zur Basisgröße
        const baseScale = this._coinScale;
        c.mesh.scale.setScalar(Math.max(0.01, baseScale * (1 + scale)));

        // Emissive „fadet“ aus
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
