// app/api/route/add-stop/route.ts
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const rId = Number(body?.routeId);
        const uId = Number(body?.userId);
        const day = String(body?.day ?? "all"); // required by your Stop model

        if (!Number.isFinite(rId) || !Number.isFinite(uId)) {
            return NextResponse.json(
                { error: "Invalid routeId or userId" },
                { status: 400 }
            );
        }

        // 1) Load the route (we use its scalar list: Route.stopIds Int[])
        const route = await prisma.route.findUnique({
            where: { id: rId },
            select: { id: true, stopIds: true },
        });
        if (!route) {
            return NextResponse.json({ error: "Route not found" }, { status: 404 });
        }
        const existingIds: number[] = Array.isArray(route.stopIds)
            ? route.stopIds
            : [];

        // 2) Load the user whose info will populate the Stop (Stop has many required fields)
        const user = await prisma.user.findUnique({
            where: { id: uId },
            select: {
                id: true,
                first: true,
                last: true,
                address: true,
                apt: true,
                city: true,
                state: true,
                zip: true,
                phone: true,
                dislikes: true,
                lat: true,
                lng: true,
            },
        });
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const name = `${(user.first || "").trim()} ${(user.last || "").trim()}`.trim() || "Unnamed";

        // 3) Determine next order: look at the existing route stopIds, read their Stop.order max
        let nextOrder = 1;
        if (existingIds.length > 0) {
            const lastStop = await prisma.stop.findFirst({
                where: { id: { in: existingIds } },
                orderBy: { order: "desc" },
                select: { order: true },
            });
            nextOrder = ((lastStop?.order ?? 0) || 0) + 1;
        }

        // 4) Create the Stop row using required fields from User
        const created = await prisma.stop.create({
            data: {
                day,
                userId: user.id,
                order: nextOrder,
                name,
                address: user.address,
                apt: user.apt ?? null,
                city: user.city,
                state: user.state,
                zip: user.zip ?? "",
                phone: user.phone ?? null,
                dislikes: user.dislikes ?? null,
                lat: user.lat ?? null,
                lng: user.lng ?? null,
                // assignedDriverId: null, // leave as-is unless you want to set it here
            },
            select: {
                id: true,
                order: true,
                day: true,
                userId: true,
                name: true,
            },
        });

        // 5) Append the new stop id to Route.stopIds (use `set` with merged array for Postgres)
        const newIds = [...existingIds, created.id];
        await prisma.route.update({
            where: { id: route.id },
            data: { stopIds: newIds },
        });

        return NextResponse.json(
            { ok: true, stop: created },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (err) {
        console.error("[route/add-stop] POST error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}