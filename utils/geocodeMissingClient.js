// utils/geocodeMissingClient.js
// Calls your server route that fills in missing lat/lng using Mapbox → Google fallback.
// Safe to call with an empty list; returns a normalized shape.

export async function geocodeMissingViaApi(unlocatedUsers) {
    try {
        const payload = Array.isArray(unlocatedUsers) ? unlocatedUsers : [];
        const res = await fetch("/api/route/geocode-missing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Your server route already reads missing users from DB.
            // We also send a payload so you can tighten it later if you want.
            body: JSON.stringify({ users: payload }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Backup geocode failed: ${res.status} ${text}`);
        }
        const data = await res.json().catch(() => ({}));
        return {
            updated: Number(data?.updated ?? 0),
            users: Array.isArray(data?.users) ? data.users : [],
            tried: Number(data?.tried ?? 0),
            details: Array.isArray(data?.details) ? data.details : [],
        };
    } catch (e) {
        console.error("geocodeMissingViaApi error:", e);
        throw e;
    }
}