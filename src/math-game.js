// ./math-game.js
import * as THREE from 'three';

/**
 * Generiert Additionsaufgaben (Summe <= 20), mappt Antworten auf Blöcke,
 * rendert Zahlen auf allen 6 Seiten und wertet Treffer aus.
 */
export class MathGame {
  constructor(ui, scene) {
    this.ui = ui;
    this.scene = scene;

    /** @type {{mesh: THREE.Object3D, labelGroup?: THREE.Group}[]} */
    this.blocks = [];
    this.correctIndex = 0;
    this.current = { a: 1, b: 1, sum: 2 };

    // Cache für Textur je Zahl
    this.texCache = new Map();
  }

  /** Nach dem Platzieren der Blöcke aufrufen. */
  attachBlocks(blocks) {
    this.blocks = blocks;
    this.blocks.forEach((b) => {
      if (!b.labelGroup) {
        b.labelGroup = this._createLabelGroup();
        b.mesh.add(b.labelGroup);
      }
    });
    this._newProblem(true);
  }

  /** true, wenn der getroffene Block korrekt war (triggert neue Aufgabe). */
  handleHit(blockIndex) {
    if (blockIndex == null || !this.blocks[blockIndex]) return false;
    const isCorrect = (blockIndex === this.correctIndex);
    if (isCorrect) {
      this._newProblem(false);
    }
    return isCorrect;
  }

  /** Labels & Texturen aufräumen. */
  dispose() {
    for (const b of this.blocks) {
      if (b.labelGroup) {
        b.labelGroup.traverse(o => {
          if (o.isMesh && o.material?.map) o.material.map.dispose?.();
          if (o.isMesh && o.material) o.material.dispose?.();
          if (o.geometry) o.geometry.dispose?.();
        });
        b.labelGroup.removeFromParent();
        b.labelGroup = undefined;
      }
    }
    this.texCache.forEach(tex => tex.dispose?.());
    this.texCache.clear();
  }

  // --- intern ---

  _newProblem() {
    // a + b mit Summe <= 20, a,b >= 1
    const a = 1 + Math.floor(Math.random() * 10);         // 1..10
    const bMax = Math.min(20 - a, 10);
    const b = 1 + Math.floor(Math.random() * bMax);
    const sum = a + b;
    this.current = { a, b, sum };
    this.ui?.setEquation?.(`${a} + ${b} = ?`);

    // Korrekt-Index zufällig
    this.correctIndex = Math.floor(Math.random() * Math.min(4, this.blocks.length));

    // 3 plausible Falschantworten
    const answers = new Set([sum]);
    const candidates = new Set();
    for (const d of [-3,-2,-1,1,2,3,4,-4]) {
      const v = sum + d; if (v >= 0 && v <= 20) candidates.add(v);
    }
    while (candidates.size < 8) candidates.add(Math.floor(Math.random() * 21));
    const wrong = [];
    for (const v of candidates) {
      if (!answers.has(v)) { wrong.push(v); answers.add(v); }
      if (wrong.length >= 3) break;
    }

    // 4 Werte verteilen
    const values = Array(4).fill(null);
    values[this.correctIndex] = sum;
    let wi = 0;
    for (let i=0;i<4 && i<this.blocks.length;i++) {
      if (i === this.correctIndex) continue;
      values[i] = wrong[wi++];
    }

    // Labels updaten
    for (let i=0;i<4 && i<this.blocks.length;i++) {
      this._setBlockNumber(this.blocks[i], values[i]);
    }
  }

  _createLabelGroup() {
    // 6 Planes (eine pro Würfelseite), leicht über der Oberfläche
    const g = new THREE.Group();
    const size = 0.22; // Sichtfläche
    const geom = new THREE.PlaneGeometry(size, size);

    const makeMat = () => {
      const mat = new THREE.MeshBasicMaterial({ transparent: true });
      mat.depthTest = true; mat.depthWrite = false; mat.polygonOffset = true; mat.polygonOffsetFactor = -2;
      return mat;
    };

    const planes = [];
    for (let i=0;i<6;i++) {
      const m = new THREE.Mesh(geom, makeMat());
      m.name = `label_face_${i}`;
      planes.push(m); g.add(m);
    }

    const d = 0.16, eps = 0.002;
    // +X / -X
    planes[0].position.set( d+eps, 0, 0); planes[0].rotation.y = -Math.PI/2;
    planes[1].position.set(-d-eps, 0, 0); planes[1].rotation.y =  Math.PI/2;
    // +Y / -Y
    planes[2].position.set(0,  d+eps, 0); planes[2].rotation.x =  Math.PI/2;
    planes[3].position.set(0, -d-eps, 0); planes[3].rotation.x = -Math.PI/2;
    // +Z / -Z
    planes[4].position.set(0, 0,  d+eps);
    planes[5].position.set(0, 0, -d-eps); planes[5].rotation.y =  Math.PI;

    return g;
  }

  _setBlockNumber(block, value) {
    const text = String(value);
    const tex = this._getOrMakeNumberTexture(text);
    const group = block.labelGroup;
    if (!group) return;
    group.traverse(o => {
      if (o.isMesh && o.material) { o.material.map = tex; o.material.needsUpdate = true; }
    });
  }

  _getOrMakeNumberTexture(text) {
    if (this.texCache.has(text)) return this.texCache.get(text);
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');

    ctx.clearRect(0,0,size,size);
    // Schatten
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = 'bold 190px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, size/2 + 3, size/2 + 6);
    // Zahl
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 8;
    ctx.strokeText(text, size/2, size/2);
    ctx.fillText(text, size/2, size/2);

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4; tex.needsUpdate = true;
    this.texCache.set(text, tex);
    return tex;
  }
}
