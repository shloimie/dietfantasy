// utils/saveGeocodes.js
export async function saveGeocodesBulk(updates) {
    const res = await fetch("/api/users/geo/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        let reason = `HTTP ${res.status}`;
        try { reason = JSON.parse(text)?.error || reason; } catch {}
        throw new Error(`saveGeocodesBulk failed: ${reason}`);
    }
    const data = await res.json();
    return { results: Array.isArray(data?.results) ? data.results : [] };
}