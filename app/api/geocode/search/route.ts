// app/api/geocode/search/route.ts
import { NextResponse } from "next/server";

const TIMEOUT  = Number(process.env.GEOCODE_TIMEOUT_MS || 7000);
const COUNTRY  = (process.env.GEOCODE_COUNTRY || "US").toLowerCase();
const BOUNDS   = process.env.GEOCODE_BOUNDS || "-75.8,39.5,-72.9,41.9"; // lon1,lat1,lon2,lat2

const GOOGLE_KEY    = process.env.GOOGLE_MAPS_KEY || "";
const GOOGLE_BOUNDS = process.env.GEOCODE_GOOGLE_BOUNDS || "39.5,-75.8|41.9,-72.9";

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT) {
    return Promise.race([
        p,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
    ]);
}

function stripUnit(s: string) {
    return (s || "")
        .replace(/\b(apt|apartment|unit|ste|suite|fl|floor|bsmnt|basement|rm|room|#)\s*[\w\-\/]+/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

async function googleSearch(q: string, limit: number) {
    if (!GOOGLE_KEY) throw new Error("google disabled");
    const params = new URLSearchParams({
        key: GOOGLE_KEY,
        address: q,
        components: `country:${COUNTRY.toUpperCase()}|administrative_area:NY|administrative_area:NJ`,
        bounds: GOOGLE_BOUNDS,
        region: "us",
    });
    const res = await withTimeout(fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`));
    if (!res.ok) throw new Error("google upstream");
    const data = await res.json();
    const items = (data?.results || [])
        .slice(0, limit)
        .map((r: any) => ({
            label: r.formatted_address,
            lat: r?.geometry?.location?.lat,
            lng: r?.geometry?.location?.lng,
        }))
        .filter((i: any) => Number.isFinite(i.lat) && Number.isFinite(i.lng));
    if (!items.length) throw new Error("google empty");
    return items;
}

async function nominatimSearch(q: string, limit: number) {
    const params = new URLSearchParams({
        format: "json",
        q,
        addressdetails: "1",
        limit: String(limit),
        countrycodes: COUNTRY,
        bounded: "1",
        viewbox: BOUNDS,
    });
    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const res = await withTimeout(fetch(url, {
        headers: {
            "User-Agent": "diet-drivers/1.0 (contact: admin@local)",
            "Accept": "application/json",
        },
        next: { revalidate: 0 },
    }));
    if (!res.ok) throw new Error("nominatim upstream");
    const arr = await res.json();
    return (arr || []).map((r: any) => ({
        label: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
    })).filter((i: any) => Number.isFinite(i.lat) && Number.isFinite(i.lng));
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const q0 = (searchParams.get("q") || "").trim();
    const q = stripUnit(q0);
    const limit = Math.min(Number(searchParams.get("limit") || 6), 10);
    if (!q) return NextResponse.json({ items: [] });

    try {
        const items = await googleSearch(q, limit);
        return NextResponse.json({ items });
    } catch { /* fall back */ }

    try {
        const items = await nominatimSearch(q, limit);
        return NextResponse.json({ items });
    } catch (e: any) {
        return NextResponse.json({ items: [], error: e?.message || "search failed" }, { status: 502 });
    }
}