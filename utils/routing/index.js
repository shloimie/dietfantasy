// utils/routing/index.js
// Single source of truth. Turbopack-friendly (no dynamic exports).

// -----------------------------
// Tuning constants (used app-wide)
// -----------------------------
export const MIN_PER_MILE = 7;  // minutes per mile (adjust as needed)
export const MIN_PER_STOP = 3;  // minutes per stop (adjust as needed)

// -----------------------------
// Planner (time-balanced; returns Array<Array<stop>>)
// Create a LOCAL binding for the legacy wrapper, and also re-export.
// -----------------------------
import {
    planRoutesBalancedByMilesArrays as _planRoutesBalancedByMilesArrays,
} from "./balanceByMiles.js";

export {
    planRoutesBalancedByMilesArrays,
    default as planRoutesBalancedByMilesArraysDefault,
} from "./balanceByMiles.js";

// Stable alias some places still import:
export { planRoutesBalancedByMilesArrays as planRoutesBalancedByMiles } from "./balanceByMiles.js";

// Legacy wrapper used by older UI (`planRoutes(cands, k)`):
export function planRoutes(candidates, driverCount) {
    return _planRoutesBalancedByMilesArrays(candidates, driverCount);
}

// -----------------------------
// Clustering primitive (if something still imports it)
// -----------------------------
export {
    areaBalancedCluster,
    default as areaBalancedClusterDefault,
} from "./balanced.js";

// -----------------------------
// Server API helpers (DriversDialog “Geocode Missing”, etc.)
// -----------------------------
export { apiGeocodeMissing, apiPlanRoutes } from "./api.js";

// -----------------------------
// Core helpers your UI references
// (Limit to the ones we know your UI imports. Add more if needed.)
// -----------------------------
export { getGeocodedCandidates, normalizeDay } from "./core.js";

// -----------------------------
// Geo helpers used by map/pdf/word code
// -----------------------------
export { haversineMiles, centroid, pathMiles } from "./distance.js";