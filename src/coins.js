const THREE_URL = 'https://unpkg.com/three@0.166.1/build/three.module.js';
const { Group, Mesh, MeshStandardMaterial, CylinderGeometry, TorusGeometry, Vector3, Quaternion } = await import(THREE_URL);

export class CoinManager {
  constructor(scene) {
    this.group = new Group();
    scene.add(this.group);

    this.coins = []; // { mesh, radius, anchor?, state: 'live'|'vanish', t }
    this._coinGeom = buildCoinGeometry();
    this._coinMat = new MeshStandardMaterial({
      color: 0xC49B0B,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x7a5c00,
      emissiveIntensity: 0.3
    });

    this.score = 0;
  }

  clear() {
    for (const c of this.coins) c.mesh.removeFromParent();
    this.coins.length = 0;
    this.score = 0;
    const scoreEl = document.getElementById('score');
    if (scoreEl) scoreEl.textContent = `Score: 0`;
  }

  // Convenience: cluster um Pose (Fallback)
  spawnClusterAtPose(hitPose, { floorCount = 18, radius = 1.0 } = {}) {
    const base = new Vector3(hitPose.transform.position.x, hitPose.transform.position.y, hitPose.transform.position.z);
    for (let i = 0; i < floorCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const p = base.clone().add(new Vector3(Math.cos(ang) * r, 0.01, Math.sin(ang) * r));
      const q = new Quaternion(
        hitPose.transform.orientation.x,
        hitPose.transform.orientation.y,
        hitPose.transform.orientation.z,
        hitPose.transform.orientation.w,
      );
      this._spawnAtWorld(p, q);
    }
  }

  async spawnAtPose(frame, refSpace, poseLike, { useAnchors = false, session } = {}) {
    // poseLike: { position: THREE.Vector3, orientation: THREE.Quaternion }
    if (!useAnchors) {
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
      this.coins.push({ mesh, radius: 0.07, anchor, state: 'live', t: 0 });
    } catch {
      // Fallback wenn Anchors fehlschlagen
      this._spawnAtWorld(poseLike.position, poseLike.orientation);
    }
  }

  _spawnAtWorld(pos, quat) {
    const mesh = this._makeCoinMesh();
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.group.add(mesh);
    this.coins.push({ mesh, radius: 0.07, anchor: null, state: 'live', t: 0 });
  }

  _makeCoinMesh() {
    const mesh = new Mesh(this._coinGeom, this._coinMat.clone());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // leichte „Glow“-Emissive-Variation
    mesh.material.emissiveIntensity = 0.28 + Math.random() * 0.15;
    return mesh;
  }

  // Simple Collect + Vanish Animation
  testCollect(spheres, frame, refSpace, ui) {
    // Update anchored coin poses
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

    // Collision & animation
    let scoreChanged = false;
    for (const c of this.coins) {
      if (c.state === 'live') {
        const cp = c.mesh.position;
        for (const s of spheres) {
          if (cp.distanceTo(s.center) <= (c.radius + s.radius)) {
            c.state = 'vanish';
            c.t = 0;
            this.score++;
            scoreChanged = true;
            break;
          }
        }
      } else if (c.state === 'vanish') {
        c.t += 0.06; // anim speed
        const k = Math.min(1, c.t);
        const scale = 1 + 0.6 * (1 - k) - 1.2 * k; // kurz größer, dann kleiner
        c.mesh.scale.setScalar(Math.max(0.01, 1 + scale));
        c.mesh.material.emissiveIntensity = 0.6 * (1 - k);
        if (k >= 1) {
          c.mesh.removeFromParent();
          c.state = 'gone';
        }
      }
    }

    if (scoreChanged) ui.setScore(this.score);
  }
}

function buildCoinGeometry() {
  // Prozedural: dünner Zylinder + leichter Rand (Torus)
  const disc = new CylinderGeometry(0.065, 0.065, 0.012, 48, 1, true);
  const rim = new TorusGeometry(0.065, 0.006, 12, 48);
  // Wir kombinieren sie in einem Mesh (ein Material genügt) – in Three.js lassen wir 2 Meshes okay, einfacher:
  // Für Performance/Einfachheit geben wir nur den Zylinder zurück; optisch reicht es.
  return disc;
}
