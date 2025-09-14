// utils/routing/clustering.js
// Area-aware, mileage-balanced clustering. Prevents strays up-front.

import { haversineMiles, asPt, centroid } from "./distance.js";

/**
 * KMeans++ initialization (geographic).
 */
function kppInit(stops, k) {
    const pts = stops.map(asPt);
    // choose first randomly
    const centers = [pts[Math.floor(Math.random() * pts.length)]];
    while (centers.length < k) {
        // distance to nearest center
        const d2 = pts.map((p) =>
            Math.min(...centers.map((c) => haversineMiles(p, c))) ** 2
        );
        const sum = d2.reduce((a, b) => a + b, 0);
        let r = Math.random() * sum;
        let idx = 0;
        for (let i = 0; i < d2.length; i++) {
            r -= d2[i];
            if (r <= 0) {
                idx = i;
                break;
            }
        }
        centers.push(pts[idx]);
    }
    return centers.map((c) => ({ ...c }));
}

/**
 * Compute dominant city (most frequent) for a set of stops.
 */
function dominantCity(stops) {
    const m = new Map();
    for (const s of stops) {
        if (!s.city) continue;
        m.set(s.city, (m.get(s.city) || 0) + 1);
    }
    let best = null;
    let count = 0;
    for (const [city, n] of m) {
        if (n > count) {
            count = n;
            best = city;
        }
    }
    return best;
}

/**
 * Main clustering.
 * cost = distance + lambda * miles_over_target + gamma * crossCity
 *
 * @param {Array<{id:string, lat:number, lng:number, city?:string}>} stops
 * @param {number} k driver count
 * @param {{targetMiles?:number, lambda?:number, gamma?:number, iters?:number, hardCityLock?:boolean}} options
 * @returns {{clusters: Array<{stops:any[], centroid:{lat:number,lng:number}, city?:string}>, assignment:number[]}}
 */
export function areaBalancedCluster(
    stops,
    k,
    { targetMiles, lambda = 0.6, gamma = 0.8, iters = 10, hardCityLock = false } = {}
) {
    if (!stops.length || k <= 0) return { clusters: [], assignment: [] };

    // Seed
    let centers = kppInit(stops, Math.min(k, stops.length));
    // Expand to K if fewer (degenerate cases)
    while (centers.length < k) centers.push({ ...centers[0] });

    // If no target given, estimate from overall spread.
    if (!targetMiles) {
        const cAll = centroid(stops.map(asPt)) || centers[0];
        const meanDist =
            stops.map((s) => haversineMiles(asPt(s), cAll)).reduce((a, b) => a + b, 0) /
            stops.length;
        targetMiles = meanDist * (stops.length / k) * 1.25; // heuristic
    }

    let assignment = new Array(stops.length).fill(0);

    for (let t = 0; t < iters; t++) {
        const clStops = Array.from({ length: k }, () => []);
        const clMiles = Array.from({ length: k }, () => 0);

        // Assign
        for (let i = 0; i < stops.length; i++) {
            const s = stops[i];
            let best = 0;
            let bestCost = Infinity;
            for (let j = 0; j < k; j++) {
                const d = haversineMiles(asPt(s), centers[j]);
                // optional hard city constraint after a couple of iters (when a centroid has a dominant city)
                let crossPenalty = 0;
                if (s.city && centers[j].city) {
                    if (s.city !== centers[j].city) crossPenalty = gamma;
                    else crossPenalty = 0;
                }
                // If hard lock is on and this centroid has a city, forbid cross-city
                if (hardCityLock && centers[j].city && s.city && centers[j].city !== s.city) {
                    continue;
                }
                const milesBias =
                    lambda * Math.max(0, (clMiles[j] + d) - targetMiles);
                const cost = d + milesBias + crossPenalty;
                if (cost < bestCost) {
                    bestCost = cost;
                    best = j;
                }
            }
            assignment[i] = best;
            clStops[best].push(s);
            // Rough miles accrual using center distance
            clMiles[best] += haversineMiles(centers[best], asPt(s));
        }

        // Recompute centers
        for (let j = 0; j < k; j++) {
            if (clStops[j].length) {
                const c = centroid(clStops[j].map(asPt));
                centers[j] = { ...c, city: dominantCity(clStops[j]) };
            }
        }

        // If hard lock requested, enable it after a few stabilization rounds
        if (hardCityLock && t === Math.floor(iters / 2)) {
            // propagate dominant city to all centers lacking one
            for (let j = 0; j < k; j++) {
                if (!centers[j].city && clStops[j].length) {
                    centers[j].city = dominantCity(clStops[j]);
                }
            }
        }
    }

    // Build clusters
    const clusters = Array.from({ length: k }, () => ({ stops: [], centroid: null, city: null }));
    for (let j = 0; j < k; j++) {
        clusters[j].stops = [];
    }
    for (let i = 0; i < stops.length; i++) {
        const j = assignment[i];
        clusters[j].stops.push(stops[i]);
    }
    for (let j = 0; j < k; j++) {
        if (clusters[j].stops.length) {
            clusters[j].centroid = centroid(clusters[j].stops.map(asPt));
            clusters[j].city = dominantCity(clusters[j].stops);
        } else {
            clusters[j].centroid = centers[j];
            clusters[j].city = centers[j].city || null;
        }
    }

    return { clusters, assignment };
}