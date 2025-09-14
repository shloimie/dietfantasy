// utils/routing/planner.js
// Time-balanced, city-locked routing.

export const MIN_PER_MILE = 7;   // minutes per mile (edit here)
export const MIN_PER_STOP = 3;   // minutes per stop (edit here)

import { areaBalancedCluster } from "./balanced.js";

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
function pathMiles(pts) {
    if (!pts || pts.length < 2) return 0;
    let m = 0; for (let i = 1; i < pts.length; i++) m += haversineMiles(pts[i-1], pts[i]); return m;
}
function centroidOfStops(stops) {
    if (!stops.length) return null;
    let lat = 0, lng = 0; for (const s of stops) { lat += +s.lat; lng += +s.lng; }
    return { lat: lat/stops.length, lng: lng/stops.length };
}
function orderNearestNeighbor(stops) {
    if (stops.length <= 2) return stops.slice();
    const c = centroidOfStops(stops);
    let start = 0, best = Infinity;
    for (let i = 0; i < stops.length; i++) {
        const d = haversineMiles(asPt(stops[i]), c);
        if (d < best) { best = d; start = i; }
    }
    const pool = stops.slice(); const route = [pool.splice(start,1)[0]];
    while (pool.length) {
        let kBest = 0, dBest = Infinity;
        for (let k = 0; k < pool.length; k++) {
            const d = haversineMiles(asPt(route.at(-1)), asPt(pool[k]));
            if (d < dBest) { dBest = d; kBest = k; }
        }
        route.push(pool.splice(kBest,1)[0]);
    }
    return route;
}
function convexHullLatLng(points) {
    if (!points || points.length <= 1) return points || [];
    const pts = points.map(p => [Number(p.lat), Number(p.lng)])
        .sort((a,b)=> a[0]===b[0] ? a[1]-b[1] : a[0]-b[0]);
    const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
    const lower=[]; for (const p of pts){ while(lower.length>=2 && cross(lower.at(-2),lower.at(-1),p)<=0) lower.pop(); lower.push(p); }
    const upper=[]; for (let i=pts.length-1;i>=0;i--){const p=pts[i]; while(upper.length>=2 && cross(upper.at(-2),upper.at(-1),p)<=0) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop(); return lower.concat(upper).map(([lat,lng]) => ({lat,lng}));
}

function routeMinutes(stops) {
    const miles = pathMiles(stops.map(asPt));
    return Math.round(miles * MIN_PER_MILE + stops.length * MIN_PER_STOP);
}
function stats(routes) {
    return routes.map(r => ({
        miles: pathMiles(r.map(asPt)),
        stops: r.length,
        minutes: routeMinutes(r),
        centroid: centroidOfStops(r),
        domCity: (() => {
            const m = new Map(); for (const s of r) { const c = s.city || s.City || ""; if (c) m.set(c, (m.get(c)||0)+1); }
            let best=null, cnt=0; for (const [c,n] of m) if (n>cnt) { cnt=n; best=c; } return best;
        })(),
    }));
}
function insertionMinutes(route, stop) {
    const tmp = route.slice(); tmp.push(stop);
    const ordered = orderNearestNeighbor(tmp);
    return routeMinutes(ordered) - routeMinutes(route);
}

function balanceTimeAggressive(routes, {
    maxIters = 250,
    targetSpreadMin = 8,       // stop when (max-min) <= 8 minutes
    batchSize = 3,
    cityPenalty = 9999,        // effectively forbid cross-city moves
    overTargetSlack = 9999,    // only cross city if donor is wildly over target
} = {}) {
    if (routes.length <= 1) return routes;
    routes = routes.map(orderNearestNeighbor);

    for (let t = 0; t < maxIters; t++) {
        const S = stats(routes);
        const mins = S.map(s => s.minutes);
        const total = mins.reduce((a,b)=>a+b,0);
        const target = total / routes.length;
        const maxM = Math.max(...mins), minM = Math.min(...mins);
        const hi = mins.indexOf(maxM), lo = mins.indexOf(minM);
        if (maxM - minM <= targetSpreadMin) break;

        const donor = routes[hi], recv = routes[lo];
        if (!donor.length) break;

        const cHi = S[hi].centroid || asPt(donor[0]);
        const candIdx = donor
            .map((s,i)=>({i, d: haversineMiles(asPt(s), cHi)}))
            .sort((a,b)=> b.d - a.d)
            .slice(0, Math.min(batchSize, donor.length))
            .map(x=>x.i);

        let best = null;

        for (const idx of candIdx) {
            const stop = donor[idx];
            const sameCity = stop.city && S[lo].domCity && stop.city === S[lo].domCity;
            if (!sameCity && S[hi].minutes < target + overTargetSlack) continue;

            for (let pos = 0; pos <= recv.length; pos++) {
                const recvCost = insertionMinutes(recv.slice(0,pos).concat(recv.slice(pos)), stop);
                const pen = sameCity ? 0 : cityPenalty;

                const donorAfter = donor.slice(0, idx).concat(donor.slice(idx+1));
                const recvAfter  = recv.slice(0, pos).concat([stop], recv.slice(pos));

                const newHi = routeMinutes(orderNearestNeighbor(donorAfter));
                const newLo = routeMinutes(orderNearestNeighbor(recvAfter)) + pen;

                const other = routes.map((r,k)=> k===hi ? newHi : (k===lo ? newLo : S[k].minutes));
                const spread = Math.max(...other) - Math.min(...other);

                if (!best || spread < best.spread) best = { idx, pos, spread };
            }
        }

        if (!best || best.spread >= (maxM - minM)) break; // nothing helps

        const moved = donor.splice(best.idx, 1)[0];
        recv.splice(best.pos, 0, moved);
        routes[hi] = orderNearestNeighbor(donor);
        routes[lo] = orderNearestNeighbor(recv);
    }
    return routes;
}

export function planRoutesBalancedByMiles(stops, driverCount, options = {}) {
    const k = Math.max(1, Number(driverCount || 0));
    const geocoded = [], unrouted = [];
    for (const s of stops || []) {
        if (Number.isFinite(s?.lat) && Number.isFinite(s?.lng)) geocoded.push(s);
        else unrouted.push(s);
    }

    const palette = ["#1976d2","#e53935","#7b1fa2","#00897b","#f9a825","#6d4c41",
        "#8e24aa","#3949ab","#d81b60","#f4511e","#43a047","#1e88e5",
        "#00897b","#5e35b1","#546e7a"];

    if (!geocoded.length) {
        return {
            drivers: Array.from({ length: k }, (_, i) => ({
                id: String(i+1), name: `Driver ${i+1}`, color: palette[i%palette.length],
                polygon: [], stops: [], miles: 0, minutes: 0
            })), unrouted
        };
    }

    // 1) city-locked clustering
    const { clusters } = areaBalancedCluster(geocoded, k);

    // 2) initial ordered routes
    let routes = clusters.map(cl => orderNearestNeighbor(cl.stops));

    // 3) aggressive time balancing (still city-safe)
    routes = balanceTimeAggressive(routes, {
        maxIters: options.balanceIters ?? 250,
        targetSpreadMin: options.targetSpreadMin ?? 8,
        batchSize: options.batchSize ?? 3,
        cityPenalty: options.cityPenalty ?? 9999,
        overTargetSlack: options.overTargetSlack ?? 9999,
    });

    // 4) to driver objects
    const drivers = routes.map((ordered, idx) => {
        const miles = pathMiles(ordered.map(asPt));
        const minutes = Math.round(miles * MIN_PER_MILE + ordered.length * MIN_PER_STOP);
        const hull = convexHullLatLng(ordered.map(asPt));
        return {
            id: String(idx+1),
            name: `Driver ${idx+1}`,
            color: palette[idx%palette.length],
            polygon: hull.map(p => [p.lat, p.lng]),
            stops: ordered,
            miles, minutes
        };
    });

    while (drivers.length < k) {
        const i = drivers.length;
        drivers.push({ id: String(i+1), name: `Driver ${i+1}`, color: palette[i%palette.length],
            polygon: [], stops: [], miles: 0, minutes: 0 });
    }
    if (drivers.length > k) drivers.length = k;

    return { drivers, unrouted };
}

// Legacy (array-of-arrays) for older callers
export function planRoutesBalancedByMilesArrays(stops, driverCount, options = {}) {
    const { drivers } = planRoutesBalancedByMiles(stops, driverCount, options);
    const arr = drivers.map(d => d.stops);
    while (arr.length < Math.max(1, Number(driverCount || 0))) arr.push([]);
    if (arr.length > driverCount) arr.length = driverCount;
    return arr;
}

export default planRoutesBalancedByMiles;