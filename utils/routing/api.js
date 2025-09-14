// utils/routing/api.js

/** Call server endpoint to geocode any users missing lat/lng */
export async function apiGeocodeMissing() {
    const res = await fetch("/api/route/geocode-missing", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { updated: number }
}

/** Optional: call a server planner (if you add /api/route/plan) */
export async function apiPlanRoutes(drivers = 5, day = "all") {
    const res = await fetch("/api/route/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drivers, day }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { routes, unrouted }
}