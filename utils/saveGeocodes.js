// utils/saveGeocodes.js
export async function saveGeocodesBulk(updates = []) {
    if (!updates.length) return;
    const res = await fetch("/api/users/geo/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
    });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "Failed saving geocodes");
    }
}