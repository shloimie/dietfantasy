import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// deterministic palette fallback if no color set on the route
const PALETTE = [
    "#3665F3","#E63946","#06A77D","#FF8C00","#8E44AD",
    "#2E86AB","#E67E22","#16A085","#C0392B","#F39C12"
];

export async function GET() {
    // Get all routes (you can add ?day=... filter later if needed)
    const routes = await prisma.driverRoute.findMany({
        orderBy: { driverNumber: "asc" },
        include: { stops: { select: { id: true }, orderBy: { order: "asc" } } },
    });

    const data = routes.map((r) => ({
        id: String(r.id),
        name: `Driver ${r.driverNumber}`,          // you can swap to a real driver name later
        routeNumber: r.driverNumber,
        color: r.color ?? PALETTE[(r.driverNumber - 1) % PALETTE.length],
        stopIds: r.stops.map((s) => String(s.id)),
    }));

    return NextResponse.json(data);
}