// utils/labelsByRoutes.js
// Build labels in driver/route order, colored per driver, without changing the original labels flow.

import { exportLabelsPDF } from "./pdfLabels";

// simple palette if none provided
const DEFAULT_DRIVER_COLORS = [
    "#E53935", "#8E24AA", "#3949AB", "#1E88E5", "#00897B",
    "#43A047", "#FDD835", "#FB8C00", "#6D4C41", "#546E7A",
    "#D81B60", "#5E35B1", "#039BE5", "#00ACC1", "#7CB342",
];

/**
 * Make a city->color mapper based on the route a city first appears in.
 * This keeps colors consistent with driver assignment for most datasets.
 */
function makeGetCityColor(routes, driverColors) {
    const map = Object.create(null);
    routes.forEach((route, driverIdx) => {
        const color = driverColors[driverIdx % driverColors.length] || "#000000";
        route.forEach((u) => {
            const city = String(u?.city ?? "").trim();
            if (!city) return;
            if (!map[city]) map[city] = color;
        });
    });
    return (city) => map[String(city ?? "").trim()] || "#000000";
}

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || "").trim());
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Flatten routes into one ordered list: Driver 1 (in route order), Driver 2, ...
 * Also normalizes lat/lng fields so downstream distance calcs (if any) are safe.
 */
function flattenOrdered(routes) {
    const out = [];
    routes.forEach((route) => {
        route.forEach((u) => {
            out.push({ ...u, lat: u.lat ?? u.latitude, lng: u.lng ?? u.longitude });
        });
    });
    return out;
}

/**
 * Export labels in driver/route order (additional option; does not modify original labels button).
 * @param {Array<Array<User>>} routes  array of routes, each route is array of users in order
 * @param {Object} opts
 * @param {string[]} [opts.driverColors]  hex colors per driver (fallback palette used if omitted)
 * @param {function} [opts.tsString]      timestamp function to name the file
 */
export default async function exportLabelsByRoutes(routes, opts = {}) {
    const driverColors = Array.isArray(opts.driverColors) && opts.driverColors.length
        ? opts.driverColors
        : DEFAULT_DRIVER_COLORS;

    const getCityColor = makeGetCityColor(routes, driverColors);
    const ordered = flattenOrdered(routes);

    // reuse your existing PDF label generator
    await exportLabelsPDF(ordered, getCityColor, hexToRgb, opts.tsString || (() => ""));
}