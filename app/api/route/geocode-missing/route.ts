export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

/** === Tune these to your service area (lng,lat order) ===
 * Rockland/Passaic-ish example: west,south,east,north
 */
const BBOX = [-75.0, 40.3, -73.5, 41.6];        // [west, south, east, north]
const PROXIMITY = [-74.07, 41.11];              // [lng, lat] bias

// gentle pacing so we don’t hit provider QPS limits
const SLEEP_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** =====================
 *  Helper / formatters
 *  ===================== */

function buildQuery(u) {
    // Build a stronger query string so Mapbox doesn’t guess wrong places
    return [
        u.address ?? "",
        u.apt ? ` ${u.apt}` : "",
        u.city ? `, ${u.city}` : "",
        u.state ? `, ${u.state}` : "",
        u.zip ? ` ${u.zip}` : "",
    ]
        .join("")
        .trim();
}
function formatAddressGoogle(u) {
    const line1 = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
    const cityStZip = [u.city, u.state, u.zip].filter(Boolean).join(" ");
    return [line1, cityStZip].filter(Boolean).join(", ");
}
function upper(s) {
    return String(s ?? "").trim().toUpperCase();
}

/** =====================
 *  Mapbox (primary)
 *  ===================== */

function mapboxCityStateOK(feature, wantCity, wantState) {
    // Context can hold place (city) and region (state)
    const ctx = [
        ...(feature?.context ?? []),
        ...(feature?.properties?.context ?? []),
    ];

    const place =
        ctx.find((c) => typeof c.id === "string" && c.id.startsWith("place."))
            ?.text ?? feature?.place;

    const regionShort =
        ctx.find((c) => typeof c.short_code === "string")?.short_code ?? "";

    const gotCity = upper(place); // e.g. "AIRMONT"
    const gotState = regionShort.toUpperCase(); // e.g. "US-NY"

    const cityOK = !wantCity || gotCity === wantCity;
    const stateOK = !wantState || gotState.endsWith(`-${wantState}`);

    return cityOK && stateOK;
}

async function geocodeWithMapbox(u) {
    if (!process.env.MAPBOX_ACCESS_TOKEN) return null;

    const query = buildQuery(u);
    if (!query) return null;

    const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
            query
        )}.json`
    );

    url.searchParams.set("access_token", process.env.MAPBOX_ACCESS_TOKEN || "");
    url.searchParams.set("country", "US");
    url.searchParams.set("types", "address"); // only address matches
    url.searchParams.set("limit", "1");
    url.searchParams.set("bbox", BBOX.join(",")); // hard constrain to your area
    url.searchParams.set("proximity", PROXIMITY.join(",")); // bias near your hub

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();

    const feat = data?.features?.[0];
    if (!feat?.center) return null;

    // Validate city/state against user record
    const ok = mapboxCityStateOK(feat, upper(u.city), upper(u.state));
    if (!ok) return null;

    const [lng, lat] = feat.center;
    if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        Number.isNaN(lat) ||
        Number.isNaN(lng)
    ) {
        return null;
    }
    return { lat, lng, source: "mapbox" };
}

/** =====================
 *  Google (fallback)
 *  ===================== */

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

function googleCityStateFromComponents(components) {
    const pick = (type) =>
        components.find((c) => c.types?.includes(type))?.short_name ||
        components.find((c) => c.types?.includes(type))?.long_name;

    const city =
        pick("locality") ||
        pick("sublocality") ||
        pick("postal_town") ||
        null;

    const state = pick("administrative_area_level_1") || null;
    const zip = pick("postal_code") || null;

    return { city, state, zip };
}

async function geocodeWithGoogle(u) {
    if (!process.env.GOOGLE_MAPS_API_KEY) return null;

    const addr = formatAddressGoogle(u);
    if (!addr) return null;

    const params = new URLSearchParams({
        address: addr,
        key: process.env.GOOGLE_MAPS_API_KEY,
        region: "US", // bias United States
    });

    // Components filtering improves accuracy a lot
    const comps = [];
    comps.push("country:US");
    if (u.state) comps.push(`administrative_area:${u.state}`);
    if (u.zip) comps.push(`postal_code:${u.zip}`);
    if (comps.length) params.set("components", comps.join("|"));

    const url = `${GOOGLE_GEOCODE_URL}?${params.toString()}`;

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) return null;

    const best = data.results[0];
    const loc = best?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
        return null;
    }

    // Validate city/state against user record (if provided)
    const { city, state } = googleCityStateFromComponents(
        best.address_components || []
    );

    const wantCity = upper(u.city);
    const wantState = upper(u.state); // "NY", etc.

    const gotCity = upper(city);
    const gotState = upper(state);

    const cityOK = !wantCity || gotCity === wantCity;
    const stateOK = !wantState || gotState === wantState;

    if (!cityOK || !stateOK) {
        // If user has no city/state recorded, we won’t block on validation
        if (wantCity || wantState) return null;
    }

    return { lat: loc.lat, lng: loc.lng, source: "google" };
}

/** =====================
 *  POST handler
 *  ===================== */

export async function POST() {
    // At least one provider must be configured
    if (!process.env.MAPBOX_ACCESS_TOKEN && !process.env.GOOGLE_MAPS_API_KEY) {
        return NextResponse.json(
            { error: "No geocoder configured. Set MAPBOX_ACCESS_TOKEN or GOOGLE_MAPS_API_KEY." },
            { status: 500 }
        );
    }

    // 1) Find users missing coordinates
    const missing = await prisma.user.findMany({
        where: {
            OR: [{ lat: null }, { lng: null }],
            paused: { not: true }, // only active
        },
        select: {
            id: true,
            first: true,
            last: true,
            address: true,
            apt: true,
            city: true,
            state: true,
            zip: true,
            lat: true,
            lng: true,
        },
    });

    if (!missing.length) {
        return NextResponse.json({ updated: 0, users: [], tried: 0 });
    }

    let updated = 0;
    let tried = 0;
    const updatedUsers = [];
    const details = []; // optional: per-id source info (not used by UI, but handy for debugging)

    // 2) Geocode each missing user; Mapbox first, then Google fallback
    for (const u of missing) {
        try {
            tried++;
            let coords = null;
            let source = null;

            // Primary: Mapbox
            coords = await geocodeWithMapbox(u);
            source = coords?.source || null;

            // Fallback: Google
            if (!coords) {
                coords = await geocodeWithGoogle(u);
                source = coords?.source || source;
            }

            if (!coords) {
                details.push({ id: u.id, ok: false, reason: "no-match" });
                await sleep(SLEEP_MS);
                continue;
            }

            const saved = await prisma.user.update({
                where: { id: u.id },
                data: { lat: coords.lat, lng: coords.lng },
                select: {
                    id: true,
                    first: true,
                    last: true,
                    address: true,
                    apt: true,
                    city: true,
                    state: true,
                    zip: true,
                    lat: true,
                    lng: true,
                },
            });

            // Cascade coordinates to stops
            try {
                await prisma.stop.updateMany({
                    where: { userId: u.id },
                    data: { lat: coords.lat, lng: coords.lng },
                });
            } catch (e) {
                console.error(`Failed to cascade coords to stops for user ${u.id}:`, e);
            }

            updated++;
            updatedUsers.push(saved);
            details.push({ id: u.id, ok: true, source });
        } catch (e) {
            console.error("Geocode/save failed for user", u.id, e);
            details.push({ id: u.id, ok: false, reason: "exception" });
        }

        // pace requests
        await sleep(SLEEP_MS);
    }

    // Response shape remains compatible with your UI (plus optional metadata)
    return NextResponse.json({ updated, users: updatedUsers, tried, details });
}