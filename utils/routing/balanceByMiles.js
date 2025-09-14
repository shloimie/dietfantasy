// utils/routing/balanceByMiles.js
// TIME-balanced partition with circular sweep + soft stop cap, then local border re-balance.
// "Time" = miles*MIN_PER_MILE + stops*MIN_PER_STOP.

import { MIN_PER_MILE, MIN_PER_STOP } from "./index.js";

/* ---------- small geo helpers ---------- */
const R_MI = 3958.7613;
const toRad = (v) => (v * Math.PI) / 180;

export function haversineMiles(a, b) {
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R_MI * Math.asin(Math.sqrt(x));
}

export function centroid(pts) {
    if (!pts.length) return { lat: 0, lng: 0 };
    let lat = 0, lng = 0;
    for (const p of pts) { lat += p.lat; lng += p.lng; }
    return { lat: lat / pts.length, lng: lng / pts.length };
}

function routeMiles(stops) {
    if (!stops || stops.length < 2) return 0;
    let mi = 0;
    for (let i = 1; i < stops.length; i++) mi += haversineMiles(stops[i - 1], stops[i]);
    return mi;
}

function estMinutes(route) {
    const miles = routeMiles(route);
    const stops = route.length;
    return miles * MIN_PER_MILE + stops * MIN_PER_STOP;
}

/* ---------- simple greedy ordering inside each chunk ---------- */
function orderGreedy(list) {
    if (list.length <= 2) return list.slice();
    const c = centroid(list);
    // start near centroid
    let start = 0, best = Infinity;
    for (let i = 0; i < list.length; i++) {
        const d = haversineMiles(c, list[i]);
        if (d < best) { best = d; start = i; }
    }
    const rem = list.slice();
    const route = [rem.splice(start, 1)[0]];
    while (rem.length) {
        const last = route[route.length - 1];
        let bj = 0, bd = Infinity;
        for (let j = 0; j < rem.length; j++) {
            const d = haversineMiles(last, rem[j]);
            if (d < bd) { bd = d; bj = j; }
        }
        route.push(rem.splice(bj, 1)[0]);
    }
    return route;
}

/* ---------- circular sweep partition (time-balanced) ---------- */
/**
 * We sort points by polar angle around the global centroid (a ring).
 * For each index i, define an edge cost e[i] = miles(point[i], point[i+1]) around the ring (wrap at end).
 * Per-stop time weight w[i] = MIN_PER_STOP + MIN_PER_MILE * e[i] (proxy for travel to "next" point).
 * Then sweep and cut the ring into k segments with ~equal total weight.
 */
function circularSweepTimeBalanced(points, k) {
    const n = points.length;
    if (k <= 1 || n <= 1) return [points.slice()];

    const c = centroid(points);
    const ring = points
        .map((p) => ({ ...p, _ang: Math.atan2(p.lat - c.lat, p.lng - c.lng) }))
        .sort((a, b) => a._ang - b._ang)
        .map(({ _ang, ...rest }) => rest);

    // edge miles between consecutive points on the ring
    const edgeMi = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        edgeMi[i] = haversineMiles(ring[i], ring[j]);
    }

    // per-stop time weight
    const w = edgeMi.map((m) => MIN_PER_STOP + MIN_PER_MILE * m);
    const totalW = w.reduce((a, b) => a + b, 0);
    const target = totalW / k;

    const chunks = [];
    let start = 0;
    for (let part = 0; part < k; part++) {
        if (start >= n) { chunks.push([]); continue; }

        const remainingParts = k - part;
        const remainingStops = n - start;
        // ensure at least 1 stop per remaining part
        const maxIdx = n - (remainingParts - 1);
        let acc = 0;
        let end = start;

        while (end < maxIdx && acc + w[end % n] < target) {
            acc += w[end % n];
            end++;
        }
        if (end === start) end++; // force progress

        const seg = ring.slice(start, end);
        chunks.push(orderGreedy(seg));
        start = end;
    }

    return chunks;
}

/* ---------- local border re-balance by time + soft stop cap ---------- */
function rebalanceByTime(routes, opts = {}) {
    const maxPasses = opts.maxPasses ?? 4;
    const softStopCapFactor = opts.softStopCapFactor ?? 1.6;

    if (routes.length <= 1) return routes;
    let rs = routes.map((r) => r.slice());

    const totalStops = rs.flat().length;
    const avgStops = totalStops / rs.length;
    const softCap = Math.max(2, Math.ceil(avgStops * softStopCapFactor));

    const target = (() => {
        const miles = rs.reduce((s, r) => s + routeMiles(r), 0);
        return miles * MIN_PER_MILE + totalStops * MIN_PER_STOP;
    })() / rs.length;

    const minutes = (A) => estMinutes(A);

    const tryMoveOne = (i, j, fromI) => {
        const A = rs[i], B = rs[j];
        if (!A.length || !B.length) return false;

        const base =
            Math.abs(minutes(A) - target) + Math.abs(minutes(B) - target);

        let A2, B2;
        if (fromI) {
            // move A's border stop to B
            const moved = A[A.length - 1];
            A2 = A.slice(0, -1);
            B2 = B.concat(moved);
        } else {
            // move B's border stop to A
            const moved = B[0];
            A2 = A.concat(moved);
            B2 = B.slice(1);
        }

        // soft cap guard
        if (A2.length > softCap || B2.length > softCap) return false;

        A2 = orderGreedy(A2);
        B2 = orderGreedy(B2);

        const after =
            Math.abs(estMinutes(A2) - target) + Math.abs(estMinutes(B2) - target);

        if (after + 0.01 < base) {
            rs[i] = A2;
            rs[j] = B2;
            return true;
        }
        return false;
    };

    // reduce extreme stop-counts a bit up-front
    for (let i = 0; i < rs.length; i++) {
        while (rs[i].length > softCap) {
            const left = i > 0 ? i - 1 : null;
            const right = i < rs.length - 1 ? i + 1 : null;
            const pref = (() => {
                if (left == null) return right;
                if (right == null) return left;
                return estMinutes(rs[left]) <= estMinutes(rs[right]) ? left : right;
            })();
            const moved = tryMoveOne(i, pref, true) || tryMoveOne(i, pref, false);
            if (!moved) break;
        }
    }

    for (let pass = 0; pass < maxPasses; pass++) {
        // left -> right
        for (let i = 0; i < rs.length - 1; i++) {
            tryMoveOne(i, i + 1, true) || tryMoveOne(i, i + 1, false);
        }
        // right -> left
        for (let i = rs.length - 1; i > 0; i--) {
            tryMoveOne(i - 1, i, true) || tryMoveOne(i - 1, i, false);
        }
    }

    return rs;
}

/* ---------- public API ---------- */
/**
 * planRoutesBalancedByMilesArrays(users, k) -> Array<Array<user>>
 * Each user may have lat/lng OR latitude/longitude.
 * This function **balances by time**, not just miles,
 * and keeps routes compact via circular sweep ordering.
 */
export function planRoutesBalancedByMilesArrays(users, k) {
    const list = (Array.isArray(users) ? users : [])
        .map((u) => ({
            ...u,
            lat: Number(u.lat ?? u.latitude),
            lng: Number(u.lng ?? u.longitude),
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    const K = Math.max(1, Math.min((k | 0) || 1, Math.max(1, list.length)));
    if (list.length === 0) return Array.from({ length: K }, () => []);

    // 1) geography-aware circular sweep, equalizing **time weight**
    const seed = circularSweepTimeBalanced(list, K);

    // 2) local re-balance by time with a soft cap on #stops per route
    const routes = rebalanceByTime(seed, {
        maxPasses: 5,
        softStopCapFactor: 1.6, // tighten if one route still hoards stops
    });

    return routes;
}

export default planRoutesBalancedByMilesArrays;