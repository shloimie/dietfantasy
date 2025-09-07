export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";


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

export async function GET() {
    const list = await prisma.user.findMany({
        orderBy: [{ city: "asc" }, { last: "asc" }],
        include: { schedule: true },
    });
    return NextResponse.json(list);
}

export async function POST(req: Request) {
    const b = await req.json();
    const scheduleInput = sanitizeSchedule(b.schedule);

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
            schedule: { create: scheduleInput }, // no id/userId here either
        },
        include: { schedule: true },
    });

    return NextResponse.json(created, { status: 201 });
}