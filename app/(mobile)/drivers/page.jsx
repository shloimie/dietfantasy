import Link from "next/link";
import { fetchDrivers, fetchStops } from "../../../lib/api";
import { Truck } from "lucide-react";
import SearchStops from "../../../components/SearchStops";
import DriversGrid from "./DriversGrid";

/** Always dynamic — no caching/ISR */
export const dynamic = "force-dynamic";

export const metadata = { title: "Delivery Routes" };

export default async function DriversHome() {
    let drivers = [];
    let allStops = [];
    try {
        drivers = await fetchDrivers();
        allStops = await fetchStops();
    } catch {
        return (
            <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", textAlign: "center" }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Connection Error</h1>
                    <p style={{ marginTop: 8, color: "#6b7280" }}>Failed to load routes.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <div className="card">
                <div className="card-content">
                    <header className="hdr">
                        <div className="hdr-badge"><Truck /></div>
                        <div>
                            <h1 className="h1">Delivery Routes</h1>
                            <p className="sub">Select your route to begin deliveries</p>
                        </div>
                    </header>

                    <div className="search-wrap">
                        <SearchStops allStops={allStops} drivers={drivers} themeColor="#3665F3" />
                    </div>

                    {/* Renders the route cards + signature bars */}
                    <DriversGrid drivers={drivers} allStops={allStops} />
                </div>
            </div>

            <style
                dangerouslySetInnerHTML={{
                    __html: `
:root{
  --bg:#eef2f7; --border:#e5e7eb; --muted:#6b7280; --radius:14px;
  --shadow:0 8px 22px rgba(16,24,40,.06), 0 2px 8px rgba(16,24,40,.04);
  --sigbar:#0ea5e9;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:#111;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial}
.container{max-width:900px;margin:32px auto;padding:0 20px}
.card{position:relative;border:1px solid var(--border);background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
.card-content{padding:18px 20px}
.color-rail{position:absolute;left:0;top:0;bottom:0;width:6px;border-top-left-radius:var(--radius);border-bottom-left-radius:var(--radius)}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.flex{display:flex;align-items:center;gap:8px}
.grid{display:grid;gap:20px}
.h1{font-size:28px;font-weight:800;margin:0}
.sub{margin:.25rem 0 0;color:var(--muted)}
.bold{font-weight:800}
.muted{color:var(--muted)}
.hdr{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.hdr-badge{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#e7eefc;color:#2748d8;
  box-shadow:inset 0 0 0 1px rgba(39,72,216,.12)}
.progress{width:100%;height:10px;border-radius:999px;background:#f1f5f9;overflow:hidden}
.progress>span{display:block;height:100%;border-radius:999px;transition:width .25s ease}
.progress.sig{height:8px;background:#eef6fb}
.progress.sig>span{background:var(--sigbar)}
.search-wrap{margin-bottom:16px}
        `,
                }}
            />
        </div>
    );
}