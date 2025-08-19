// ./src/math-game.js
import * as THREE from 'three';

/**
 * Erzeugt Additionsaufgaben (Summe <= 20), verteilt die Ergebnisse auf 4 Würfel,
 * rendert die Zahlen als Canvas-Texturen auf ALLEN 6 Seiten je Würfel,
 * wertet Treffer aus und erzeugt bei richtig sofort die nächste Aufgabe.
 *
 * Erwartet, dass attachBlocks() mit dem Array aus BlocksManager.blocks aufgerufen wird.
 * Jedes Block-Objekt benötigt mindestens { mesh: THREE.Object3D }.
 */
export class MathGame {
  constructor(ui, scene) {
    this.ui = ui;
    this.scene = scene;

    /** @type {{mesh: THREE.Object3D, labelGroup?: THREE.Group}[]} */
    this.blocks = [];
    this.correctIndex = 0;
    this.current = { a: 1, b: 1, sum: 2 };

    /** Cache für Canvas-Texturen pro Zahl */
    this.texCache = new Map();
  }

  /** Muss nach dem Platzieren der Blöcke aufgerufen werden. */
  attachBlocks(blocks) {
    this.blocks = blocks || [];
    for (const b of this.blocks) {
      if (!b?.mesh) continue;
      if (!b.labelGroup) {
        b.labelGroup = this._createLabelGroup();
        b.mesh.add(b.labelGroup);
      }
      this._resizeLabelGroupToBlock(b);
    }
    this._newProblem(true);
  }

  /** true, wenn der getroffene Block korrekt war (dann direkt neue Aufgabe). */
  handleHit(blockIndex) {
    if (blockIndex == null || !this.blocks[blockIndex]) return false;
    const ok = (blockIndex === this.correctIndex);
    if (ok) this._newProblem(false);
    return ok;
  }

  /** Ressourcen aufräumen (Labels/Textures) */
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

  // --------- intern ------------

  _newProblem() {
    // a + b mit Summe <= 20, a,b >= 1
    const a = 1 + Math.floor(Math.random() * 10); // 1..10
    const bMax = Math.min(20 - a, 10);
    const b = 1 + Math.floor(Math.random() * Math.max(1, bMax));
    const sum = a + b;

    this.current = { a, b, sum };
    this.ui?.setEquation?.(`${a} + ${b} = ?`);

    const n = Math.min(4, this.blocks.length);
    if (n === 0) return;

    // korrekter Index
    this.correctIndex = Math.floor(Math.random() * n);

    // falsche Werte generieren (einzigartig, != sum)
    const wrongs = new Set();
    while (wrongs.size < n - 1) {
      const delta = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 5));
      const val = Math.max(0, Math.min(20, sum + delta));
      if (val !== sum) wrongs.add(val);
    }
    const values = [];
    for (let i = 0, w = 0; i < n; i++) {
      if (i === this.correctIndex) values.push(sum);
      else values.push([...wrongs][w++]);
    }

    // Labels aktualisieren
    for (let i = 0; i < n; i++) this._setBlockNumber(this.blocks[i], values[i]);
  }

_createLabelGroup() {
  const g = new THREE.Group();
  g.name = 'labels';

  const geom = new THREE.PlaneGeometry(1, 1);
  const makeMat = () => new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthTest: true,          // NICHT durch den Würfel hindurch zeichnen
    depthWrite: false,
    polygonOffset: true,      // gegen Z-Fighting
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });

  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(geom, makeMat());
    m.renderOrder = 10;       // sicher vor dem Block
    g.add(m);
  }
  return g;
}

  /** Positioniert & skaliert die Label-Gruppe exakt auf die Außenflächen (unabhängig vom Pivot). */
_resizeLabelGroupToBlock(block) {
  const mesh = block.mesh;
  if (!mesh || !block.labelGroup) return;

  // Label-Gruppe kurz abkoppeln, damit sie die Messung NICHT beeinflusst
  const hadParent = !!block.labelGroup.parent;
  mesh.remove(block.labelGroup);

  const worldBox = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3(); worldBox.getSize(size);
  const worldCenter = new THREE.Vector3(); worldBox.getCenter(worldCenter);

  // Danach Labels wieder anhängen
  mesh.add(block.labelGroup);

  // BBox-Zentrum in LOKALE Koordinaten des Blocks
  const localCenter = mesh.worldToLocal(worldCenter.clone());
  block.labelGroup.position.copy(localCenter);

  // Kantenlänge (größte Ausdehnung) und Versatz
  const L    = Math.max(size.x, size.y, size.z);
  const half = L * 0.5;
  const face = L * 0.72;      // 72% der Seitenlänge
  const eps  = L * 0.03;      // 3% vor die Oberfläche → robust gegen Z-Fighting

  // Planes skalieren
  const p = block.labelGroup.children;
  for (const plane of p) plane.scale.set(face, face, 1);

  // +X / -X
  p[0].position.set( half + eps, 0, 0); p[0].rotation.set(0, -Math.PI/2, 0);
  p[1].position.set(-half - eps, 0, 0); p[1].rotation.set(0,  Math.PI/2,  0);
  // +Y / -Y
  p[2].position.set(0,  half + eps, 0); p[2].rotation.set( Math.PI/2, 0, 0);
  p[3].position.set(0, -half - eps, 0); p[3].rotation.set(-Math.PI/2, 0, 0);
  // +Z / -Z
  p[4].position.set(0, 0,  half + eps); p[4].rotation.set(0, 0, 0);
  p[5].position.set(0, 0, -half - eps); p[5].rotation.set(0,  Math.PI, 0);
}

  _setBlockNumber(block, value) {
    if (!block?.labelGroup) return;
    const text = String(value);
    const tex = this._getOrMakeNumberTexture(text);

    block.labelGroup.traverse(o => {
      if (o.isMesh && o.material) {
        o.material.map = tex;
        o.material.needsUpdate = true;
      }
    });
  }

_getOrMakeNumberTexture(text) {
  if (this.texCache.has(text)) return this.texCache.get(text);

  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');

  ctx.clearRect(0, 0, size, size);
  ctx.font = `${size * 0.62}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // dunkle Outline für Kontrast
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.06;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, size / 2, size / 2);

  // helle Füllung
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, size / 2, size / 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; // richtige Farbraum-Kodierung
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  this.texCache.set(text, tex);
  return tex;
}
}
