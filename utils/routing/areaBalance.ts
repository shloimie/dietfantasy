// utils/routing/areaBalance.ts
// Morton (Z-order) split -> equal contiguous chunks -> simple NN order per chunk
export type LatLng = { id: number; lat: number; lng: number };

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const sa = Math.sin(dLat / 2), sb = Math.sin(dLng / 2);
    const A = sa * sa + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sb * sb;
    return 2 * R * Math.asin(Math.sqrt(A));
}

// Equal-size quotas that differ by at most 1 (contiguous, stable)
function quotas(n: number, k: number) {
    const res: number[] = [];
    for (let i = 0; i < k; i++) {
        const a = Math.round(((i + 1) * n) / k) - Math.round((i * n) / k);
        res.push(a);
    }
    return res;
}

// Interleave 16-bit x and y into a 32-bit Morton code
function part1by1(v: number) {
    v &= 0x0000ffff;
    v = (v | (v << 8)) & 0x00FF00FF;
    v = (v | (v << 4)) & 0x0F0F0F0F;
    v = (v | (v << 2)) & 0x33333333;
    v = (v | (v << 1)) & 0x55555555;
    return v >>> 0;
}
function morton(x: number, y: number) {
    return (part1by1(x) | (part1by1(y) << 1)) >>> 0;
}

// Map lat/lng to 16-bit grid in the local bounding box
function toGrid(
    p: { lat: number; lng: number },
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    flipX = false,
    flipY = false
) {
    const { minLat, maxLat, minLng, maxLng } = bbox;
    const width = Math.max(1e-9, maxLng - minLng);
    const height = Math.max(1e-9, maxLat - minLat);
    let nx = (p.lng - minLng) / width;
    let ny = (p.lat - minLat) / height;
    if (flipX) nx = 1 - nx;
    if (flipY) ny = 1 - ny;
    const x = Math.max(0, Math.min(65535, Math.floor(nx * 65535)));
    const y = Math.max(0, Math.min(65535, Math.floor(ny * 65535)));
    return { x, y };
}

// Simple NN order inside each chunk to get a usable visiting sequence
function nnOrder(points: LatLng[]) {
    if (points.length <= 2) return points.map(p => p.id);
    const centroid = {
        lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
        lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
    };
    let start = 0, best = Infinity;
    for (let i = 0; i < points.length; i++) {
        const d = haversine(centroid, points[i]);
        if (d < best) { best = d; start = i; }
    }
    const remaining = points.slice();
    const route: LatLng[] = [remaining.splice(start, 1)[0]];
    while (remaining.length) {
        const last = route[route.length - 1];
        let ni = 0, nd = Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const d = haversine(last, remaining[i]);
            if (d < nd) { nd = d; ni = i; }
        }
        route.push(remaining.splice(ni, 1)[0]);
    }
    return route.map(p => p.id);
}

/**
 * Plan by Morton sorting:
 *  1) Compute bbox, convert each point to 16-bit grid coords.
 *  2) Morton-code each point; sort by that code (space-filling curve).
 *  3) Cut sorted list into K contiguous chunks (equal sizes ±1).
 *  4) For each chunk, NN order for the visiting sequence.
 */
export function planRoutesByAreaBalanced(points: LatLng[], driverCount: number) {
    if (driverCount <= 0) throw new Error("driverCount must be >= 1");
    if (points.length === 0) return [];

    const minLat = Math.min(...points.map(p => p.lat));
    const maxLat = Math.max(...points.map(p => p.lat));
    const minLng = Math.min(...points.map(p => p.lng));
    const maxLng = Math.max(...points.map(p => p.lng));
    const bbox = { minLat, maxLat, minLng, maxLng };

    // Try four orientations and pick the one with lowest within-chunk span
    const orientations = [
        { flipX: false, flipY: false },
        { flipX: true, flipY: false },
        { flipX: false, flipY: true },
        { flipX: true, flipY: true },
    ];

    let bestSorted: LatLng[] = points;
    let bestScore = Infinity;

    for (const o of orientations) {
        const sorted = points
            .map(p => {
                const g = toGrid(p, bbox, o.flipX, o.flipY);
                return { p, code: morton(g.x, g.y) };
            })
            .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
            .map(x => x.p);

        const q = quotas(points.length, driverCount);
        let idx = 0, score = 0;
        for (let i = 0; i < driverCount; i++) {
            const csize = q[i];
            const chunk = sorted.slice(idx, idx + csize);
            idx += csize;
            if (chunk.length <= 1) continue;
            const cMinLat = Math.min(...chunk.map(p => p.lat));
            const cMaxLat = Math.max(...chunk.map(p => p.lat));
            const cMinLng = Math.min(...chunk.map(p => p.lng));
            const cMaxLng = Math.max(...chunk.map(p => p.lng));
            score += (cMaxLat - cMinLat) + (cMaxLng - cMinLng);
        }
        if (score < bestScore) { bestScore = score; bestSorted = sorted; }
    }

    const q = quotas(points.length, driverCount);
    const routes: { driverIndex: number; center: { lat: number; lng: number }; stopIds: number[]; count: number }[] = [];

    let offset = 0;
    for (let i = 0; i < driverCount; i++) {
        const size = q[i];
        const chunk = bestSorted.slice(offset, offset + size);
        offset += size;

        const stopIds = nnOrder(chunk);
        const center = {
            lat: chunk.reduce((s, p) => s + p.lat, 0) / Math.max(1, chunk.length),
            lng: chunk.reduce((s, p) => s + p.lng, 0) / Math.max(1, chunk.length),
        };

        routes.push({
            driverIndex: i,
            center,
            stopIds,
            count: stopIds.length,
        });
    }

    return routes;
}