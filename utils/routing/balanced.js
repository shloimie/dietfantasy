// utils/routing/balanced.js
// City-locked, area-aware clustering used by the planner.
// 1) Group stops by city
// 2) Allocate driver slots per city by proportion (at least 1 each)
// 3) Run k-means inside each city
// 4) Return clusters that are inherently “territorial”

const R_MILES = 3958.7613;
const toRad = (d) => (d * Math.PI) / 180;
const asPt  = (s) => ({ lat: +s.lat, lng: +s.lng });

function haversineMiles(a, b) {
    if (!a || !b) return 0;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2 * R_MILES * Math.asin(Math.sqrt(h));
}

function centroid(points) {
    if (!points.length) return { lat: 0, lng: 0 };
    let lat = 0, lng = 0;
    for (const p of points) { lat += +p.lat; lng += +p.lng; }
    return { lat: lat / points.length, lng: lng / points.length };
}

function kmeans(points, k, { maxIters = 40 } = {}) {
    if (k <= 0) return [];
    if (points.length <= k) {
        return points.map((p, i) => ({ id: String(i+1), centroid: asPt(p), stops: [p] }));
    }

    // seed centers (farthest-first)
    const pool = points.slice();
    const centers = [];
    const g = centroid(points);
    let idx = 0, far = -1;
    for (let i = 0; i < pool.length; i++) {
        const d = haversineMiles(asPt(pool[i]), g);
        if (d > far) { far = d; idx = i; }
    }
    centers.push(asPt(pool.splice(idx, 1)[0]));
    while (centers.length < Math.min(k, points.length)) {
        let bestI = 0, bestD = -1;
        for (let i = 0; i < pool.length; i++) {
            const p = asPt(pool[i]);
            let dn = Infinity;
            for (const c of centers) dn = Math.min(dn, haversineMiles(p, c));
            if (dn > bestD) { bestD = dn; bestI = i; }
        }
        centers.push(asPt(pool.splice(bestI, 1)[0]));
    }

    let assign = new Array(points.length).fill(0);
    for (let it = 0; it < maxIters; it++) {
        let changed = false;
        for (let i = 0; i < points.length; i++) {
            const p = asPt(points[i]);
            let best = 0, bd = Infinity;
            for (let c = 0; c < centers.length; c++) {
                const d = haversineMiles(p, centers[c]);
                if (d < bd) { bd = d; best = c; }
            }
            if (assign[i] !== best) { assign[i] = best; changed = true; }
        }
        const sums = centers.map(() => ({ lat: 0, lng: 0, n: 0 }));
        for (let i = 0; i < points.length; i++) {
            const g = assign[i];
            sums[g].lat += +points[i].lat; sums[g].lng += +points[i].lng; sums[g].n++;
        }
        for (let c = 0; c < centers.length; c++) {
            if (sums[c].n) centers[c] = { lat: sums[c].lat / sums[c].n, lng: sums[c].lng / sums[c].n };
        }
        if (!changed) break;
    }

    const buckets = centers.map((c) => ({ id: "", centroid: c, stops: [] }));
    for (let i = 0; i < points.length; i++) buckets[assign[i]].stops.push(points[i]);
    return buckets.filter(b => b.stops.length > 0).map((b, i) => ({ ...b, id: String(i+1) }));
}

function dominantCity(stops) {
    const m = new Map();
    for (const s of stops) {
        const c = (s.city ?? s.City ?? "").trim();
        if (!c) continue;
        m.set(c, (m.get(c) || 0) + 1);
    }
    let best = null, cnt = 0;
    for (const [c, n] of m) if (n > cnt) { cnt = n; best = c; }
    return best;
}

function proportionalAllocation(totalK, cityCounts) {
    const entries = Array.from(cityCounts.entries()).filter(([, n]) => n > 0);
    if (!entries.length || totalK <= 0) return new Map();
    const total = entries.reduce((a,[,n]) => a + n, 0);

    const base = new Map(); let used = 0;
    const rem = [];
    for (const [city, n] of entries) {
        const ideal = (n / total) * totalK;
        let k = Math.floor(ideal);
        if (k < 1) k = 1;
        base.set(city, k); used += k;
        rem.push({ city, frac: ideal - Math.floor(ideal) });
    }

    if (used > totalK) {
        const order = entries
            .map(([city, n]) => ({ city, n, r: rem.find(x=>x.city===city)?.frac ?? 0 }))
            .sort((a,b) => (a.n === b.n ? a.r - b.r : a.n - b.n));
        for (const item of order) {
            if (used <= totalK) break;
            const v = base.get(item.city);
            if (v > 1) { base.set(item.city, v - 1); used--; }
        }
    } else if (used < totalK) {
        rem.sort((a,b) => b.frac - a.frac);
        let i = 0;
        while (used < totalK) { base.set(rem[i%rem.length].city, base.get(rem[i%rem.length].city) + 1); used++; i++; }
    }
    return base;
}

export function areaBalancedCluster(points, k) {
    const pts = (points || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
    if (!pts.length || k <= 1) {
        return { clusters: [{ id: "1", city: dominantCity(pts), centroid: centroid(pts), stops: pts }] };
    }

    // group by city
    const byCity = new Map(), counts = new Map();
    for (const p of pts) {
        const c = (p.city ?? p.City ?? "").trim() || "(unknown)";
        if (!byCity.has(c)) byCity.set(c, []);
        byCity.get(c).push(p);
        counts.set(c, (counts.get(c) || 0) + 1);
    }

    // allocate drivers
    const alloc = proportionalAllocation(k, counts);

    // run k-means inside each city
    const clusters = [];
    let gid = 1;
    for (const [city, arr] of byCity.entries()) {
        const kCity = alloc.get(city) || 1;
        const km = kmeans(arr, kCity);
        for (const cl of km) {
            clusters.push({ id: String(gid++), city, centroid: cl.centroid, stops: cl.stops });
        }
    }

    if (clusters.length > k) clusters.length = k;
    while (clusters.length < k) clusters.push({ id: String(clusters.length + 1), city: null, centroid: {lat:0,lng:0}, stops: [] });

    return { clusters };
}

export default areaBalancedCluster;