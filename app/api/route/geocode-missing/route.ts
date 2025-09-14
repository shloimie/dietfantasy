export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

/** === Tune these to your service area (lng,lat order) ===
 * Rockland/Passaic-ish example: west,south,east,north
 */
const BBOX: [number, number, number, number] = [-75.0, 40.3, -73.5, 41.6];
// Bias results around Monsey, NY (lng,lat)
const PROXIMITY: [number, number] = [-74.07, 41.11];

type DBUser = {
    id: number;
    first: string | null;
    last: string | null;
    address: string | null;
    apt: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    lat: number | null;
    lng: number | null;
};

function buildQuery(u: DBUser) {
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

function upper(s: string | null | undefined) {
    return String(s ?? "").trim().toUpperCase();
}

/** Validate the returned feature’s city/state against the user record */
function mapboxCityStateOK(feature: any, wantCity: string, wantState: string) {
    // Context can hold place (city) and region (state)
    const ctx: any[] = [
        ...(feature?.context ?? []),
        ...(feature?.properties?.context ?? []),
    ];

    // Find “place” (city-ish)
    const place =
        ctx.find((c) => typeof c.id === "string" && c.id.startsWith("place."))
            ?.text ?? feature?.place; // fallback

    // Find state short code like "US-NY"
    const regionShort =
        ctx.find((c) => typeof c.short_code === "string")?.short_code ?? "";

    const gotCity = upper(place); // e.g. "AIRMONT"
    const gotState = regionShort.toUpperCase(); // e.g. "US-NY"

    const cityOK = !wantCity || gotCity === wantCity;
    const stateOK = !wantState || gotState.endsWith(`-${wantState}`);

    return cityOK && stateOK;
}

async function geocodeWithMapbox(u: DBUser) {
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

    // Validate city/state
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
    return { lat, lng };
}

export async function POST() {
    if (!process.env.MAPBOX_ACCESS_TOKEN) {
        return NextResponse.json(
            { error: "MAPBOX_ACCESS_TOKEN missing" },
            { status: 500 }
        );
    }

    // 1) Find users missing coordinates
    const missing: DBUser[] = await prisma.user.findMany({
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
        return NextResponse.json({ updated: 0, users: [] });
    }

    let updated = 0;
    const updatedUsers: DBUser[] = [];

    // 2) Geocode each missing user, but only save when validated
    for (const u of missing) {
        try {
            const coords = await geocodeWithMapbox(u);
            if (!coords) continue;

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

            updated++;
            // @ts-ignore
            updatedUsers.push(saved);
        } catch (e) {
            // skip any single failure; continue with others
            console.error("Geocode/save failed for user", u.id, e);
        }
    }

    return NextResponse.json({ updated, users: updatedUsers });
}