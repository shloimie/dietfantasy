// utils/routeOptimize.ts
export type StopLite = { id: number; lat: number; lng: number };

/** Haversine distance in KM */
export function haversineKm(a: StopLite, b: StopLite): number {
    const R = 6371;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Sum of distances along an OPEN path (no last->first) */
export function pathLengthKm(path: StopLite[]): number {
    let d = 0;
    for (let i = 0; i < path.length - 1; i++) d += haversineKm(path[i], path[i + 1]);
    return d;
}

/* ----------------------- Seed heuristics ----------------------- */

/** Nearest-neighbor from a given start index */
export function seedNearestNeighbor(stops: StopLite[], startIndex = 0): StopLite[] {
    const n = stops.length;
    if (n <= 2) return stops.slice();
    const used = new Array(n).fill(false);
    const order: StopLite[] = [];
    let cur = startIndex;
    for (let k = 0; k < n; k++) {
        order.push(stops[cur]);
        used[cur] = true;
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < n; i++) {
            if (!used[i]) {
                const d = haversineKm(stops[cur], stops[i]);
                if (d < bestDist) { bestDist = d; best = i; }
            }
        }
        if (best === -1) break;
        cur = best;
    }
    return order;
}

/** Farthest-insertion (open path) */
export function seedFarthestInsertion(stops: StopLite[]): StopLite[] {
    const n = stops.length;
    if (n <= 2) return stops.slice();
    // start with the two farthest points
    let a = 0, b = 1, best = -1;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = haversineKm(stops[i], stops[j]);
        if (d > best) { best = d; a = i; b = j; }
    }
    const inPath = [stops[a], stops[b]];
    const used = new Array(n).fill(false);
    used[a] = used[b] = true;

    while (inPath.length < n) {
        // pick farthest point from current path
        let farIdx = -1, farDist = -1;
        for (let i = 0; i < n; i++) if (!used[i]) {
            let minToPath = Infinity;
            for (let k = 0; k < inPath.length; k++) {
                const d = haversineKm(stops[i], inPath[k]);
                if (d < minToPath) minToPath = d;
            }
            if (minToPath > farDist) { farDist = minToPath; farIdx = i; }
        }
        // insert at cheapest position
        let bestPos = 0, bestInc = Infinity;
        for (let p = 0; p < inPath.length; p++) {
            const prev = inPath[p];
            const next = inPath[p + 1];
            const inc = next
                ? (haversineKm(prev, stops[farIdx]) + haversineKm(stops[farIdx], next) - haversineKm(prev, next))
                : haversineKm(prev, stops[farIdx]); // append at end
            if (inc < bestInc) { bestInc = inc; bestPos = p + 1; }
        }
        inPath.splice(bestPos, 0, stops[farIdx]);
        used[farIdx] = true;
    }
    return inPath;
}

/** Angle sweep around centroid (sort by bearing) */
export function seedAngleSweep(stops: StopLite[]): StopLite[] {
    if (stops.length <= 2) return stops.slice();
    const cx = stops.reduce((s, p) => s + p.lng, 0) / stops.length;
    const cy = stops.reduce((s, p) => s + p.lat, 0) / stops.length;
    return stops.slice().sort((a, b) => Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx));
}

/* ----------------------- Local improvements ----------------------- */

/** 2-opt on an OPEN path (no last->first edge). Removes crossings. */
export function twoOptOpenPath(path: StopLite[]): StopLite[] {
    if (path.length <= 3) return path.slice();
    const best = path.slice();
    let improved = true;
    while (improved) {
        improved = false;
        for (let i = 1; i < best.length - 1; i++) {
            for (let j = i; j < best.length - 1; j++) {
                const a = best[i - 1];
                const b = best[i];
                const c = best[j];
                const d = best[j + 1];
                const delta =
                    haversineKm(a, c) + haversineKm(b, d) -
                    (haversineKm(a, b) + haversineKm(c, d));
                if (delta < -1e-6) {
                    // reverse segment [i..j]
                    for (let l = 0; l < Math.floor((j - i + 1) / 2); l++) {
                        const tmp = best[i + l];
                        best[i + l] = best[j - l];
                        best[j - l] = tmp;
                    }
                    improved = true;
                }
            }
        }
    }
    return best;
}

/**
 * Or-opt (open path): relocate a segment of length 1..k (k<=3) to another place if it reduces length.
 * Great for de-spaghettifying residential grids after 2-opt.
 */
export function orOptOpenPath(path: StopLite[], maxSegment = 3): StopLite[] {
    if (path.length <= 3) return path.slice();
    const p = path.slice();
    let improved = true;
    while (improved) {
        improved = false;
        for (let seg = 1; seg <= Math.min(maxSegment, p.length - 1); seg++) {
            for (let i = 1; i + seg <= p.length - 1; i++) {
                const segment = p.slice(i, i + seg);
                const left = p[i - 1];
                const right = p[i + seg] ?? null;

                const removeDelta =
                    (right ? haversineKm(left, right) : 0) -
                    (haversineKm(left, p[i]) + (right ? haversineKm(p[i + seg - 1], right) : 0));

                for (let j = 0; j < p.length; j++) {
                    if (j >= i && j <= i + seg) continue; // can't insert inside itself
                    const before = p[j - 1];
                    const after = p[j];
                    const insertDelta =
                        (after ? (haversineKm(before ?? segment[0], segment[0]) + haversineKm(segment[segment.length - 1], after) - (before ? haversineKm(before, after) : 0))
                            : (before ? haversineKm(before, segment[0]) : 0));

                    if (removeDelta + insertDelta < -1e-6) {
                        // perform move: remove segment then insert at j (post-remove index adjust)
                        p.splice(i, seg);
                        const target = j > i ? j - seg : j;
                        p.splice(target, 0, ...segment);
                        improved = true;
                    }
                    if (improved) break;
                }
                if (improved) break;
            }
            if (improved) break;
        }
    }
    return p;
}

/* ----------------------- Full pipeline ----------------------- */

export type OptimizeOptions = {
    lockFirst?: boolean; // keep first stop fixed
    lockLast?: boolean;  // keep last stop fixed
    multiStarts?: number; // how many NN random starts to try
};

/**
 * Multi-start: try several seeds (NN from different starts, farthest-insertion, angle sweep),
 * then run 2-opt + Or-opt, keep the best.
 */
export function optimizeStopsOpenPath(
    stops: StopLite[],
    opts: OptimizeOptions = {}
) {
    const n = stops.length;
    if (n <= 2) return { beforeKm: pathLengthKm(stops), afterKm: pathLengthKm(stops), optimized: stops.slice() };

    // Build candidate seeds
    const seeds: StopLite[][] = [];

    // Angle sweep and farthest insertion
    seeds.push(seedAngleSweep(stops));
    seeds.push(seedFarthestInsertion(stops));

    // Nearest neighbor from multiple starts
    const m = Math.min(opts.multiStarts ?? 5, n);
    const step = Math.max(1, Math.floor(n / m));
    for (let s = 0; s < n; s += step) seeds.push(seedNearestNeighbor(stops, s));

    // Optionally lock ends by reordering after improvement
    function applyLocks(path: StopLite[]): StopLite[] {
        if (!opts.lockFirst && !opts.lockLast) return path;
        const first = opts.lockFirst ? stops[0] : null;
        const last = opts.lockLast ? stops[n - 1] : null;

        let p = path.slice();
        if (first) {
            const i = p.findIndex(x => x.id === first.id);
            if (i > 0) {
                const segment = p.splice(i, 1)[0];
                p.unshift(segment);
            }
        }
        if (last) {
            const j = p.findIndex(x => x.id === last.id);
            if (j !== p.length - 1 && j !== -1) {
                const segment = p.splice(j, 1)[0];
                p.push(segment);
            }
        }
        return p;
    }

    // Improve each seed and keep the best
    let bestPath = stops.slice();
    let bestLen = pathLengthKm(bestPath);

    for (const seed of seeds) {
        let p = seed;
        p = twoOptOpenPath(p);
        p = orOptOpenPath(p, 3);
        p = applyLocks(p);
        const L = pathLengthKm(p);
        if (L < bestLen - 1e-6) {
            bestLen = L;
            bestPath = p;
        }
    }

    return {
        beforeKm: pathLengthKm(stops),
        afterKm: bestLen,
        optimized: bestPath,
    };
}