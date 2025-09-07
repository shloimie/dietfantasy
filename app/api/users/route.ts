import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";

function sanitizeSchedule(input: any) {
    if (!input || typeof input !== "object") return undefined;
    const { id, userId, ...rest } = input;
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    const out: Record<string, boolean> = {};
    for (const d of days) {
        if (d in rest) out[d] = Boolean(rest[d]);
    }
    return out;
}

export async function GET() {
    const users = await prisma.user.findMany({
        include: { schedule: true },
        orderBy: [{ city: "asc" }, { last: "asc" }],
    });
    return NextResponse.json(users);
}

export async function POST(req: Request) {
    const b = await req.json();

    const defaultSchedule = {
        monday: true, tuesday: true, wednesday: true, thursday: true,
        friday: true, saturday: true, sunday: true,
    };

    const scheduleInput = sanitizeSchedule(b.schedule);

    const user = await prisma.user.create({
        data: {
            first: b.first ?? "",
            last: b.last ?? "",
            address: b.address ?? "",
            apt: b.apt ?? null,
            city: b.city ?? "",
            dislikes: b.dislikes ?? null,
            county: b.county ?? null,
            zip: b.zip ?? null,
            state: b.state ?? "",
            phone: b.phone ?? "",
            medicaid: Boolean(b.medicaid),
            paused: Boolean(b.paused),
            complex: Boolean(b.complex),
            // ✅ Nested create; DO NOT include id/userId
            schedule: {
                create: {
                    ...defaultSchedule,
                    ...(scheduleInput || {}),
                },
            },
        },
        include: { schedule: true },
    });

    return NextResponse.json(user, { status: 201 });
}