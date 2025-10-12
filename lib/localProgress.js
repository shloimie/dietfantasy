// lib/localProgress.js

function localKey(driverId) {
    return `completed_by_driver_${driverId}`;
}

export function loadCompleted(driverId) {
    try {
        const raw = localStorage.getItem(localKey(driverId));
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
}

export function saveCompleted(driverId, ids) {
    try {
        localStorage.setItem(localKey(driverId), JSON.stringify(Array.from(ids)));
    } catch {}
}

export function addCompleted(driverId, stopId) {
    const set = loadCompleted(driverId);
    set.add(String(stopId));
    saveCompleted(driverId, set);
}

/**
 * Merge stops with local completions.
 * Marks stop.completed = true only if present in localStorage.
 */
export function mergeStopsWithLocal(driverId, stops = []) {
    const done = loadCompleted(driverId);
    return (stops ?? []).map((s) =>
        done.has(String(s.id)) ? { ...s, completed: true } : { ...s, completed: false }
    );
}

/**
 * Count completed vs total for a driver from localStorage.
 */
export function countWithLocal(driverId, stops = []) {
    const done = loadCompleted(driverId);
    const total = stops.length;
    const completed = stops.filter((s) => done.has(String(s.id))).length;
    const pct = total ? (completed / total) * 100 : 0;
    return { total, completed, pct };
}