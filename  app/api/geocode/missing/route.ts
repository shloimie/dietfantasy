import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Build a single-line address
function fullAddress(u: any) {
    const parts = [u.address, u.apt, u.city, u.state, u.zip].filter(Boolean);
    return parts.join(", ");
}

async function geocodeMapbox(query: string): Promise<{lat:number,lng:number}|null> {
    const token = process.env.MAPBOX_ACCESS_TOKEN;
    if (!token) throw new Error("Missing MAPBOX_ACCESS_TOKEN");
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=US&access_token=${token}&limit=1`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const feat = data?.features?.[0];
    if (!feat?.center || feat.center.length < 2) return null;
    return { lng: feat.center[0], lat: feat.center[1] };
}

export async function POST() {
    // get users that need coords
    const users = await prisma.user.findMany({
        where: { OR: [{ lat: null }, { lng: null }] },
        select: { id: true, first: true, last: true, address: true, apt: true, city: true, state: true, zip: true },
    });

    const updated: number[] = [];
    const failed: number[] = [];

    // Simple throttle to be nice to API
    for (const u of users) {
        const q = fullAddress(u);
        if (!q) { failed.push(u.id); continue; }

        try {
            const coord = await geocodeMapbox(q);
            if (coord) {
                await prisma.user.update({
                    where: { id: u.id },
                    data: { lat: coord.lat, lng: coord.lng },
                });
                updated.push(u.id);
            } else {
                failed.push(u.id);
            }
        } catch {
            failed.push(u.id);
        }

        // tiny delay ~150ms
        await new Promise(r => setTimeout(r, 150));
    }

    return NextResponse.json({ updatedCount: updated.length, failedCount: failed.length, updated, failed });
}