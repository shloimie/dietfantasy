import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Configurable date constant
const ORDER_DATE = "2026-01-12";

export async function GET() {
    try {
        // Fetch all users that are billing (bill === true)
        const users = await prisma.user.findMany({
            where: {
                bill: true,
            },
            select: {
                id: true,
                first: true,
                last: true,
                caseId: true,
                clientId: true,
            },
            orderBy: {
                last: "asc",
            }
        });

        const orders = users.map((user) => {
            // Construct URL: https://app.uniteus.io/dashboard/cases/open/{caseID}/contact/{clientID}
            const caseId = user.caseId || "";
            const clientId = user.clientId || "";
            const url = `https://app.uniteus.io/dashboard/cases/open/${caseId}/contact/${clientId}`;

            return {
                name: `${user.first} ${user.last}`.trim(),
                "client#": user.id, // Using the internal auto-increment ID
                url: url,
                date: ORDER_DATE,
                amount: null,
                proofURL: null,
                dependants: [],
            };
        });

        return NextResponse.json(orders);
    } catch (error) {
        console.error("Error in /api/billing:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
