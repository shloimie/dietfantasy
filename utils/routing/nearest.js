// utils/routing/nearest.js
import { pointDistance, centroid } from "./distance";

/** Greedy nearest-neighbor ordering for points with {lat, lng} */
export function buildNearestNeighborRoute(points) {
    if (!points?.length) return [];
    if (points.length <= 2) return points.slice();

    const remaining = points.slice();
    // Start near the centroid
    const ctr = centroid(remaining);
    let startIdx = 0, best = Infinity;
    for (let i = 0; i < remaining.length; i++) {
        const d = pointDistance(ctr, remaining[i]);
        if (d < best) { best = d; startIdx = i; }
    }

    const route = [remaining.splice(startIdx, 1)[0]];
    while (remaining.length) {
        const last = route[route.length - 1];
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const d = pointDistance(last, remaining[i]);
            if (d < bestD) { bestD = d; bestI = i; }
        }
        route.push(remaining.splice(bestI, 1)[0]);
    }
    return route;
}