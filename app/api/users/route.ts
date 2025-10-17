export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { geocodeIfNeeded } from "../../../lib/geocode";

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

const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);

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
            // Your UI reads these:
            lat: true,
            lng: true,
            // If you want to migrate slowly, you can also expose latitude/longitude:
            // latitude: true,
            // longitude: true,
            visits: true,
            schedule: {
                select: {
                    monday: true, tuesday: true, wednesday: true,
                    thursday: true, friday: true, saturday: true, sunday: true,
                },
            },
        },
    });

    return NextResponse.json(list);
}

// ---------- POST /api/users
export async function POST(req: Request) {
    const b = await req.json();
    const scheduleInput = sanitizeSchedule(b.schedule);

    // 1) Accept coords from client if provided (supports both name styles)
    let bodyLat = num(b.lat ?? b.latitude);
    let bodyLng = num(b.lng ?? b.longitude);

    // 2) If missing, geocode the address
    if (bodyLat == null || bodyLng == null) {
        const { lat, lng } = await geocodeIfNeeded({
            address: b.address, apt: b.apt, city: b.city, state: b.state, zip: b.zip,
        });
        bodyLat = num(lat);
        bodyLng = num(lng);
    }

    // 3) Create user; write to BOTH field-name styles so UI & table stay in sync
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

            // ✅ write both styles
            lat: bodyLat,
            lng: bodyLng,
            latitude: bodyLat,
            longitude: bodyLng,

            geocodedAt: bodyLat != null && bodyLng != null ? new Date() : null,
        },
        include: { schedule: true },
    });

    return NextResponse.json(created, { status: 201 });
}