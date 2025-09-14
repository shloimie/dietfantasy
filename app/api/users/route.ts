export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { geocodeIfNeeded } from "../../../lib/geocode";

// keep all 7 keys, default true
function sanitizeSchedule(input: any) {
    const s = input ?? {};
    return {
        monday:    s.monday    ?? true,
        tuesday:   s.tuesday   ?? true,
        wednesday: s.wednesday ?? true,
        thursday:  s.thursday  ?? true,
        friday:    s.friday    ?? true,
        saturday:  s.saturday  ?? true,
        sunday:    s.sunday    ?? true,
    };
}

// ---------- GET /api/users
export async function GET() {
    const list = await prisma.user.findMany({
        orderBy: [{ city: "asc" }, { last: "asc" }],
        select: {
            id: true,
            first: true,
            last: true,
            address: true,
            apt: true,
            city: true,
            dislikes: true,
            county: true,
            zip: true,
            state: true,
            phone: true,
            medicaid: true,
            paused: true,
            complex: true,
            lat: true,          // <- make sure these are included
            lng: true,          // <-
            schedule: true,
        },
    });

    return NextResponse.json(list);
}

// ---------- POST /api/users
export async function POST(req: Request) {
    const b = await req.json();
    const scheduleInput = sanitizeSchedule(b.schedule);

    const { lat, lng } = await geocodeIfNeeded({
        address: b.address, apt: b.apt, city: b.city, state: b.state, zip: b.zip
    });

    const created = await prisma.user.create({
        data: {
            first: b.first,
            last: b.last,
            address: b.address,
            apt: b.apt ?? null,
            city: b.city,
            dislikes: b.dislikes ?? null,
            county: b.county ?? null,
            zip: b.zip ?? null,
            state: b.state,
            phone: b.phone,
            medicaid: !!b.medicaid,
            paused: !!b.paused,
            complex: !!b.complex,
            schedule: { create: scheduleInput },
            latitude: lat,
            longitude: lng,
            geocodedAt: lat != null && lng != null ? new Date() : null,
        },
        include: { schedule: true },
    });

    return NextResponse.json(created, { status: 201 });
}