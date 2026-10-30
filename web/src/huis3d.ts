// Het huis als echt 3D-model dat je rond kunt draaien (three.js). Het gebruikt dezelfde indeling als de plattegrond in
// huis.ts, dus zodra de echte indeling er is, klopt dit model ook. Ruimtes met licht aan gloeien warm, de gekozen ruimte
// ijsblauw. Slepen draait, scrollen zoomt, klikken kiest een ruimte. Dit bestand wordt pas geladen als je "Draai" kiest.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { lagen, type Ruimte } from './huis';

type Info = { aan: boolean; temp: string };
type Opties = { kies: (ruimte: Ruimte) => void; info: (ruimte: Ruimte) => Info };
type Stand = { gekozen: string | null; verdieping: string };

const BREED = 10; // het huis is 10 eenheden breed; de diepte volgt uit de hoogte van elke laag in huis.ts
const AFSTAND = 3.1; // tussen de verdiepingen
const KLEUR = { vloer: 0x161b23, muur: 0xc7ced8, warm: 0xffb866, ijs: 0xa8d8ff };

export function maakHuis3d(plek: HTMLElement, opties: Opties) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Draaibaar 3D-model van het huis. Sleep om te draaien, klik op een ruimte om die te kiezen.');
  renderer.domElement.setAttribute('role', 'img');
  const label = document.createElement('div');
  label.className = 'huis3d-label';
  label.hidden = true;
  plek.append(renderer.domElement, label);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  camera.position.set(19, 16, 21);
  const besturing = new OrbitControls(camera, renderer.domElement);
  besturing.target.set(0, AFSTAND, 1);
  besturing.enableDamping = true;
  besturing.enablePan = false;
  besturing.minDistance = 12;
  besturing.maxDistance = 40;
  besturing.maxPolarAngle = 1.35;
  const rustig = matchMedia('(prefers-reduced-motion: reduce)').matches;
  besturing.autoRotate = !rustig;
  besturing.autoRotateSpeed = 0.35;
  // Na zelf draaien stopt het langzame ronddraaien.
  besturing.addEventListener('start', () => (besturing.autoRotate = false));

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x0b0e14, 1.1));
  const zon = new THREE.DirectionalLight(0xffffff, 1.4);
  zon.position.set(8, 20, 12);
  scene.add(zon);

  // Per ruimte: de vloer (voor klikken en de gloed), een lichtvlak en de muren.
  type Stuk = { ruimte: Ruimte; laag: number; vloer: THREE.Mesh; gloed: THREE.Mesh; lamp: THREE.PointLight; muren: THREE.Object3D };
  const stukken: Stuk[] = [];
  const muurMateriaal = new THREE.MeshStandardMaterial({ color: KLEUR.muur, transparent: true, opacity: 0.22, roughness: 0.2, metalness: 0.1, depthWrite: false });
  const lijnMateriaal = new THREE.LineBasicMaterial({ color: KLEUR.muur, transparent: true, opacity: 0.55 });
  const groepen: THREE.Group[] = [];

  lagen.forEach((laag, i) => {
    const groep = new THREE.Group();
    groep.position.y = i * AFSTAND;
    const diep = laag.hoogte / 10;
    const muurHoog = laag.muur / 28;
    for (const r of laag.ruimtes) {
      const w = (r.w / 100) * BREED;
      const d = (r.h / 100) * diep;
      const x = -BREED / 2 + (r.l / 100) * BREED + w / 2;
      const z = -5 + (r.t / 100) * diep + d / 2;
      const vloer = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 0.14, d - 0.04), new THREE.MeshStandardMaterial({ color: KLEUR.vloer, roughness: 0.85, transparent: true }));
      vloer.position.set(x, 0, z);
      vloer.userData.ruimte = r.id;
      const gloed = new THREE.Mesh(
        new THREE.PlaneGeometry(w - 0.2, d - 0.2),
        new THREE.MeshBasicMaterial({ color: KLEUR.warm, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      gloed.rotation.x = -Math.PI / 2;
      gloed.position.set(x, 0.08, z);
      const lamp = new THREE.PointLight(KLEUR.warm, 0, Math.max(w, d) * 1.4, 1.6);
      lamp.position.set(x, muurHoog * 0.8, z);
      const muren = new THREE.Group();
      const rand = new THREE.BoxGeometry(w, muurHoog, d);
      muren.add(new THREE.LineSegments(new THREE.EdgesGeometry(rand), lijnMateriaal));
      for (const [mw, md, mx, mz] of [
        [w, 0.05, 0, -d / 2],
        [w, 0.05, 0, d / 2],
        [0.05, d, -w / 2, 0],
        [0.05, d, w / 2, 0],
      ]) {
        const muur = new THREE.Mesh(new THREE.BoxGeometry(mw, muurHoog, md), muurMateriaal);
        muur.position.set(mx, 0, mz);
        muren.add(muur);
      }
      muren.position.set(x, muurHoog / 2 + 0.07, z);
      groep.add(vloer, gloed, lamp, muren);
      stukken.push({ ruimte: r, laag: i, vloer, gloed, lamp, muren });
    }
    scene.add(groep);
    groepen.push(groep);
  });

  // Een zachte schaduw onder het huis, zodat het niet zweeft.
  const verloop = document.createElement('canvas');
  verloop.width = verloop.height = 128;
  const pen = verloop.getContext('2d')!;
  const rond = pen.createRadialGradient(64, 64, 0, 64, 64, 64);
  rond.addColorStop(0, 'rgba(0,0,0,0.55)');
  rond.addColorStop(1, 'rgba(0,0,0,0)');
  pen.fillStyle = rond;
  pen.fillRect(0, 0, 128, 128);
  const schaduw = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 22),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(verloop), transparent: true, depthWrite: false }),
  );
  schaduw.rotation.x = -Math.PI / 2;
  schaduw.position.y = -0.2;
  schaduw.scale.set(1, 0.8, 1);
  scene.add(schaduw);

  let stand: Stand = { gekozen: null, verdieping: 'alle' };
  function zet(nieuw: Stand) {
    stand = nieuw;
    const focus = lagen.findIndex((l) => l.id === stand.verdieping);
    groepen.forEach((g, i) => {
      // Een gekozen verdieping komt naar voren: wat erboven zit schuift omhoog en wordt bijna onzichtbaar.
      g.userData.doelY = i * AFSTAND + (focus >= 0 && i > focus ? 2.4 : 0);
      g.userData.doelZicht = focus < 0 || i === focus ? 1 : 0.18;
    });
    for (const s of stukken) {
      const { aan } = opties.info(s.ruimte);
      const gekozen = s.ruimte.id === stand.gekozen;
      const gloed = s.gloed.material as THREE.MeshBasicMaterial;
      gloed.color.set(gekozen && !aan ? KLEUR.ijs : KLEUR.warm);
      gloed.userData.doel = aan ? 0.75 : gekozen ? 0.3 : 0;
      s.lamp.userData.doel = aan ? 2.2 : 0;
    }
    besturing.target.y = focus >= 0 ? focus * AFSTAND + 0.5 : AFSTAND;
  }

  // Zachte overgangen: elke frame een stukje richting het doel.
  const naar = (nu: number, doel: number) => nu + (doel - nu) * 0.12;
  function stap() {
    for (const g of groepen) {
      g.position.y = naar(g.position.y, g.userData.doelY ?? g.position.y);
      const zicht = naar(g.userData.zicht ?? 1, g.userData.doelZicht ?? 1);
      g.userData.zicht = zicht;
      g.visible = zicht > 0.05;
    }
    for (const s of stukken) {
      const gloed = s.gloed.material as THREE.MeshBasicMaterial;
      const zicht = groepen[s.laag].userData.zicht ?? 1;
      gloed.opacity = naar(gloed.opacity, (gloed.userData.doel ?? 0) * zicht);
      s.lamp.intensity = naar(s.lamp.intensity, (s.lamp.userData.doel ?? 0) * zicht);
      const vloer = s.vloer.material as THREE.MeshStandardMaterial;
      vloer.opacity = zicht;
      vloer.depthWrite = zicht > 0.99;
      s.muren.visible = zicht > 0.5;
    }
  }

  // Wijzen en klikken: welke ruimte zit onder de muis?
  const straal = new THREE.Raycaster();
  const punt = new THREE.Vector2();
  const raak = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    punt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    straal.setFromCamera(punt, camera);
    const zichtbaar = stukken.filter((s) => (groepen[s.laag].userData.zicht ?? 1) > 0.5).map((s) => s.vloer);
    const treffer = straal.intersectObjects(zichtbaar)[0];
    return treffer ? stukken.find((s) => s.vloer === treffer.object) : undefined;
  };
  let neer: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (neer = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (e) => {
    // Alleen een klik, geen sleepbeweging, kiest een ruimte.
    if (neer && Math.hypot(e.clientX - neer.x, e.clientY - neer.y) < 5) {
      const s = raak(e);
      if (s) opties.kies(s.ruimte);
    }
    neer = null;
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const s = raak(e);
    renderer.domElement.style.cursor = s ? 'pointer' : 'grab';
    label.hidden = !s;
    if (!s) return;
    const { temp, aan } = opties.info(s.ruimte);
    label.textContent = `${s.ruimte.naam}${temp ? ` · ${temp}` : ''}${aan ? ' · licht aan' : ''}`;
    const r = plek.getBoundingClientRect();
    label.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
  });
  renderer.domElement.addEventListener('pointerleave', () => (label.hidden = true));

  function maat() {
    const { width, height } = plek.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Bij een smal vak verder weg, zodat het hele huis erop past.
    camera.zoom = width < 600 ? 0.8 : Math.min(1, width / height / 0.8);
    camera.updateProjectionMatrix();
  }
  const kijker = new ResizeObserver(maat);
  kijker.observe(plek);

  let draait = false;
  function lus() {
    if (!draait) return;
    besturing.update();
    stap();
    renderer.render(scene, camera);
    requestAnimationFrame(lus);
  }

  return {
    zet,
    start() {
      if (draait) return;
      draait = true;
      maat();
      requestAnimationFrame(lus);
    },
    stop() {
      draait = false;
      label.hidden = true;
    },
  };
}
