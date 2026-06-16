<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import type { OmRecordDTO } from "../types/om";
import { getRaw, METRIC_LABELS } from "../utils/metrics";
import { convexHull, findGaps, type Point2D } from "../utils/convexHull";
import { splineHull } from "../utils/spline";
import { mahalanobisAnalysis } from "../utils/mahalanobis";
import { computeEllipse, subCov2x2, type Ellipse2D } from "../utils/ellipse2d";
import { pcaProject } from "../utils/pca";
import { t } from "../utils/i18n";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const props = defineProps<{ allRecords: OmRecordDTO[] }>();

const avail = computed(() => {
  const s = new Set<string>();
  for (const r of props.allRecords) {
    if (!r.score) continue;
    for (const k of ["cost","cycles","area","instructions","height","width","boundingHex","rate"])
      if (getRaw(r.score, k) != null) s.add(k);
  }
  return [...s];
});

const dimX = ref("cost"), dimY = ref("cycles"), dimZ = ref("area");
const viewDim = ref<string>("2d");
const showGaps = ref(false);
const hoveredId = ref<string | null>(null);
const svgW = 600, svgH = 420, pad = 40;

// ── 投影数据 ──
interface ChartData {
  all: Point2D[]; pareto: Point2D[]; hull: Point2D[];
  spline: [number,number][]; gaps: { x: number; y: number }[];
  pxMin: number; pxMax: number; pyMin: number; pyMax: number;
  paretoIdx: Map<string,number>;
}
const chart = ref<ChartData | null>(null);
interface DimInfo { key:string; label:string; strengthPct:number; optimizePct:number; cur:number; tgt:number; level:'Strong'|'Medium'|'Weak' }
interface RecInfo { id:string; record:OmRecordDTO; dims:DimInfo[]; overallScore:number }
const recs = ref<RecInfo[]>([]);
const paretoRecsFor3D = ref<OmRecordDTO[]>([]);

const logV = (v: number) => Math.log(Math.max(v, 1));
function toSx(v: number, min: number, max: number) { return pad + (v - min) / (max - min) * (svgW - 2 * pad); }
function toSy(v: number, min: number, max: number) { return svgH - pad - (v - min) / (max - min) * (svgH - 2 * pad); }

function run() {
  const scored = props.allRecords.filter(r => r.score != null);
  if (scored.length < 3) return;
  const xk = dimX.value, yk = dimY.value;
  const allPts: Point2D[] = scored.map(r => ({ x: logV(getRaw(r.score!, xk)!), y: logV(getRaw(r.score!, yk)!), id: r.id ?? "" })).filter(p => !isNaN(p.x) && !isNaN(p.y));
  const paretoPts = allPts.filter(p => {
    const rec = scored.find(r => r.id === p.id);
    if (!rec) return false;
    return !scored.some(o => o !== rec && o.score!.cost <= rec.score!.cost && o.score!.cycles <= rec.score!.cycles && o.score!.area <= rec.score!.area && (o.score!.cost < rec.score!.cost || o.score!.cycles < rec.score!.cycles || o.score!.area < rec.score!.area));
  });
  const hull = convexHull(paretoPts);
  const maxGap = Math.max(...hull.map((p,i)=>{ const q=hull[(i+1)%hull.length]; return Math.hypot(q.x-p.x,q.y-p.y); }));
  const gaps = findGaps(hull, maxGap * 0.5); // log-space compression → higher threshold
  const spline = splineHull(hull, 15);
  const xMin = Math.min(...paretoPts.map(p=>p.x)), xMax = Math.max(...paretoPts.map(p=>p.x));
  const yMin = Math.min(...paretoPts.map(p=>p.y)), yMax = Math.max(...paretoPts.map(p=>p.y));
  // 加 5% padding 避免点贴在边框上
  const xPad = (xMax - xMin) * 0.05, yPad = (yMax - yMin) * 0.05;
  const pxMin = xMin - xPad, pxMax = xMax + xPad, pyMin = yMin - yPad, pyMax = yMax + yPad;
  // Hull vertices ARE Pareto points (Graham scan returns subset of input). Match by object identity.
  const paretoSet = new Set(paretoPts);
  const paretoIdx = new Map<string,number>();
  hull.forEach((h,i) => {
    for (const pp of paretoPts) {
      if (pp === h) { paretoIdx.set(pp.id!, i); break; }
    }
  });
  chart.value = { all: allPts, pareto: paretoPts, hull, spline, gaps: gaps.map(g=>({x:g.midpoint.x,y:g.midpoint.y})), pxMin, pxMax, pyMin, pyMax, paretoIdx };

  // ── 记录分析 ──
  const basePairs = [["cost","cycles"],["cost","area"],["cost","instructions"],["cycles","area"],["cycles","instructions"],["area","instructions"]];
  const extraKeys = avail.value.filter(k => !["cost","cycles","area","instructions"].includes(k));
  for (const ek of extraKeys) {
    basePairs.push(["cost",ek],["cycles",ek]);
    if (ek !== "rate") basePairs.push(["area",ek]);
  }
  const allPairs = basePairs;
  const paretoRecs = scored.filter(r=>paretoPts.some(p=>p.id===r.id));
  paretoRecsFor3D.value = paretoRecs;
  const projections = allPairs.map(([dx,dy])=>{
    const pts = paretoRecs.map(r=>({x:logV(getRaw(r.score!,dx)!),y:logV(getRaw(r.score!,dy)!)}));
    return { dims:[dx,dy], hull:convexHull(pts) };
  });
  // Pareto-only bests + top 25% for realistic targets
  const bestInDim: Record<string,number> = {}, p25InDim: Record<string,number> = {};
  for (const k of avail.value) {
    const vs = paretoRecs.map(r=>getRaw(r.score!,k)).filter(v=>v!=null) as number[];
    vs.sort((a,b)=>a-b);
    bestInDim[k] = vs[0];
    p25InDim[k] = vs[Math.floor(vs.length * 0.25)] ?? vs[0];
  }

  recs.value = paretoRecs.map(rec=>{
    const pid = rec.id??"";
    const dims: DimInfo[] = [];
    for (const k of avail.value) {
      const cur = getRaw(rec.score!, k)!;
      const isAtLimit = cur === bestInDim[k]; // already at Pareto best → MAX
      let onEdge=0, inside=0, total=0;
      for (const proj of projections) {
        if(!proj.dims.includes(k)) continue; total++;
        const vIdx = proj.dims[0]===k ? 0 : 1;
        const vals = proj.hull.map(h => vIdx===0 ? h.x : h.y);
        const mn = Math.min(...vals), mx = Math.max(...vals);
        const recLogVal = logV(cur);
        if (mx > mn) {
          const norm = 1 - (recLogVal - mn) / (mx - mn);
          if (norm > 0.75) onEdge++;
        } else { onEdge++; }
        const pp = paretoPts.find(pp2 => pp2.id === pid);
        if (pp && proj.hull.length >= 3) {
          let sgn: number | null = null;
          for (let i = 0; i < proj.hull.length; i++) {
            const a = proj.hull[i], b = proj.hull[(i+1) % proj.hull.length];
            const c = (b.x - a.x) * (pp.y - a.y) - (b.y - a.y) * (pp.x - a.x);
            if (c === 0) continue;
            if (sgn === null) sgn = c > 0 ? 1 : -1;
            else if (c > 0 !== sgn > 0) { sgn = null; break; }
          }
          if (sgn !== null) inside++;
        }
      }
      const strengthPct = isAtLimit ? 100 : Math.round(onEdge/total*100);
      const optimizeScore = strengthPct - 50; // +50=very optimizable, -50=very stable
      const tgt = p25InDim[k];
      const level = isAtLimit ? 'Strong' as const : strengthPct >= 60 ? 'Strong' as const : strengthPct >= 30 ? 'Medium' as const : 'Weak' as const;
      dims.push({ key:k, label:METRIC_LABELS[k]||k, strengthPct, optimizePct: optimizeScore, cur, tgt, level });
    }
    dims.sort((a,b)=>b.optimizePct-a.optimizePct);
    const overallScore = Math.round(dims.reduce((s,d)=>s+d.optimizePct,0)/dims.length);
    return { id:pid, record:rec, dims, overallScore };
  });
  recs.value.sort((a,b)=>b.overallScore-a.overallScore);

  // ── 椭球距离分析 ──
  const allKeys = ["cost","cycles","area","instructions","height","width","boundingHex","rate"].filter(k => avail.value.includes(k));
  const pVecs = paretoRecs.map(r => allKeys.map(k => logV(getRaw(r.score!, k)!))).filter(v => v.length >= 2);
  const ma = mahalanobisAnalysis(pVecs);
  if (ma.distances.length > 0 && allKeys.length >= 2) {
    const maxD = ma.maxDist, minD = ma.minDist;
    ellipsoidList.value = paretoRecs.map((rec, i) => {
      const dist = ma.distances[i] ?? 0;
      const normScore = maxD > minD ? Math.round(100 - (dist - minD) / (maxD - minD) * 100) : 50;
      const level = normScore >= 70 ? 'High' : normScore >= 40 ? 'Mid' : 'Low';
      return { id: rec.id??"", score: `${rec.score!.cost}g/${rec.score!.cycles}c/${rec.score!.area}a/${rec.score!.instructions}i`, dist: Math.round(dist*10)/10, normScore, level };
    }).sort((a, b) => b.normScore - a.normScore);

    // Build the 2D ellipse for current projection
    const xi = allKeys.indexOf(dimX.value), yi = allKeys.indexOf(dimY.value);
    if (xi >= 0 && yi >= 0 && xi !== yi) {
      ellipseGeo.value = computeEllipse(subCov2x2(ma.cov, xi, yi), [ma.centroid[xi], ma.centroid[yi]]);
      ellCenter.value = [ma.centroid[xi], ma.centroid[yi]];
      ellPts.value = paretoRecs.map((rec, i) => ({
        x: logV(getRaw(rec.score!, dimX.value)!), y: logV(getRaw(rec.score!, dimY.value)!),
        dist: ma.distances[i] ?? 0, id: rec.id ?? "",
      }));
    }
  }

  // 3D mode: Three.js interactive scatter
  if (viewDim.value === "3d") {
    chart.value = null; // hide SVG
    nextTick(() => initThreeJS());
  } else {
    disposeThree();
  }

  // PCA mode: override chart data
  if (viewDim.value === "nd" && allKeys.length >= 2) {
    const { projected, varPct } = pcaProject(pVecs);
    if (projected.length > 0) {
      const ndAll = pVecs.length === scored.length
        ? projected
        : (() => {
            // re-run PCA including all scored for nd mode
            const allVecs = scored.map(r => allKeys.map(k => logV(getRaw(r.score!, k)!)));
            return pcaProject(allVecs).projected;
          })();
      const ndPareto = projected;
      const ndAllPts: Point2D[] = ndAll.map((p, i) => ({ x: p[0], y: p[1], id: scored[i]?.id ?? "" }));
      const ndParetoPts: Point2D[] = ndPareto.map((p, i) => ({ x: p[0], y: p[1], id: paretoRecs[i]?.id ?? "" }));
      const ndHull = convexHull(ndParetoPts);
      const ndSpline = splineHull(ndHull, 15);
      const xMin = Math.min(...ndAllPts.map(p => p.x)), xMax = Math.max(...ndAllPts.map(p => p.x));
      const yMin = Math.min(...ndAllPts.map(p => p.y)), yMax = Math.max(...ndAllPts.map(p => p.y));
      const xPad = (xMax - xMin) * 0.05, yPad = (yMax - yMin) * 0.05;
      chart.value = {
        all: ndAllPts, pareto: ndParetoPts, hull: ndHull, spline: ndSpline,
        gaps: [], pxMin: xMin - xPad, pxMax: xMax + xPad, pyMin: yMin - yPad, pyMax: yMax + yPad,
        paretoIdx: new Map(),
      };
      ndVarPct.value = varPct;
    }
  }
}

interface EllipsoidEntry { id: string; score: string; dist: number; normScore: number; level: string }
const ellipsoidList = ref<EllipsoidEntry[]>([]);
const ellipseGeo = ref<Ellipse2D | null>(null);
const ellPts = ref<{ x: number; y: number; dist: number; id: string }[]>([]);
const ellCenter = ref<[number,number]>([0,0]);
const showHelp = ref(false);
const showEllipsoid = ref(false);
const ndVarPct = ref<[number,number]>([0,0]);
const pcaNoteHtml = computed(() => t('pca_note').replace('{n}', String(avail.value.length)).replace('{pc1}', String(ndVarPct.value[0])));
const ellHoverId = ref<string|null>(null);
const threeCanvas = ref<HTMLCanvasElement | null>(null);
let threeRenderer: THREE.WebGLRenderer | null = null;
let threeScene: THREE.Scene | null = null;
let threeCamera: THREE.PerspectiveCamera | null = null;
let threeControls: OrbitControls | null = null;
const ell1S = computed(() => {
  const list = ellipsoidList.value; if (list.length < 2) return 1;
  return [...list].sort((a,b)=>a.dist-b.dist)[Math.floor(list.length*0.67)]?.dist ?? 1;
});
const ellXMin = computed(() => Math.min(...ellPts.value.map(p=>p.x), ellipseGeo.value?.cx??0) - 1);
const ellXMax = computed(() => Math.max(...ellPts.value.map(p=>p.x), ellipseGeo.value?.cx??0) + 1);
const ellYMin = computed(() => Math.min(...ellPts.value.map(p=>p.y), ellipseGeo.value?.cy??0) - 1);
const ellYMax = computed(() => Math.max(...ellPts.value.map(p=>p.y), ellipseGeo.value?.cy??0) + 1);
const maDist2sigma = computed(() => {
  const list = ellipsoidList.value;
  if (list.length < 2) return 1;
  const sorted = [...list].sort((a,b) => a.dist - b.dist);
  return sorted[Math.floor(sorted.length * 0.67)]?.dist ?? 1;
});

const threeHoverLabel = ref<HTMLDivElement | null>(null);
const threeHoverText = ref("");

function initThreeJS() {
  const canvas = threeCanvas.value; if (!canvas) return;
  const scored = props.allRecords.filter(r=>r.score!=null);
  if (scored.length<3) return;

  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 420;
  threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  threeRenderer.setSize(w, h);
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  threeScene = new THREE.Scene();
  threeCamera = new THREE.PerspectiveCamera(45, w/h, 0.1, 100);
  threeCamera.position.set(8, 6, 10);
  threeCamera.lookAt(0, 0, 0);

  threeControls = new OrbitControls(threeCamera, canvas);
  threeControls.enableDamping = true;
  threeControls.dampingFactor = 0.08;

  const xk=dimX.value, yk=dimY.value, zk=dimZ.value;
  const xl=METRIC_LABELS[xk]||xk, yl=METRIC_LABELS[yk]||yk, zl=METRIC_LABELS[zk]||zk;
  const pts = scored.map(r => ({ x:logV(getRaw(r.score!,xk)!), y:logV(getRaw(r.score!,yk)!), z:logV(getRaw(r.score!,zk)!), id:r.id??"", isPareto:paretoRecsFor3D.value.some((pr:OmRecordDTO)=>pr.id===r.id), score:r.score! })).filter(p=>!isNaN(p.x)&&!isNaN(p.y)&&!isNaN(p.z));

  const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length, cy = pts.reduce((s,p)=>s+p.y,0)/pts.length, cz = pts.reduce((s,p)=>s+p.z,0)/pts.length;

  const geoSmall = new THREE.SphereGeometry(0.04, 6, 6);
  const geoBig = new THREE.SphereGeometry(0.07, 8, 8);
  const matGray = new THREE.MeshBasicMaterial({ color: 0x3a3228, transparent: true, opacity: 0.5 });
  const matGold = new THREE.MeshBasicMaterial({ color: 0xc9a84c });
  const matHover = new THREE.MeshBasicMaterial({ color: 0xffff00 });

  const meshes: THREE.Mesh[] = [];

  for (const p of pts) {
    const mesh = new THREE.Mesh(p.isPareto ? geoBig : geoSmall, p.isPareto ? matGold : matGray);
    mesh.position.set((p.x-cx), (p.y-cy), (p.z-cz));
    mesh.userData = { id: p.id, score: p.score, isPareto: p.isPareto, originalMat: p.isPareto ? matGold : matGray };
    threeScene.add(mesh);
    meshes.push(mesh);
  }

  // Optimization arrows: for each Pareto point, draw a short arrow toward origin (better = smaller = lower)
  const arrowGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 6);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x5a9e6f, transparent: true, opacity: 0.5 });
  for (const p of pts.filter(p=>p.isPareto)) {
    const vx = -p.x + cx, vy = -p.y + cy, vz = -p.z + cz; // toward centroid (= more balanced)
    const len = Math.sqrt(vx*vx+vy*vy+vz*vz);
    if (len < 0.01) continue;
    const nx=vx/len, ny=vy/len, nz=vz/len;
    const scale = Math.min(len * 0.3, 0.8); // shorter arrows for readability
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set((p.x-cx)+nx*scale*0.5, (p.y-cy)+ny*scale*0.5, (p.z-cz)+nz*scale*0.5);
    arrow.scale.set(1, scale, 1);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(nx,ny,nz));
    threeScene.add(arrow);
  }

  // Labeled axes with metric names
  const axLen = 2.5;
  const axMat = (c:number) => new THREE.LineBasicMaterial({ color: c });
  const mkLine = (ex:number,ey:number,ez:number,c:number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0,ex,ey,ez], 3));
    threeScene!.add(new THREE.Line(g, axMat(c)));
  };
  mkLine(axLen,0,0,0xff6666); mkLine(0,axLen,0,0x66ff66); mkLine(0,0,axLen,0x6688ff);
  // Add text sprites at axis ends — use small colored spheres as markers + tooltip in scene
  function labelSphere(x:number,y:number,z:number,c:number,r:number=0.08){
    const s=new THREE.Mesh(new THREE.SphereGeometry(r,8,8),new THREE.MeshBasicMaterial({color:c}));
    s.position.set(x,y,z); threeScene!.add(s);
  }
  labelSphere(axLen,0,0,0xff6666); labelSphere(0,axLen,0,0x66ff66); labelSphere(0,0,axLen,0x6688ff);

  // Hover: Raycaster
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovered: THREE.Mesh | null = null;

// Watch right-panel hover → highlight 3D sphere
watch(hoveredId, (newId) => {
  if (!meshes.length) return;
  // Reset previous
  if (hovered) { hovered.material = hovered.userData.originalMat; hovered.scale.set(1,1,1); hovered = null; }
  if (!newId) return;
  const found = meshes.find(m => m.userData.id === newId);
  if (found) {
    found.material = matHover;
    found.scale.set(1.8,1.8,1.8);
    hovered = found;
    const s = found.userData.score;
    threeHoverText.value = s ? `${s.cost}g/${s.cycles}c/${s.area}a/${s.instructions}i` : "";
  }
});

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, threeCamera!);
    const hits = raycaster.intersectObjects(meshes);
    if (hovered && (!hits.length || hits[0].object !== hovered)) {
      (hovered as THREE.Mesh).material = hovered.userData.originalMat;
      hovered.scale.set(1,1,1);
      hovered = null;
      threeHoverText.value = "";
      hoveredId.value = null;
    }
    if (hits.length > 0) {
      const obj = hits[0].object as THREE.Mesh;
      if (obj !== hovered) {
        if (hovered) { (hovered as THREE.Mesh).material = hovered.userData.originalMat; hovered.scale.set(1,1,1); }
        hovered = obj;
        obj.material = matHover;
        obj.scale.set(1.8,1.8,1.8);
        const s = obj.userData.score;
        threeHoverText.value = s ? `${s.cost}g/${s.cycles}c/${s.area}a/${s.instructions}i` : "";
        hoveredId.value = obj.userData.id ?? null;
      }
    }
  });

  threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));

  function animate() {
    if (!threeRenderer || !threeScene || !threeCamera) return;
    requestAnimationFrame(animate);
    threeControls?.update();
    threeRenderer.render(threeScene!, threeCamera!);
  }
  animate();
}

function disposeThree() {
  threeRenderer?.dispose();
  threeControls?.dispose();
  threeRenderer = null; threeScene = null; threeCamera = null; threeControls = null;
}

onUnmounted(() => disposeThree());
watch([()=>props.allRecords,dimX,dimY,dimZ,viewDim],()=>{ if(props.allRecords.length>0)run(); },{immediate:true});

const c = computed(() => chart.value!);

function hlPointId(pid:string|null){ hoveredId.value=pid; }
</script>

<template>
  <div class="ap-root">
    <div class="ap-top">
      <span class="ap-title">{{ t('hull_title') }}</span>
      <span class="ap-meta">{{ avail.length }} {{ t('analysis_meta').replace('{n}', String(recs.length)) }}</span>
      <span class="ap-help" @click="showHelp=!showHelp">?</span>
    </div>
    <div v-if="viewDim==='nd'" class="ap-pca-note" v-html="pcaNoteHtml"></div>
    <div v-if="showHelp" class="ap-help-box">{{ t('analysis_help') }}</div>
    <div class="ap-ctls">
      <span class="ap-ctl"><label>View</label>
        <span class="view-mode-sel">
          <button class="vm-btn" :class="{active:viewDim==='2d'}" @click="viewDim='2d'">2D</button>
          <button class="vm-btn" :class="{active:viewDim==='3d'}" @click="viewDim='3d'">3D</button>
          <button class="vm-btn" :class="{active:viewDim==='nd'}" @click="viewDim='nd'">nD-PCA</button>
        </span>
      </span>
      <span class="ap-ctl" v-if="viewDim==='2d'||viewDim==='3d'"><label>{{ t('hull_x_axis') }}</label><select v-model="dimX"><option v-for="k in avail" :key="k" :value="k">{{ METRIC_LABELS[k] }}</option></select></span>
      <span class="ap-ctl" v-if="viewDim==='2d'||viewDim==='3d'"><label>{{ t('hull_y_axis') }}</label><select v-model="dimY"><option v-for="k in avail" :key="k" :value="k">{{ METRIC_LABELS[k] }}</option></select></span>
      <span class="ap-ctl" v-if="viewDim==='3d'"><label>Z</label><select v-model="dimZ"><option v-for="k in avail" :key="k" :value="k">{{ METRIC_LABELS[k] }}</option></select></span>
    </div>
    <div class="ap-legend">
      <span class="leg-item"><span class="leg-dot" style="color:#c44b3c">—</span> {{ t('hull_legend_curve') }}</span>
      <span class="leg-item"><span class="leg-dot" style="color:#c9a84c">●</span> {{ t('hull_legend_point') }}</span>
      <span class="leg-item">{{ t('hull_legend_scale') }}</span>
      <span class="leg-item leg-note">{{ t('hull_legend_note') }}</span>
    </div>

    <div class="ap-grid">
      <!-- SVG 图表 -->
      <div class="ap-chart-wrap">
        <div v-if="viewDim==='3d'" style="position:relative">
          <canvas ref="threeCanvas" class="ap-canvas"></canvas>
          <div v-if="threeHoverText" class="three-tooltip">{{ threeHoverText }}</div>
          <div class="three-axes-legend">
            <span style="color:#ff6666">● Red = {{ METRIC_LABELS[dimX]||dimX }}</span>
            <span style="color:#66ff66">● Green = {{ METRIC_LABELS[dimY]||dimY }}</span>
            <span style="color:#6688ff">● Blue = {{ METRIC_LABELS[dimZ]||dimZ }}</span>
            <span style="color:#5a9e6f">→ {{ t('three_arrows') }}</span>
          </div>
        </div>
        <template v-else-if="chart">
        <svg :viewBox="`0 0 ${svgW} ${svgH}`" class="ap-svg" :key="dimX+dimY+(props.allRecords.length)">
          <!-- 网格线 -->
          <line v-for="i in 5" :key="'gx'+i" :x1="pad" :y1="toSy(c.pyMin+(c.pyMax-c.pyMin)*(i-1)/4,c.pyMin,c.pyMax)" :x2="svgW-pad" :y2="toSy(c.pyMin+(c.pyMax-c.pyMin)*(i-1)/4,c.pyMin,c.pyMax)" stroke="#221d17" stroke-width="0.5"/>
          <line v-for="i in 5" :key="'gy'+i" :x1="toSx(c.pxMin+(c.pxMax-c.pxMin)*(i-1)/4,c.pxMin,c.pxMax)" :y1="pad" :x2="toSx(c.pxMin+(c.pxMax-c.pxMin)*(i-1)/4,c.pxMin,c.pxMax)" :y2="svgH-pad" stroke="#221d17" stroke-width="0.5"/>
          <!-- 轴标签 -->
          <text :x="svgW/2" :y="svgH-4" text-anchor="middle" fill="#807860" font-size="10" font-family="Cinzel">
            {{ viewDim==='nd' ? 'PC1 ('+ndVarPct[0]+'%)' : viewDim==='3d' ? 'iso-XY' : METRIC_LABELS[dimX]||dimX }}
          </text>
          <text :x="10" :y="svgH/2" text-anchor="middle" fill="#807860" font-size="10" font-family="Cinzel" transform="rotate(-90,10,210)">
            {{ viewDim==='nd' ? 'PC2 ('+ndVarPct[1]+'%)' : viewDim==='3d' ? 'iso-Z' : METRIC_LABELS[dimY]||dimY }}
          </text>
          <!-- 全部点 -->
          <circle v-for="(p,i) in chart.all" :key="'a'+i" :cx="toSx(p.x,c.pxMin,c.pxMax)" :cy="toSy(p.y,c.pyMin,c.pyMax)" r="1.5" fill="#3a3228" opacity="0.5"/>
          <!-- 凸包曲线 -->
          <polyline :points="chart.spline.map(p=>`${toSx(p[0],c.pxMin,c.pxMax)},${toSy(p[1],c.pyMin,c.pyMax)}`).join(' ')" fill="none" stroke="#c44b3c" stroke-width="2" opacity="0.9"/>
          <!-- 间隙 -->
          <template v-if="showGaps">
            <polygon v-for="(g,i) in chart.gaps" :key="'gap'+i" :points="`${toSx(g.x-3,c.pxMin,c.pxMax)},${toSy(g.y-3,c.pyMin,c.pyMax)} ${toSx(g.x+3,c.pxMin,c.pxMax)},${toSy(g.y,c.pyMin,c.pyMax)} ${toSx(g.x-3,c.pxMin,c.pxMax)},${toSy(g.y+3,c.pyMin,c.pyMax)}`" fill="#5a9e6f" opacity="0.6"/>
          </template>
          <!-- Pareto 点 -->
          <circle v-for="(p,i) in chart.pareto" :key="'p'+i" :cx="toSx(p.x,c.pxMin,c.pxMax)" :cy="toSy(p.y,c.pyMin,c.pyMax)"
            :r="hoveredId===p.id?8:4" :fill="hoveredId===p.id?'#ff0':'#c9a84c'"
            :style="{ filter: hoveredId===p.id?'drop-shadow(0 0 6px #ff0)':'none', transition: 'r 0.15s, fill 0.15s' }"
            @mouseenter="hlPointId(p.id??null)" @mouseleave="hlPointId(null)" style="cursor:pointer"/>
          <!-- 高亮凸包边 -->
          <template v-if="hoveredId && chart.paretoIdx.has(hoveredId)">
            <line v-for="(e,ei) in (()=>{ const i=chart.paretoIdx.get(hoveredId!)!; const n=chart.hull.length; return [[chart.hull[(i-1+n)%n],chart.hull[i]],[chart.hull[i],chart.hull[(i+1)%n]]]; })()" :key="'he'+ei"
              :x1="toSx(e[0].x,c.pxMin,c.pxMax)" :y1="toSy(e[0].y,c.pyMin,c.pyMax)"
              :x2="toSx(e[1].x,c.pxMin,c.pxMax)" :y2="toSy(e[1].y,c.pyMin,c.pyMax)"
              stroke="#ff0" stroke-width="3" opacity="0.9"/>
          </template>
        </svg>
        </template>
        <div v-else class="ap-chart-empty">{{ t('analysis_loading') }}</div>
      </div>

      <!-- 右侧列表 -->
      <div class="ap-list">
        <div class="ap-list-hdr"><span>{{ t('analysis_pareto_header') }}</span><span class="ap-list-hint">{{ t('analysis_hover_hint') }}</span></div>
        <div class="ap-list-body">
          <div v-for="r in recs" :key="r.id" class="ap-card" :class="{hl:hoveredId===r.id}" @mouseenter="hlPointId(r.id)" @mouseleave="hlPointId(null)">
            <div class="ap-card-score"><span v-if="r.record.categoryIds && r.record.categoryIds.length>0" class="leader-tag">[Leader]</span> {{ r.record.score!.cost }}g / {{ r.record.score!.cycles }}c / {{ r.record.score!.area }}a / {{ r.record.score!.instructions }}i <span class="overall-pct">[{{ r.overallScore>0?'+':'' }}{{ r.overallScore }}]</span></div>
            <div class="ap-card-dims">
              <span v-for="d in r.dims" :key="d.key" class="ap-dim-chip"
                :class="{ 'dim-strong': d.level==='Strong', 'dim-medium': d.level==='Medium', 'dim-weak': d.level==='Weak' }">
                {{ d.label }}({{ t('level_'+d.level.toLowerCase()) }})[{{ d.optimizePct>0?'+':'' }}{{ d.optimizePct }}]
                <template v-if="d.level==='Weak' && d.cur !== d.tgt"> →{{ d.tgt }}</template>
              </span>
            </div>
          </div>
          <div v-if="recs.length===0" class="ap-empty">{{ t('analysis_empty') }}</div>
        </div>
      </div>
    </div>

    <!-- 椭球分析 -->
    <div class="ellipsoid-section">
      <div class="ellipsoid-header">
        <span class="ellipsoid-title">◆ {{ t('ellipsoid_title') }}</span>
        <span class="ellipsoid-desc-inline">{{ ellipsoidList.length }} {{ t('ellipsoid_desc') }}</span>
      </div>
      <div class="ellipsoid-body">
        <div class="ap-legend" style="margin-bottom:8px">
          <span class="leg-item"><span class="leg-dot" style="color:#5a9e6f">●</span> {{ t('ell_legend_1sigma') }}</span>
          <span class="leg-item"><span class="leg-dot" style="color:#c9a84c">●</span> {{ t('ell_legend_2sigma') }}</span>
          <span class="leg-item"><span class="leg-dot" style="color:#c44b3c">●</span> {{ t('ell_legend_outside') }}</span>
          <span class="leg-item"><span class="leg-dot" style="color:#ffb703">+</span> {{ t('ell_legend_centroid') }}</span>
          <span class="leg-item leg-note">{{ t('ell_legend_note') }}</span>
        </div>
        <div class="ap-grid" style="margin-top:0">
          <div class="ell-chart-wrap">
            <svg v-if="ellipseGeo" :viewBox="`0 0 ${svgW} ${svgH}`" class="ap-svg">
              <circle v-for="p in ellPts" :key="p.id" :cx="toSx(p.x,ellXMin,ellXMax)" :cy="toSy(p.y,ellYMin,ellYMax)"
                :r="ellHoverId===p.id?7:3" :fill="ellHoverId===p.id?'#ff0':p.dist<=ell1S?'#5a9e6f':p.dist<=ell1S*2?'#c9a84c':'#c44b3c'" opacity="0.75"
                @mouseenter="ellHoverId=p.id" @mouseleave="ellHoverId=null" style="cursor:pointer"/>
              <line :x1="toSx(ellCenter[0],ellXMin,ellXMax)-5" :y1="toSy(ellCenter[1],ellYMin,ellYMax)" :x2="toSx(ellCenter[0],ellXMin,ellXMax)+5" :y2="toSy(ellCenter[1],ellYMin,ellYMax)" stroke="#ffb703" stroke-width="2"/>
              <line :x1="toSx(ellCenter[0],ellXMin,ellXMax)" :y1="toSy(ellCenter[1],ellYMin,ellYMax)-5" :x2="toSx(ellCenter[0],ellXMin,ellXMax)" :y2="toSy(ellCenter[1],ellYMin,ellYMax)+5" stroke="#ffb703" stroke-width="2"/>
              <polyline :points="ellipseGeo.path1sigma.split(' ').map(p=>`${toSx(+p.split(',')[0],ellXMin,ellXMax)},${toSy(+p.split(',')[1],ellYMin,ellYMax)}`).join(' ')" fill="none" stroke="#5a9e6f" stroke-width="1.5"/>
              <text :x="toSx(ellipseGeo.label1sigma.x,ellXMin,ellXMax)" :y="toSy(ellipseGeo.label1sigma.y,ellYMin,ellYMax)" fill="#5a9e6f" font-size="9" font-family="JetBrains Mono">1σ</text>
              <polyline :points="ellipseGeo.path2sigma.split(' ').map(p=>`${toSx(+p.split(',')[0],ellXMin,ellXMax)},${toSy(+p.split(',')[1],ellYMin,ellYMax)}`).join(' ')" fill="none" stroke="#c9a84c" stroke-width="1" stroke-dasharray="4,3"/>
              <text :x="toSx(ellipseGeo.label2sigma.x,ellXMin,ellXMax)" :y="toSy(ellipseGeo.label2sigma.y,ellYMin,ellYMax)" fill="#c9a84c" font-size="9" font-family="JetBrains Mono">2σ</text>
            </svg>
          </div>
          <div class="ap-list" style="max-height:440px">
            <div class="ap-list-hdr"><span>{{ t('ell_ranking_title') }}</span></div>
            <div class="ap-list-body">
              <div v-for="e in ellipsoidList" :key="e.id" class="ap-card" :class="{hl:ellHoverId===e.id}" @mouseenter="ellHoverId=e.id" @mouseleave="ellHoverId=null">
                <div class="ap-card-score">{{ e.score }}</div>
                <div class="ap-card-dims">
                  <span class="ap-dim-chip" :class="e.normScore>=70?'dim-strong':e.normScore>=40?'dim-medium':'dim-weak'">dist={{ e.dist }} · {{ e.normScore }}% {{ t('ell_optimizable_label') }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ap-root { padding: 14px 18px; max-width: 1200px; margin: 0 auto; color: #e0d8c8; font-family: 'JetBrains Mono', monospace; }
.ap-top { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.ap-title { color: #c9a84c; font-size: 0.8rem; font-weight: 700; font-family: 'Cinzel', serif; letter-spacing: 2px; }
.ap-meta { color: #807860; font-size: 0.6rem; }
.ap-help { color: #c9a84c; font-size: 0.65rem; cursor: pointer; border: 1px solid #5a4a2a; border-radius: 50%; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; user-select: none; }
.ap-help:hover { background: #5a4a2a; color: #0c0a06; }
.ap-help-box { background: #0c0a06; border: 1px solid #5a4a2a; border-radius: 2px; padding: 12px 14px; margin-bottom: 12px; font-size: 0.58rem; color: #b0a080; line-height: 1.5; max-height: 300px; overflow-y: auto; white-space: pre-line; }
.ap-help-box b { color: #c9a84c; }
.ap-pca-note { background: #0c0a06; border: 1px solid #5a4a2a; border-radius: 2px; padding: 8px 12px; margin-bottom: 8px; font-size: 0.56rem; color: #b0a080; line-height: 1.5; }
.ap-pca-note b { color: #c9a84c; }
.ap-ctls { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
.ap-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 8px; font-size: 0.55rem; color: #807860; }
.leg-item { display: flex; align-items: center; gap: 3px; white-space: nowrap; }
.leg-dot { font-size: 0.7rem; line-height: 1; }
.leg-note { color: #5a5245; font-style: italic; }
.ap-ctl { display: flex; align-items: center; gap: 4px; }
.ap-ctl label { color: #807860; font-size: 0.62rem; }
.ap-ctl select { background: #0c0a06; color: #e0d8c8; border: 1px solid #332d22; padding: 2px 5px; border-radius: 2px; font-family: 'JetBrains Mono', monospace; font-size: 0.62rem; }
.view-mode-sel { display: flex; gap: 0; }
.vm-btn { background: none; border: 1px solid #332d22; color: #807860; padding: 2px 8px; font-family: 'JetBrains Mono', monospace; font-size: 0.58rem; cursor: pointer; }
.vm-btn:first-child { border-radius: 2px 0 0 2px; }
.vm-btn:last-child { border-radius: 0 2px 2px 0; }
.vm-btn.active { background: #5a4a2a; color: #c9a84c; border-color: #8a7030; }

.ap-grid { display: grid; grid-template-columns: 1fr 360px; gap: 10px; }
.ap-chart-wrap { background: #181510; border: 1px solid #332d22; border-radius: 2px; padding: 6px; }
.ap-svg { width: 100%; height: auto; display: block; }
.ap-canvas { width: 100%; height: 430px; display: block; }
.three-tooltip { position: absolute; top: 8px; left: 8px; background: rgba(24,21,16,0.9); border: 1px solid #c9a84c; color: #e0d8c8; padding: 4px 10px; border-radius: 2px; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; pointer-events: none; z-index: 10; }
.three-axes-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.55rem; color: #807860; font-family: 'JetBrains Mono', monospace; padding: 4px 6px; }
.ap-chart-empty { color: #807860; font-size: 0.7rem; text-align: center; padding: 80px 0; }

.ap-list { background: #181510; border: 1px solid #332d22; border-radius: 2px; display: flex; flex-direction: column; max-height: 450px; }
.ap-list-hdr { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-bottom: 1px solid #332d22; font-size: 0.64rem; color: #c9a84c; font-family: 'Cinzel', serif; letter-spacing: 1px; flex-shrink: 0; }
.ap-list-hint { color: #807860; font-size: 0.52rem; font-family: 'JetBrains Mono', monospace; letter-spacing: 0; }
.ap-list-body { flex: 1; overflow-y: auto; padding: 4px 8px; }
.ap-empty { color: #807860; font-size: 0.6rem; font-style: italic; padding: 12px; text-align: center; }

.ap-card { padding: 6px 6px; border-bottom: 1px solid #221d17; cursor: pointer; transition: background 0.15s; }
.ap-card:hover, .ap-card.hl { background: rgba(255,183,3,0.04); }
.ap-card-score { color: #e0d8c8; font-size: 0.66rem; margin-bottom: 3px; }
.leader-tag { color: #ffb703; font-weight: 700; margin-right: 2px; }
.overall-pct { color: #5a9e6f; font-weight: 700; font-size: 0.7rem; float: right; }
.ap-card-dims { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
.ap-dim-chip { font-size: 0.55rem; padding: 1px 5px; border-radius: 2px; white-space: nowrap; }
.dim-strong { background: rgba(90,158,111,0.1); color: #5a9e6f; border: 1px solid rgba(90,158,111,0.2); }
.dim-medium { background: rgba(201,168,76,0.06); color: #c9a84c; border: 1px solid rgba(201,168,76,0.15); }
.dim-weak { background: rgba(196,75,60,0.08); color: #e0d8c8; border: 1px solid rgba(196,75,60,0.15); }

.ellipsoid-section { margin-top: 12px; background: #181510; border: 1px solid #332d22; border-radius: 2px; }
.ellipsoid-header { display: flex; align-items: center; gap: 10px; padding: 7px 12px; cursor: pointer; user-select: none; }
.ellipsoid-header:hover { background: #1f1b14; }
.ellipsoid-title { color: #c9a84c; font-size: 0.7rem; font-weight: 600; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.ellipsoid-desc-inline { color: #807860; font-size: 0.52rem; flex: 1; }
.ellipsoid-toggle { color: #807860; font-size: 0.55rem; }
.ellipsoid-body { border-top: 1px solid #221d17; padding: 8px 10px; }
.ell-chart-wrap { background: #181510; border: 1px solid #332d22; border-radius: 2px; padding: 6px; }
.ellipsoid-empty { color: #807860; font-size: 0.6rem; font-style: italic; padding: 8px; }
</style>
