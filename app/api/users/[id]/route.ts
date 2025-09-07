import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

// Remove id/userId and coerce to booleans; allow partial updates of days
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

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
    const { params } = await context;              // ✅ await params
    const id = Number(params.id);

    const b = await req.json();
    const scheduleInput = sanitizeSchedule(b.schedule);

    const updated = await prisma.user.update({
        where: { id },
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
            medicaid: Boolean(b.medicaid),
            paused: Boolean(b.paused),
            complex: Boolean(b.complex),
            // ✅ Nested upsert; DO NOT include id/userId
            ...(scheduleInput && {
                schedule: {
                    upsert: {
                        create: {
                            monday: true, tuesday: true, wednesday: true, thursday: true,
                            friday: true, saturday: true, sunday: true,
                            ...scheduleInput,
                        },
                        update: { ...scheduleInput },
                    },
                },
            }),
        },
        include: { schedule: true },
    });

    return NextResponse.json(updated);
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
    const { params } = await context;              // ✅ await params
    const id = Number(params.id);
    const deleted = await prisma.user.delete({ where: { id } });
    return NextResponse.json(deleted);
}