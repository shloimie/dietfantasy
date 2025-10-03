// app/api/route/generate/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

const palette = ["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"];

function isUserForDay(day, schedule) {
    if (!schedule) return day === "all";
    const key = String(day).toLowerCase();
    if (key === "all") return true;
    return Boolean(schedule[key]);
}

export async function POST(req) {
    try {
        const body = await req.json();
        const day = body?.day || "all";
        const driverCount = Number(body?.driverCount || 6);

        // rebuild drivers
        await prisma.driver.deleteMany({ where: { day } });
        const drivers = [];
        for (let i = 0; i < driverCount; i++) {
            drivers.push(
                await prisma.driver.create({
                    data: { day, name: `Driver ${i + 1}`, color: palette[i % palette.length], stopIds: [] },
                })
            );
        }

        // rebuild stops from User
        await prisma.stop.deleteMany({ where: { day } });

        const users = await prisma.user.findMany({
            where: {
                paused: false,
                OR: [{ lat: { not: null } }, { latitude: { not: null } }],
                AND: [{ OR: [{ lng: { not: null } }, { longitude: { not: null } }] }],
            },
            include: { schedule: true },
        });

        const stopsToCreate = users
            .filter((u) => isUserForDay(day, u.schedule))
            .map((u) => ({
                day,
                userId: u.id,
                order: null,
                name: `${u.first ?? ""} ${u.last ?? ""}`.trim() || "Unnamed",
                address: `${u.address ?? ""}`.trim(),
                apt: u.apt ?? null,
                city: u.city ?? "",
                state: u.state ?? "",
                zip: u.zip ?? "",
                phone: u.phone ?? null,
                dislikes: u.dislikes ?? null,
                lat: (u.lat ?? u.latitude) ?? null,
                lng: (u.lng ?? u.longitude) ?? null,
                completed: false,
                proofUrl: null,
                assignedDriverId: null,
            }));

        if (stopsToCreate.length) await prisma.stop.createMany({ data: stopsToCreate });

        const stops = await prisma.stop.findMany({ where: { day }, orderBy: { id: "asc" } });

        // round-robin distribution
        if (drivers.length && stops.length) {
            const buckets = drivers.map((d) => ({ id: d.id, ids: [] }));
            let i = 0;
            for (const s of stops) {
                buckets[i].ids.push(s.id);
                i = (i + 1) % buckets.length;
            }
            for (const b of buckets) {
                await prisma.driver.update({ where: { id: b.id }, data: { stopIds: b.ids } });
                if (b.ids.length) {
                    await prisma.stop.updateMany({ where: { id: { in: b.ids } }, data: { assignedDriverId: b.id } });
                }
            }
        }

        const refreshed = await prisma.driver.findMany({ where: { day }, orderBy: { id: "asc" } });
        return NextResponse.json({ drivers: refreshed }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        console.error("generate error", e);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}