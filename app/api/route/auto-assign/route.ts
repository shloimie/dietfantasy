// app/api/route/auto-assign/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// haversine distance in miles
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 3958.7613;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function centroid(stops: { lat: number; lng: number }[]) {
    if (!stops.length) return { lat: 0, lng: 0 };
    let lat = 0, lng = 0;
    for (const s of stops) {
        lat += s.lat;
        lng += s.lng;
    }
    return { lat: lat / stops.length, lng: lng / stops.length };
}

export async function POST(req: Request) {
    const { day = "all", newStops = [] } = await req.json();

    if (!Array.isArray(newStops) || !newStops.length) {
        return NextResponse.json({ error: "No new stops provided" }, { status: 400 });
    }

    // load current routes for this day
    const routes = await prisma.driverRoute.findMany({
        where: { day },
        include: { stops: true },
    });

    if (!routes.length) {
        return NextResponse.json({ error: "No existing routes to add into" }, { status: 400 });
    }

    const added: any[] = [];

    for (const stop of newStops) {
        // pick route by centroid closeness
        let bestRoute = routes[0];
        let bestDist = Infinity;

        for (const r of routes) {
            const points = r.stops.map(s => ({
                lat: Number((s as any).lat ?? 0),
                lng: Number((s as any).lng ?? 0),
            })).filter(p => p.lat && p.lng);

            if (!points.length) continue;
            const ctr = centroid(points);
            const d = haversineMiles(
                ctr.lat, ctr.lng,
                Number(stop.lat), Number(stop.lng)
            );
            if (d < bestDist) {
                bestDist = d;
                bestRoute = r;
            }
        }

        // find next order
        const lastStop = await prisma.stop.findFirst({
            where: { routeId: bestRoute.id },
            orderBy: { order: "desc" },
        });
        const nextOrder = (lastStop?.order || 0) + 1;

        const created = await prisma.stop.create({
            data: {
                routeId: bestRoute.id,
                order: nextOrder,
                name: stop.name,
                address: stop.address,
                city: stop.city,
                state: stop.state,
                zip: stop.zip,
                phone: stop.phone,
                dislikes: stop.dislikes,
            },
        });

        added.push({ routeId: bestRoute.id, stop: created });
    }

    return NextResponse.json({ added });
}