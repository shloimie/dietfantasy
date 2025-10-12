import Link from "next/link";
import { ChevronRight, Hash, MapPin, User } from "lucide-react";

export default function DriverLink({ driver, stops }) {
  const total = stops.length;
  const done = stops.filter(s => s.completed).length;
  const pct = total ? (done / total) * 100 : 0;

  return (
      <Link
          href={`/drivers/${driver.id}`}
          className="card theme"
          style={{ "--brand": driver.color, textDecoration:"none", color:"inherit", display:"block" }}
      >
        <div className="card-content">
          <div className="row">
            <div className="flex">
              <div className="hdr-badge"><User /></div>
              <div>
                <div className="flex"><h2 className="bold" style={{fontSize:18}}>{driver.name}</h2><ChevronRight className="muted" /></div>
                <div className="flex muted"><Hash style={{width:16,height:16}} /><span>Route {driver.routeNumber}</span></div>
              </div>
            </div>
          </div>

          <div className="flex muted" style={{ marginTop: 10 }}>
            <MapPin style={{ width: 16, height: 16 }} />
            <span>{done} / {total} stops</span>
          </div>

          <div className="progress" style={{ marginTop: 10 }}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Link>
  );
}