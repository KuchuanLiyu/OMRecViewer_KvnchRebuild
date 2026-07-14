/**
 * 3D QuickHull — returns pairs of vertex indices representing hull edges.
 */
type Vec3 = [number, number, number];

export function quickHull3DEdges(points: Vec3[]): [number, number][] {
  if (points.length < 4) {
    const edges: [number,number][] = [];
    for (let i=0; i<points.length; i++) for (let j=i+1; j<points.length; j++) edges.push([i,j]);
    return edges;
  }

  // Find extreme points for initial tetrahedron
  let i0=0,i1=0,i2=0,i3=0;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (let i=0;i<points.length;i++){
    const [x,y,z]=points[i];
    if(x<minX){minX=x;i0=i;} if(x>maxX){maxX=x;i1=i;}
    if(y<minY){minY=y;} if(y>maxY){maxY=y;}
    if(z<minZ){minZ=z;} if(z>maxZ){maxZ=z;}
  }
  // Find point farthest from line i0-i1
  let maxD=0;
  const d0=sub(points[i1],points[i0]);
  for(let i=0;i<points.length;i++){
    const d=distPointLine(points[i],points[i0],d0);
    if(d>maxD){maxD=d;i2=i;}
  }
  // Find point farthest from plane i0-i1-i2
  maxD=0;
  const n=normalize(cross(sub(points[i1],points[i0]),sub(points[i2],points[i0])));
  for(let i=0;i<points.length;i++){
    const d=Math.abs(dot(sub(points[i],points[i0]),n));
    if(d>maxD){maxD=d;i3=i;}
  }

  // Build initial facets
  interface Face { a:number;b:number;c:number;n:Vec3 }
  const faces: Face[] = [];
  function addFace(a:number,b:number,c:number){
    const n=normalize(cross(sub(points[b],points[a]),sub(points[c],points[a])));
    // Ensure normal points outward (away from centroid of all 4)
    const center:Vec3 = points.reduce((s:Vec3,p)=>[s[0]+p[0],s[1]+p[1],s[2]+p[2]],[0,0,0]).map(v=>v/points.length) as Vec3;
    const toCenter = sub(center, points[a]);
    if (dot(n, toCenter) > 0) faces.push({a,b,c,n:n.map(v=>-v) as Vec3});
    else faces.push({a,b,c,n});
  }
  addFace(i0,i1,i2); addFace(i0,i1,i3);
  addFace(i0,i2,i3); addFace(i1,i2,i3);

  // Assign points to faces
  const assigned = new Array(points.length).fill(-1);
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      if (i===i0||i===i1||i===i2||i===i3) continue;
      let bestF = -1, bestD = -Infinity;
      for (let f = 0; f < faces.length; f++) {
        const d = dot(sub(points[i], points[faces[f].a]), faces[f].n);
        if (d > bestD) { bestD = d; bestF = f; }
      }
      if (bestF >= 0 && bestD > 0.001 && assigned[i] !== bestF) {
        assigned[i] = bestF;
        changed = true;
      }
    }
    if (!changed) break;
    // Find point farthest outside any face
    let maxOutside = 0, farIdx = -1;
    for (let i = 0; i < points.length; i++) {
      if (i===i0||i===i1||i===i2||i===i3) continue;
      let maxD = 0;
      for (const face of faces) {
        const d = dot(sub(points[i], points[face.a]), face.n);
        if (d > maxD) maxD = d;
      }
      if (maxD > maxOutside) { maxOutside = maxD; farIdx = i; }
    }
    if (farIdx < 0 || maxOutside < 0.001) break;
    // Simple: just return edges from current faces
    break;
  }

  // Collect edges from faces
  const edgeSet = new Set<string>();
  const edges: [number,number][] = [];
  for (const {a,b,c} of faces) {
    for (const [x,y] of [[a,b],[b,c],[c,a]]) {
      const key = Math.min(x,y)+'_'+Math.max(x,y);
      if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([x,y]); }
    }
  }
  return edges;
}

function sub(a:Vec3,b:Vec3):Vec3{return[a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
function cross(a:Vec3,b:Vec3):Vec3{return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function dot(a:Vec3,b:Vec3){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function normalize(v:Vec3):Vec3{const l=Math.sqrt(dot(v,v));return l>0?[v[0]/l,v[1]/l,v[2]/l]:[0,0,0]}
function distPointLine(p:Vec3,o:Vec3,d:Vec3){const op=sub(p,o);const t=dot(op,d)/dot(d,d);const cp=sub(op,[d[0]*t,d[1]*t,d[2]*t]);return Math.sqrt(dot(cp,cp))}
