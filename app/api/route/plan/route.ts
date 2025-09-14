export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";


// super simple k-means-ish bucketing by lat/lng means, with balancing
function planBalanced(routesCount: number, points: any[]) {
    if (routesCount < 1) return { routes: [], unassigned: points };

    // seed: pick evenly spaced points as initial centers
    const step = Math.max(1, Math.floor(points.length / routesCount));
    const centers = [];
    for (let i = 0; i < routesCount; i++) {
        centers.push(points[Math.min(i * step, points.length - 1)]);
    }

    // iterate a few times
    for (let iter = 0; iter < 6; iter++) {
        const clusters: any[] = Array.from({ length: routesCount }, () => []);
        // assign to nearest center
        for (const p of points) {
            let best = 0, bestD = Infinity;
            for (let c = 0; c < centers.length; c++) {
                const dx = (p.lat - centers[c].lat);
                const dy = (p.lng - centers[c].lng);
                const d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; best = c; }
            }
            clusters[best].push(p);
        }
        // recompute centers
        for (let c = 0; c < clusters.length; c++) {
            const arr = clusters[c];
            if (!arr.length) continue;
            const lat = arr.reduce((s, v) => s + v.lat, 0) / arr.length;
            const lng = arr.reduce((s, v) => s + v.lng, 0) / arr.length;
            centers[c] = { ...centers[c], lat, lng };
        }
    }

    return { routes: centers.map(() => [] as any[]), centers, clusters: undefined };
}

export async function POST(req: Request) {
    try {
        const b = await req.json().catch(() => ({}));
        const driverCount = Math.max(1, Number(b.drivers || 1));
        const day = String(b.day || "all").toLowerCase();

        // Filter active + day
        const raw = await prisma.user.findMany({
            where: { paused: false },
            select: {
                id: true, first: true, last: true, address: true, apt: true, city: true, state: true, zip: true,
                lat: true, lng: true, schedule: true
            }
        });

        const isDay = (u: any) => day === "all" ? true : Boolean(u?.schedule?.[day]);
        const candidates = raw.filter(u => isDay(u));

        const withGeo = candidates.filter(u => typeof u.lat === "number" && typeof u.lng === "number");
        const unassigned = candidates.filter(u => !(typeof u.lat === "number" && typeof u.lng === "number"));

        if (!withGeo.length) {
            return NextResponse.json({ routes: [], unassigned });
        }

        // super simple bucketing: sort by longitude and split evenly
        const sorted = [...withGeo].sort((a, b) => (a.lng - b.lng));
        const per = Math.ceil(sorted.length / driverCount);
        const routes = Array.from({ length: driverCount }, (_, i) =>
            sorted.slice(i * per, i * per + per)
        );

        return NextResponse.json({ routes, unassigned });
    } catch (e: any) {
        console.error("route/plan error:", e);
        return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
    }
}

