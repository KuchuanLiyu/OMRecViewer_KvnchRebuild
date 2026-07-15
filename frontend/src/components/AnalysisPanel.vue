<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import type { OmRecordDTO } from "../types/om";
import { getRaw, METRIC_LABELS } from "../utils/metrics";
import { convexHull, findGaps, type Point2D } from "../utils/convexHull";
import { splineHull } from "../utils/spline";
import { mahalanobisAnalysis } from "../utils/mahalanobis";
import { computeEllipse, subCov2x2, type Ellipse2D } from "../utils/ellipse2d";
import { pcaProject } from "../utils/pca";
import { knnIsolation, isolationColor, isolationRadius, type KnnResult } from "../utils/knn";
import { localOutlierFactor, lofColor, type LofResult } from "../utils/lof";
import { computeParetoDepth, type DepthResult } from "../utils/paretoDepth";
import { dbscan, clusterColor, type DbscanResult } from "../utils/dbscan";
import { kde2d, type KdeData } from "../utils/kde";
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
const knnResults = ref<KnnResult[]>([]);
const knnById = ref<Map<string, KnnResult>>(new Map());
// New algorithms
const lofById = ref<Map<string, LofResult>>(new Map());
const depthById = ref<Map<string, DepthResult>>(new Map());
const depthMax = ref(0);
const dbscanById = ref<Map<string, DbscanResult>>(new Map());
const dbscanCount = ref(0);
const kdeData = ref<KdeData | null>(null);
const showKDE = ref(true);

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

  // ── KNN 隔离检测 (在所有记录中算，维度跟随当前视图) ──
  let knnKeys: string[];
  if (viewDim.value === "nd") {
    knnKeys = ["cost","cycles","area","instructions","height","width","boundingHex","rate"].filter(k => avail.value.includes(k));
  } else if (viewDim.value === "3d") {
    knnKeys = [dimX.value, dimY.value, dimZ.value].filter(k => avail.value.includes(k));
  } else {
    knnKeys = [dimX.value, dimY.value].filter(k => avail.value.includes(k));
  }
  // Use ALL scored records as the reference population, then only display KNN for Pareto
  const allVecs = scored.map(r => knnKeys.map(k => logV(getRaw(r.score!, k)!)));
  if (allVecs.length >= 2 && knnKeys.length >= 1) {
    const results = knnIsolation(allVecs);
    knnResults.value = results;
    // Build map from record id → KNN result (only for Pareto records)
    const idMap = new Map<string, KnnResult>();
    const paretoIdSet = new Set(paretoRecs.map(r => r.id ?? ""));
    for (const r of results) {
      const rec = scored[r.index];
      if (rec && paretoIdSet.has(rec.id ?? "")) {
        idMap.set(rec.id ?? "", r);
      }
    }
    knnById.value = idMap;
  }

  // ── LOF (Local Outlier Factor) ──
  const allVecsLof = scored.map(r => knnKeys.map(k => logV(getRaw(r.score!, k)!)));
  if (allVecsLof.length >= 3 && knnKeys.length >= 1) {
    const lofResults = localOutlierFactor(allVecsLof);
    const lofMap = new Map<string, LofResult>();
    const paretoSet = new Set(paretoRecs.map(r => r.id ?? ""));
    for (const r of lofResults) {
      const rec = scored[r.index];
      if (rec && paretoSet.has(rec.id ?? "")) lofMap.set(rec.id ?? "", r);
    }
    lofById.value = lofMap;
  }

  // ── Pareto Depth ──
  const withCGA = scored.map(r => ({
    cost: r.score!.cost, cycles: r.score!.cycles, area: r.score!.area,
    id: r.id ?? "",
  }));
  const depthResults = computeParetoDepth(withCGA);
  const depthMap = new Map<string, DepthResult>();
  depthMax.value = 0;
  for (const d of depthResults) {
    depthMap.set(withCGA[d.index].id, d);
    if (d.depth > depthMax.value) depthMax.value = d.depth;
  }
  depthById.value = depthMap;

  // ── DBSCAN (on current view dimensions) ──
  if (allVecsLof.length >= 3 && knnKeys.length >= 1) {
    const dbResults = dbscan(allVecsLof);
    dbscanCount.value = dbResults.clusterCount;
    const dbMap = new Map<string, DbscanResult>();
    const paretoSet = new Set(paretoRecs.map(r => r.id ?? ""));
    for (const r of dbResults.clusters) {
      const rec = scored[r.index];
      if (rec && paretoSet.has(rec.id ?? "")) dbMap.set(rec.id ?? "", r);
    }
    dbscanById.value = dbMap;
  }

  // ── KDE 2D ──
  if (viewDim.value === "2d" && allPts.length >= 3) {
    kdeData.value = kde2d(allPts.map(p => [p.x, p.y] as [number, number]));
  } else {
    kdeData.value = null;
  }

  // ── 椭球距离分析 ──
  const allKeys = ["cost","cycles","area","instructions","height","width","boundingHex","rate"].filter(k => avail.value.includes(k));
  const pVecs = paretoRecs.map(r => allKeys.map(k => logV(getRaw(r.score!, k)!))).filter(v => v.length >= 2);
  const ma = mahalanobisAnalysis(pVecs);
  if (ma.distances.length > 0 && allKeys.length >= 2) {
    const maxD = ma.maxDist, minD = ma.minDist;
    ellipsoidList.value = paretoRecs.map((rec, i) => {
      const dist = ma.distances[i] ?? 0;
      const normScore = maxD > minD ? Math.round(100 - (dist - minD) / (maxD - minD) * 100) : 50;
      const level: 'close' | 'mid' | 'far' = normScore >= 70 ? 'close' : normScore >= 40 ? 'mid' : 'far';
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

interface EllipsoidEntry { id: string; score: string; dist: number; normScore: number; level: 'close' | 'mid' | 'far' }
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
  const geoBigBase = new THREE.SphereGeometry(0.07, 8, 8);
  const matGray = new THREE.MeshBasicMaterial({ color: 0x3a3228, transparent: true, opacity: 0.5 });
  const matHover = new THREE.MeshBasicMaterial({ color: 0xffff00 });

  const meshes: THREE.Mesh[] = [];

  function knnMat(iso: number): THREE.MeshBasicMaterial {
    const hex = isolationColor(iso).replace("#", "0x");
    return new THREE.MeshBasicMaterial({ color: parseInt(hex) });
  }

  for (const p of pts) {
    let mat: THREE.MeshBasicMaterial;
    let geo: THREE.SphereGeometry;
    let knn: KnnResult | undefined;

    if (p.isPareto) {
      const lof = lofById.value.get(p.id);
      if (lof) {
        const hex = lofColor(lof.lof).replace("#", "0x");
        mat = new THREE.MeshBasicMaterial({ color: parseInt(hex) });
      } else {
        mat = new THREE.MeshBasicMaterial({ color: 0xc9a84c }); // fallback gold
      }
      geo = geoBigBase;
    } else {
      geo = geoSmall;
      mat = matGray;
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((p.x-cx), (p.y-cy), (p.z-cz));
    mesh.userData = { id: p.id, score: p.score, isPareto: p.isPareto, originalMat: mat, knn };
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
    const lof = lofById.value.get(found.userData.id);
    const d = depthById.value.get(found.userData.id);
    const db = dbscanById.value.get(found.userData.id);
    const tags: string[] = [];
    if (lof) tags.push(`LOF:${lof.lof}`);
    if (d && d.depth > 0) tags.push(`Tier:${d.depth}`);
    if (db && db.cluster >= 0) tags.push(`Type${db.cluster + 1}`);
    const tagStr = tags.length > 0 ? ` | ${tags.join(' ')}` : '';
    threeHoverText.value = s ? `${s.cost}g/${s.cycles}c/${s.area}a/${s.instructions}i${tagStr}` : "";
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
        const lof = lofById.value.get(obj.userData.id);
        const d = depthById.value.get(obj.userData.id);
        const db = dbscanById.value.get(obj.userData.id);
        const tags: string[] = [];
        if (lof) tags.push(`LOF:${lof.lof}`);
        if (d && d.depth > 0) tags.push(`Tier:${d.depth}`);
        if (db && db.cluster >= 0) tags.push(`Type${db.cluster + 1}`);
        const tagStr = tags.length > 0 ? ` | ${tags.join(' ')}` : '';
        threeHoverText.value = s ? `${s.cost}g/${s.cycles}c/${s.area}a/${s.instructions}i${tagStr}` : "";
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
function knnColorForId(pid: string | undefined): string {
  if (!pid) return '#c9a84c';
  const r = lofById.value.get(pid);
  return r ? lofColor(r.lof) : '#c9a84c';
}
function knnTagText(k: KnnResult): string {
  const levelMap: Record<string, string> = {
    clustered: t('knn_clustered'),
    normal: t('knn_normal'),
    isolated: t('knn_isolated'),
  };
  const icon = k.level === 'isolated' ? ' ⚠' : k.level === 'clustered' ? ' ✦' : '';
  return ` | ${t('knn_label')}${k.isolation}% ${levelMap[k.level]??k.level}${icon}`;
}
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
      <span class="leg-item" title="How unique this solution is compared to nearby ones"><span class="leg-dot" style="color:#5aae6f">●</span> Common</span>
      <span class="leg-item" title="Mildly unusual strategy"><span class="leg-dot" style="color:#f59e0b">●</span> Distinct</span>
      <span class="leg-item" title="Rare, potentially innovative approach"><span class="leg-dot" style="color:#ef4444">●</span> Rare</span>
      <span class="leg-item" style="cursor:pointer" @click="showKDE=!showKDE"><span :style="{color: showKDE?'#06b6d4':'#5a5245'}">⬤</span> Heatmap</span>
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
            <span>| LOF:</span>
            <span style="color:#5aae6f">● Common</span>
            <span style="color:#f59e0b">● Distinct</span>
            <span style="color:#ef4444">● Rare</span>
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
          <!-- KDE heatmap (smooth canvas-rendered image) -->
          <image v-if="showKDE && kdeData"
            :x="toSx(kdeData.xMin, c.pxMin, c.pxMax)"
            :y="toSy(kdeData.yMax, c.pyMin, c.pyMax)"
            :width="toSx(kdeData.xMax, c.pxMin, c.pxMax) - toSx(kdeData.xMin, c.pxMin, c.pxMax)"
            :height="toSy(kdeData.yMin, c.pyMin, c.pyMax) - toSy(kdeData.yMax, c.pyMin, c.pyMax)"
            :href="kdeData.dataUrl"
            opacity="0.45"
          />
          <!-- 全部点 -->
          <circle v-for="(p,i) in chart.all" :key="'a'+i" :cx="toSx(p.x,c.pxMin,c.pxMax)" :cy="toSy(p.y,c.pyMin,c.pyMax)" r="1.5" fill="#3a3228" opacity="0.5"/>
          <!-- 凸包曲线 -->
          <polyline :points="chart.spline.map(p=>`${toSx(p[0],c.pxMin,c.pxMax)},${toSy(p[1],c.pyMin,c.pyMax)}`).join(' ')" fill="none" stroke="#c44b3c" stroke-width="2" opacity="0.9"/>
          <!-- 间隙 -->
          <template v-if="showGaps">
            <polygon v-for="(g,i) in chart.gaps" :key="'gap'+i" :points="`${toSx(g.x-3,c.pxMin,c.pxMax)},${toSy(g.y-3,c.pyMin,c.pyMax)} ${toSx(g.x+3,c.pxMin,c.pxMax)},${toSy(g.y,c.pyMin,c.pyMax)} ${toSx(g.x-3,c.pxMin,c.pxMax)},${toSy(g.y+3,c.pyMin,c.pyMax)}`" fill="#5a9e6f" opacity="0.6"/>
          </template>
          <!-- Pareto 点 (KNN 着色) -->
          <circle v-for="(p,i) in chart.pareto" :key="'p'+i" :cx="toSx(p.x,c.pxMin,c.pxMax)" :cy="toSy(p.y,c.pyMin,c.pyMax)"
            :r="hoveredId===p.id?8:4" :fill="hoveredId===p.id?'#ff0':knnColorForId(p.id)"
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
            <div class="ap-card-score"><span v-if="r.record.categoryIds && r.record.categoryIds.length>0" class="leader-tag">[Leader]</span> {{ r.record.score!.cost }}g / {{ r.record.score!.cycles }}c / {{ r.record.score!.area }}a / {{ r.record.score!.instructions }}i <span class="overall-pct">[{{ r.overallScore>0?'+':'' }}{{ r.overallScore }}]</span>
              <span v-if="lofById.has(r.id)" class="lof-badge" :class="'lof-'+lofById.get(r.id)!.level" :title="'Uniqueness (LOF): '+lofById.get(r.id)!.lof">{{ lofById.get(r.id)!.level === 'normal' ? 'COMMON' : lofById.get(r.id)!.level === 'mild' ? 'DISTINCT' : 'RARE' }} {{ lofById.get(r.id)!.lof }}</span>
            </div>
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
                  <span class="ap-dim-chip" :class="e.level==='close'?'dim-strong':e.level==='mid'?'dim-medium':'dim-weak'">dist={{ e.dist }} · {{ t('ell_level_'+e.level) }}</span>
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
.ap-top { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.ap-title { color: #c9a84c; font-size: 0.8rem; font-weight: 700; font-family: 'Cinzel', serif; letter-spacing: 2px; }
.ap-meta { color: #807860; font-size: 0.66rem; }
.ap-help {
  color: #c9a84c; font-size: 0.62rem; cursor: pointer;
  border: 1px solid rgba(201,168,76,0.25); border-radius: 50%;
  width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700; user-select: none;
  transition: all 0.2s ease;
}
.ap-help:hover { background: rgba(201,168,76,0.15); color: #fff; }
.ap-help-box {
  background: rgba(0,0,0,0.25); border: 1px solid rgba(201,168,76,0.2);
  border-radius: 8px; padding: 14px 16px; margin-bottom: 14px;
  font-size: 0.64rem; color: #b0a080; line-height: 1.6;
  max-height: 300px; overflow-y: auto; white-space: pre-line;
  animation: fadeDown 0.25s ease-out;
}
@keyframes fadeDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
.ap-help-box b { color: #c9a84c; }
.ap-pca-note {
  background: rgba(0,0,0,0.2); border: 1px solid rgba(201,168,76,0.15);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 10px;
  font-size: 0.56rem; color: #b0a080; line-height: 1.5;
}
.ap-pca-note b { color: #c9a84c; }
.ap-ctls { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.ap-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 8px; font-size: 0.62rem; color: #807860; }
.leg-item { display: flex; align-items: center; gap: 3px; white-space: nowrap; }
.leg-dot { font-size: 0.7rem; line-height: 1; }
.leg-note { color: #6a6058; font-style: italic; }
.ap-ctl { display: flex; align-items: center; gap: 4px; }
.ap-ctl label { color: #807860; font-size: 0.62rem; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.ap-ctl select {
  background: rgba(0,0,0,0.25); color: #e0d8c8;
  border: 1px solid rgba(255,255,255,0.08); padding: 3px 6px; border-radius: 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.62rem;
  outline: none; cursor: pointer;
  transition: border-color 0.2s ease;
}
.ap-ctl select:focus { border-color: #c9a84c; }
.view-mode-sel { display: flex; gap: 0; }
.vm-btn {
  background: none; border: 1px solid rgba(255,255,255,0.08); color: #807860;
  padding: 3px 10px; font-family: 'JetBrains Mono', monospace; font-size: 0.64rem;
  cursor: pointer; transition: all 0.2s ease;
}
.vm-btn:first-child { border-radius: 6px 0 0 6px; }
.vm-btn:last-child { border-radius: 0 6px 6px 0; }
.vm-btn.active { background: rgba(201,168,76,0.12); color: #c9a84c; border-color: rgba(201,168,76,0.3); }
.vm-btn:hover:not(.active) { color: #c0b898; }

.ap-grid { display: grid; grid-template-columns: 1fr 360px; gap: 10px; }
.ap-chart-wrap {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 8px;
}
.ap-svg { width: 100%; height: auto; display: block; }
.ap-canvas { width: 100%; height: 430px; display: block; border-radius: 8px; }
.three-tooltip {
  position: absolute; top: 8px; left: 8px;
  background: rgba(20,17,11,0.92); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(201,168,76,0.3); color: #e0d8c8;
  padding: 5px 12px; border-radius: 8px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.7rem;
  pointer-events: none; z-index: 10;
}
.three-axes-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.62rem; color: #807860; font-family: 'JetBrains Mono', monospace; padding: 6px 8px; }
.ap-chart-empty { color: #807860; font-size: 0.7rem; text-align: center; padding: 80px 0; }

.ap-list {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; display: flex; flex-direction: column; max-height: 450px;
}
.ap-list-hdr {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 0.64rem; color: #c9a84c; font-family: 'Cinzel', serif;
  letter-spacing: 1px; flex-shrink: 0;
}
.ap-list-hint { color: #807860; font-size: 0.6rem; font-family: 'JetBrains Mono', monospace; letter-spacing: 0; }
.ap-list-body { flex: 1; overflow-y: auto; padding: 4px 8px; }
.ap-empty { color: #807860; font-size: 0.66rem; font-style: italic; padding: 12px; text-align: center; }

.ap-card {
  padding: 7px 8px; border-bottom: 1px solid rgba(255,255,255,0.04);
  cursor: pointer; transition: all 0.2s ease;
  border-radius: 6px;
}
.ap-card:hover, .ap-card.hl { background: rgba(201,168,76,0.06); }
.ap-card-score { color: #e0d8c8; font-size: 0.66rem; margin-bottom: 4px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.leader-tag { color: #ffb703; font-weight: 700; margin-right: 2px; }
.overall-pct { color: #5aae6f; font-weight: 700; font-size: 0.7rem; margin-left: auto; }
.ap-card-dims { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
.ap-dim-chip { font-size: 0.62rem; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
.dim-strong { background: rgba(90,174,111,0.1); color: #5aae6f; border: 1px solid rgba(90,174,111,0.2); }
.dim-medium { background: rgba(201,168,76,0.06); color: #c9a84c; border: 1px solid rgba(201,168,76,0.15); }
.dim-weak { background: rgba(212,90,74,0.08); color: #e0d8c8; border: 1px solid rgba(212,90,74,0.15); }

.knn-badge { font-size: 0.62rem; padding: 2px 6px; border-radius: 4px; margin-left: 4px; font-weight: 600; }
.knn-clustered { background: rgba(90,174,111,0.1); color: #5aae6f; border: 1px solid rgba(90,174,111,0.2); }
.knn-normal { background: rgba(245,158,11,0.08); color: #f59e0b; border: 1px solid rgba(245,158,11,0.15); }
.knn-isolated { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }

.depth-badge { font-size: 0.62rem; padding: 2px 6px; border-radius: 4px; margin-left: 2px; font-weight: 700; }
.depth-pareto { background: rgba(129,140,248,0.12); color: #818cf8; border: 1px solid rgba(129,140,248,0.25); }
.depth-layer { background: rgba(255,255,255,0.03); color: #706858; border: 1px solid rgba(255,255,255,0.06); }

.lof-badge { font-size: 0.62rem; padding: 2px 6px; border-radius: 4px; margin-left: 2px; font-weight: 600; }
.lof-normal { background: rgba(90,174,111,0.08); color: #5aae6f; border: 1px solid rgba(90,174,111,0.15); }
.lof-mild { background: rgba(245,158,11,0.08); color: #f59e0b; border: 1px solid rgba(245,158,11,0.15); }
.lof-outlier { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }

.ellipsoid-section {
  margin-top: 14px; background: rgba(26,23,18,0.5);
  border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;
  overflow: hidden;
}
.ellipsoid-header {
  display: flex; align-items: center; gap: 10px; padding: 9px 14px;
  cursor: pointer; user-select: none;
  transition: background 0.2s ease;
}
.ellipsoid-header:hover { background: rgba(201,168,76,0.04); }
.ellipsoid-title { color: #c9a84c; font-size: 0.7rem; font-weight: 600; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.ellipsoid-desc-inline { color: #807860; font-size: 0.6rem; flex: 1; }
.ellipsoid-toggle { color: #807860; font-size: 0.62rem; }
.ellipsoid-body { border-top: 1px solid rgba(255,255,255,0.05); padding: 10px 12px; }
.ell-chart-wrap {
  background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 8px; padding: 8px;
}
.ellipsoid-empty { color: #807860; font-size: 0.66rem; font-style: italic; padding: 8px; }
</style>
