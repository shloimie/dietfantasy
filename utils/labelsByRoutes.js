// utils/labelsByRoutes.js
// Export Avery labels in driver order with Driver 0 forced to the end.

import { exportLabelsPDF } from "./pdfLabels";

/* ===================== Palette ===================== */
const DEFAULT_DRIVER_COLORS = [
    "#E53935", "#8E24AA", "#3949AB", "#1E88E5", "#00897B",
    "#43A047", "#FDD835", "#FB8C00", "#6D4C41", "#546E7A",
    "#D81B60", "#5E35B1", "#039BE5", "#00ACC1", "#7CB342",
];

/* ===================== Helpers ===================== */
function driverRankByName(name) {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || "").trim());
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Accepts either:
 *  - Array<{ driverName?: string, color?: string, stops: User[] }>
 *  - Array<User[]>  (plain routes with no names)
 * Returns an array of { driverName, color, stops }.
 */
function normalizeRoutes(routes, palette = DEFAULT_DRIVER_COLORS) {
    if (!Array.isArray(routes)) return [];

    const isObjectForm = routes.some((r) => r && typeof r === "object" && Array.isArray(r.stops));
    if (isObjectForm) {
        // Ensure shape & fallback names/colors
        return routes.map((r, i) => {
            const name = r.driverName || `Driver ${i}`;
            const color = r.color || (i === 0 ? "#666666" : palette[(i - 0) % palette.length]);
            return { driverName: name, color, stops: Array.isArray(r.stops) ? r.stops : [] };
        });
    }

    // Plain array-of-arrays: synth names Driver 0, 1, …
    return routes.map((stops, i) => ({
        driverName: `Driver ${i}`,
        color: i === 0 ? "#666666" : palette[(i - 0) % palette.length],
        stops: Array.isArray(stops) ? stops : [],
    }));
}

/** City → color mapping based on first route (driver) a city appears in. */
function makeGetCityColor(routeStopsOnly, driverColors) {
    const map = Object.create(null);
    routeStopsOnly.forEach((route, driverIdx) => {
        const color = driverColors[driverIdx % driverColors.length] || "#000000";
        route.forEach((u) => {
            const city = String(u?.city ?? "").trim();
            if (city && !map[city]) map[city] = color;
        });
    });
    return (city) => map[String(city ?? "").trim()] || "#000000";
}

/* ===================== Main ===================== */
export default async function exportLabelsByRoutes(routes, opts = {}) {
    const driverColors =
        Array.isArray(opts.driverColors) && opts.driverColors.length
            ? opts.driverColors
            : DEFAULT_DRIVER_COLORS;

    // 1) Normalize input
    const normalized = normalizeRoutes(routes, driverColors);

    // 2) Sort with the rule: Drivers 1..N first (ascending), Driver 0 LAST.
    normalized.sort((a, b) => {
        const ra = driverRankByName(a.driverName);
        const rb = driverRankByName(b.driverName);
        const ka = ra === 0 ? Number.POSITIVE_INFINITY : ra;
        const kb = rb === 0 ? Number.POSITIVE_INFINITY : rb;
        return ka - kb;
    });

    // 3) Stamp metadata on each stop (kept for downstream consumers if needed)
    normalized.forEach((routeObj, fallbackIdx) => {
        const dNumParsed = driverRankByName(routeObj.driverName);
        const driverNum = Number.isFinite(dNumParsed) ? dNumParsed : fallbackIdx;
        (routeObj.stops || []).forEach((u, stopIdx) => {
            u.__driverNumber = driverNum;          // actual driver number (0 is now last in order)
            u.__driverName   = routeObj.driverName;
            u.__stopIndex    = stopIdx;            // 0-based
            // Normalize lat/lng for downstream code
            if (u.lat == null && u.latitude != null) u.lat = u.latitude;
            if (u.lng == null && u.longitude != null) u.lng = u.longitude;
        });
    });

    // 4) Build city color mapper in this final order
    const routeStopsOnly = normalized.map((r) => r.stops || []);
    const getCityColor = makeGetCityColor(routeStopsOnly, driverColors);

    // 5) Flatten in this exact (sorted) order
    const ordered = [];
    routeStopsOnly.forEach((route) => {
        route.forEach((u) => ordered.push(u));
    });

    // 6) Generate labels
    await exportLabelsPDF(ordered, getCityColor, hexToRgb, opts.tsString || (() => ""));
}