// utils/routing/kmeans.js
import { pointDistance } from "./distance";

/** k-means++ style init */
function kmeansInit(points, k) {
    const centers = [];
    centers.push(points[Math.floor(Math.random() * points.length)]);
    while (centers.length < k) {
        const d2 = points.map(p => {
            let minD = Infinity;
            for (const c of centers) {
                const dd = pointDistance(p, c);
                if (dd < minD) minD = dd;
            }
            return minD ** 2;
        });
        const sum = d2.reduce((a,b)=>a+b,0);
        let r = Math.random() * sum;
        let idx = 0;
        for (; idx < points.length; idx++) {
            r -= d2[idx];
            if (r <= 0) break;
        }
        centers.push(points[Math.min(idx, points.length - 1)]);
    }
    return centers.map(c => ({ lat: c.lat, lng: c.lng }));
}

function assign(points, centers) {
    const groups = Array.from({ length: centers.length }, () => []);
    for (const p of points) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < centers.length; i++) {
            const d = pointDistance(p, centers[i]);
            if (d < bestD) { bestD = d; best = i; }
        }
        groups[best].push(p);
    }
    return groups;
}

function recenter(groups) {
    return groups.map(g => {
        if (!g.length) return null;
        const lat = g.reduce((a,p)=>a+p.lat,0) / g.length;
        const lng = g.reduce((a,p)=>a+p.lng,0) / g.length;
        return { lat, lng };
    }).map((c,i)=>c ?? (groups[i][0] ? { lat: groups[i][0].lat, lng: groups[i][0].lng } : { lat:0, lng:0 }));
}

/** Basic k-means on {lat,lng} */
export function kmeans(points, k, iters = 8) {
    if (!points?.length) return Array.from({ length: k }, () => []);
    const kk = Math.min(k, points.length);
    let centers = kmeansInit(points, kk);
    let groups = assign(points, centers);
    for (let t = 0; t < iters; t++) {
        centers = recenter(groups);
        groups = assign(points, centers);
    }
    return groups;
}