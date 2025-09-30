// app/api/route/add-stop/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
    const { routeId, stop } = await req.json();

    if (!routeId || !stop) {
        return NextResponse.json({ error: "Missing routeId or stop" }, { status: 400 });
    }

    // Find current max order in that route
    const lastStop = await prisma.stop.findFirst({
        where: { routeId },
        orderBy: { order: "desc" },
    });
    const nextOrder = (lastStop?.order || 0) + 1;

    const created = await prisma.stop.create({
        data: {
            routeId,
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

    return NextResponse.json(created);
}