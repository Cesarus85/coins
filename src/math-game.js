// ./src/math-game.js
import * as THREE from 'three';

export class MathGame {
  constructor(ui, scene) {
    this.ui = ui;
    this.scene = scene;
    this.blocks = [];
    this.correctIndex = 0;
    this.current = { a: 1, b: 1, sum: 2 };
    this.texCache = new Map();
  }

  attachBlocks(blocks) {
    this.blocks = blocks || [];
    for (const b of this.blocks) {
      if (!b?.mesh) continue;
      if (!b.labelGroup) {
        b.labelGroup = this._createLabelGroup();
        b.mesh.add(b.labelGroup);
      }
      this._resizeAndPlaceLabels(b);   // NEU: genaue Platzierung/Ausrichtung
    }
    this._newProblem(true);
  }

  handleHit(blockIndex) {
    if (blockIndex == null || !this.blocks[blockIndex]) return false;
    const ok = (blockIndex === this.correctIndex);
    if (ok) this._newProblem(false);
    return ok;
  }

  dispose() {
    for (const b of this.blocks) {
      if (!b?.labelGroup) continue;
      b.labelGroup.traverse(o => {
        if (o.isMesh && o.material?.map) o.material.map.dispose?.();
        if (o.isMesh && o.material) o.material.dispose?.();
        if (o.geometry) o.geometry.dispose?.();
      });
      b.labelGroup.removeFromParent();
      b.labelGroup = undefined;
    }
    this.texCache.forEach(t => t.dispose?.());
    this.texCache.clear();
  }

  // ---------- Aufgaben ----------

  _newProblem() {
    const a = 1 + Math.floor(Math.random() * 10);
    const bMax = Math.min(20 - a, 10);
    const b = 1 + Math.floor(Math.random() * Math.max(1, bMax));
    const sum = a + b;

    this.current = { a, b, sum };
    this.ui?.setEquation?.(`${a} + ${b} = ?`);

    const n = Math.min(4, this.blocks.length);
    if (!n) return;

    this.correctIndex = Math.floor(Math.random() * n);

    const answers = new Set([sum]);
    const candidates = new Set();
    for (const d of [-4,-3,-2,-1,1,2,3,4]) {
      const v = sum + d; if (v >= 0 && v <= 20) candidates.add(v);
    }
    while (candidates.size < 8) candidates.add(Math.floor(Math.random() * 21));

    const wrong = [];
    for (const v of candidates) { if (!answers.has(v)) { wrong.push(v); answers.add(v); } if (wrong.length >= 3) break; }

    const values = Array(n).fill(null);
    values[this.correctIndex] = sum;
    let wi = 0;
    for (let i = 0; i < n; i++) if (i !== this.correctIndex) values[i] = wrong[wi++];

    for (let i = 0; i < n; i++) this._setBlockNumber(this.blocks[i], values[i]);
  }

  // ---------- Labels ----------

  _createLabelGroup() {
    const g = new THREE.Group();
    const geom = new THREE.PlaneGeometry(1, 1);

    const makeMat = () => new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.FrontSide,   // nur Vorderseite (kein „Spiegeln“)
      toneMapped: false,
      depthTest: false,        // immer „oben“
      depthWrite: false
    });

    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geom, makeMat());
      m.renderOrder = 999;     // sicher über dem Würfel
      m.name = `label_face_${i}`;
      g.add(m);
    }
    return g;
  }

  _resizeAndPlaceLabels(block) {
    const mesh = block.mesh;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    const L = Math.max(size.x, size.y, size.z);
    const half = L * 0.5;

    const faceSize = L * 0.8;         // größer lesbar
    const offset  = L * 0.08;         // weiter VOR die Fläche (Fix gegen „im Würfel“)

    const planes = block.labelGroup.children;
    for (const p of planes) p.scale.set(faceSize, faceSize, 1);

    // Für jede Seite: Normalen- und Up-Vektor definieren
    const faces = [
      { n: new THREE.Vector3( 1, 0, 0), up: new THREE.Vector3(0, 1, 0) }, // +X
      { n: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) }, // -X
      { n: new THREE.Vector3( 0, 1, 0), up: new THREE.Vector3(0, 0, 1) }, // +Y (Up = +Z, damit Text „oben“ zeigt)
      { n: new THREE.Vector3( 0,-1, 0), up: new THREE.Vector3(0, 0,-1) }, // -Y
      { n: new THREE.Vector3( 0, 0, 1), up: new THREE.Vector3(0, 1, 0) }, // +Z
      { n: new THREE.Vector3( 0, 0,-1), up: new THREE.Vector3(0, 1, 0) }, // -Z
    ];

    // Helper: Plane so drehen, dass +Z der Plane in Richtung n zeigt und +Y mit „up“ ausgerichtet wird
    const zAxis = new THREE.Vector3(0,0,1);
    const yAxis = new THREE.Vector3(0,1,0);
    const tmpQ  = new THREE.Quaternion();
    const tmpV  = new THREE.Vector3();
    const m3    = new THREE.Matrix3();

    for (let i = 0; i < 6; i++) {
      const p = planes[i];
      const { n, up } = faces[i];

      // Erst z-Achse ausrichten
      tmpQ.setFromUnitVectors(zAxis, n);
      p.quaternion.copy(tmpQ);

      // Dann um n drehen, bis Y-Achse der Plane dem gewünschten Up entspricht
      tmpV.copy(yAxis).applyQuaternion(p.quaternion);        // aktuelles Up der Plane
      const angle = Math.atan2(tmpV.clone().cross(up).dot(n), tmpV.dot(up)); // signed angle um n
      p.rotateOnAxis(n, angle);

      // Position leicht vor die echte Fläche
      p.position.copy(n).multiplyScalar(half + offset);
    }
  }

  _setBlockNumber(block, value) {
    if (!block?.labelGroup) return;
    const text = String(value);
    const tex = this._getOrMakeNumberTexture(text);
    block.labelGroup.traverse(o => {
      if (o.isMesh && o.material) { o.material.map = tex; o.material.needsUpdate = true; }
    });
  }

  _getOrMakeNumberTexture(text) {
    if (this.texCache.has(text)) return this.texCache.get(text);
    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');

    ctx.clearRect(0,0,size,size);
    ctx.font = 'bold 360px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Schatten
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(text, size/2 + 6, size/2 + 8);

    // Outline
    ctx.lineWidth = 18;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, size/2, size/2);

    // Füllung
    ctx.fillStyle = '#fff';
    ctx.fillText(text, size/2, size/2);

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.needsUpdate = true;

    this.texCache.set(text, tex);
    return tex;
  }
}
