// utils/routing/core.js

// ---- Distance helpers ----
export function haversineMiles(lat1, lon1, lat2, lon2) {
    if (
        lat1 == null || lon1 == null ||
        lat2 == null || lon2 == null
    ) return null;

    const toRad = (d) => (d * Math.PI) / 180;
    const R = 3958.7613; // miles
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export function dist(a, b) {
    return haversineMiles(a.lat, a.lng, b.lat, b.lng) ?? 0;
}

// ---- Simple nearest-neighbor route inside a set ----
export function buildNearestNeighborRoute(points) {
    if (!points?.length) return [];
    const unused = points.slice();
    const route = [];
    // start from the most central-ish point (min avg distance)
    let startIdx = 0;
    if (unused.length > 1) {
        let best = Infinity;
        for (let i = 0; i < unused.length; i++) {
            let s = 0;
            for (let j = 0; j < unused.length; j++) if (i !== j) s += dist(unused[i], unused[j]);
            if (s < best) { best = s; startIdx = i; }
        }
    }
    route.push(unused.splice(startIdx, 1)[0]);

    while (unused.length) {
        const last = route[route.length - 1];
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < unused.length; i++) {
            const d = dist(last, unused[i]);
            if (d < bestD) { bestD = d; bestI = i; }
        }
        route.push(unused.splice(bestI, 1)[0]);
    }
    return route;
}

export function routeMiles(route) {
    if (!route?.length) return 0;
    let m = 0;
    for (let i = 0; i < route.length - 1; i++) {
        m += dist(route[i], route[i + 1]);
    }
    return m;
}

// ---- K-means on lat/lng ----
function kmeansInit(points, k) {
    const centers = [];
    centers.push(points[Math.floor(Math.random() * points.length)]);
    while (centers.length < k) {
        const d2 = points.map(p => {
            let minD = Infinity;
            for (const c of centers) {
                const dd = dist(p, c);
                if (dd < minD) minD = dd;
            }
            return minD ** 2;
        });
        const sum = d2.reduce((a,b)=>a+b,0);
        const r = Math.random() * sum;
        let acc = 0, idx = 0;
        for (; idx < points.length; idx++) {
            acc += d2[idx];
            if (acc >= r) break;
        }
        centers.push(points[Math.min(idx, points.length - 1)]);
    }
    return centers.map(c => ({ lat: c.lat, lng: c.lng }));
}

function kmeansAssign(points, centers) {
    const groups = Array.from({ length: centers.length }, () => []);
    for (const p of points) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < centers.length; i++) {
            const d = dist(p, centers[i]);
            if (d < bestD) { bestD = d; best = i; }
        }
        groups[best].push(p);
    }
    return groups;
}

function kmeansRecenter(groups) {
    return groups.map((g, i) => {
        if (!g.length) return null;
        const lat = g.reduce((a,p)=>a+p.lat,0) / g.length;
        const lng = g.reduce((a,p)=>a+p.lng,0) / g.length;
        return { lat, lng };
    }).map((c,i)=>c ?? (groups[i][0] ? { lat: groups[i][0].lat, lng: groups[i][0].lng } : { lat:0, lng:0 }));
}

export function kmeans(points, k, iters = 8) {
    let centers = kmeansInit(points, k);
    let groups = kmeansAssign(points, centers);
    for (let t = 0; t < iters; t++) {
        centers = kmeansRecenter(groups);
        groups = kmeansAssign(points, centers);
    }
    return groups;
}

// ---- UI helpers ----
export function normalizeDay(selectedDay) {
    const raw = String(selectedDay || "all").toLowerCase().trim();
    if (raw === "all" || raw === "all days" || raw === "alldays") return null;
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    return days.includes(raw) ? raw : null;
}

export function getGeocodedCandidates(users, selectedDay = "all") {
    const dayKey = normalizeDay(selectedDay);
    return (users || []).filter(u => {
        if (u.paused) return false;
        const lat = u.lat ?? u.latitude;
        const lng = u.lng ?? u.longitude;
        if (lat == null || lng == null) return false;
        return dayKey ? Boolean(u.schedule?.[dayKey]) : true;
    });
}