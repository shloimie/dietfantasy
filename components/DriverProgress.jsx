"use client";

import { countWithLocal } from "@/lib/localProgress";
import { MapPin } from "lucide-react";

export default function DriverProgress({ driverId, stops }) {
    const { total, completed, pct } = countWithLocal(driverId, stops ?? []);

    return (
        <>
            <div className="flex muted" style={{ marginTop: 12 }}>
                <MapPin style={{ height: 16, width: 16 }} />
                <span>
          {completed} / {total} stops
        </span>
            </div>
            <div className="progress" style={{ marginTop: 10 }}>
                <span style={{ width: `${pct}%` }} />
            </div>
        </>
    );
}