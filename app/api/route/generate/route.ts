// app/api/route/generate/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { planRoutesBalancedByMiles } from "../../../../utils/routing";

const prisma = new PrismaClient();

type Body = { day?: string; driverCount?: number };

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    return days.includes(s) ? s : "all";
}

export async function POST(req: Request) {
    const { day = "all", driverCount = 6 } = (await req.json() as Body) || {};
    const d = normalizeDay(day);

    // load users
    const users = await prisma.user.findMany({ include: { schedule: true } });
    const candidates = users
        .filter(u => !u.paused)
        .filter(u => {
            const lat = u.lat ?? u.latitude;
            const lng = u.lng ?? u.longitude;
            return lat != null && lng != null;
        })
        .filter(u => {
            if (d === "all") return true;
            const s = (u as any).schedule || {};
            return Boolean(s[d]);
        })
        .map(u => ({
            id: u.id,
            lat: Number(u.lat ?? u.latitude),
            lng: Number(u.lng ?? u.longitude),
            name: `${u.first ?? ""} ${u.last ?? ""}`.trim(),
            address: `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
            city: u.city ?? "",
            state: u.state ?? "",
            zip: u.zip ?? "",
            phone: u.phone ?? "",
            dislikes: u.dislikes ?? "",
        }));

    const routes = planRoutesBalancedByMiles(candidates, driverCount);

    // wipe old
    await prisma.stop.deleteMany({ where: { route: { day: d } } });
    await prisma.driverRoute.deleteMany({ where: { day: d } });

    // create new
    const createdRoutes = [];
    for (let i = 0; i < routes.length; i++) {
        const stopsData = routes[i].map((u, idx) => ({
            order: idx + 1,
            name: u.name,
            address: u.address,
            city: u.city,
            state: u.state,
            zip: u.zip,
            phone: u.phone,
            dislikes: u.dislikes,
            // keep lat/lng in Stop if you want map view
            lat: u.lat,
            lng: u.lng,
        }));

        const routeRow = await prisma.driverRoute.create({
            data: {
                day: d,
                driverNumber: i + 1,
                stops: { create: stopsData },
            },
            include: { stops: true },
        });

        createdRoutes.push(routeRow);
    }

    // return right away
    return NextResponse.json({ day: d, routes: createdRoutes });
}