"use client";

import {useMemo} from "react";
import {MapContainer, TileLayer, Marker, Popup, Polygon} from "react-leaflet";
import MarkerClusterGroup from "@changey/react-leaflet-markercluster";
import L from "leaflet";

/** Fix default marker icons in Leaflet (Vite/Turbopack bundlers) */
const iconUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
const iconRetinaUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png";
const shadowUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";
const defaultIcon = new L.Icon({ iconUrl, iconRetinaUrl, shadowUrl, iconSize: [25,41], iconAnchor: [12,41] });
L.Marker.prototype.options.icon = defaultIcon;

/**
 * props:
 *  - drivers: Array<{ id: string; name: string; color: string; polygon?: [number,number][], stops: Stop[] }>
 *  - unrouted: Stop[]
 *  - onMarkerClick?: (stop: Stop) => void
 *  - initialCenter?: [number, number]
 *  - initialZoom?: number
 *
 * Stop = { id, userId, name, address, phone?, lat, lng, city? }
 */
export default function DriversMapLeaflet({
                                              drivers = [],
                                              unrouted = [],
                                              onMarkerClick,
                                              initialCenter = [40.7128,-74.0060], // NYC default
                                              initialZoom = 10,
                                          }) {

    // Compute bounds to fit all points & polygons
    const bounds = useMemo(() => {
        const pts = [];
        for (const d of drivers) {
            (d.stops || []).forEach(s => { if (isFinite(s.lat) && isFinite(s.lng)) pts.push([s.lat, s.lng]); });
            (d.polygon || []).forEach(p => { if (p && isFinite(p[0]) && isFinite(p[1])) pts.push(p); });
        }
        (unrouted || []).forEach(s => { if (isFinite(s.lat) && isFinite(s.lng)) pts.push([s.lat, s.lng]); });
        if (pts.length) return L.latLngBounds(pts.map(([a,b]) => L.latLng(a,b)));
        return null;
    }, [drivers, unrouted]);

    return (
        <div style={{height: "70vh", width: "100%", borderRadius: 12, overflow: "hidden"}}>
            <MapContainer
                center={initialCenter}
                zoom={initialZoom}
                style={{height: "100%", width: "100%"}}
                bounds={bounds ?? undefined}
                scrollWheelZoom
            >
                <TileLayer
                    // Free OSM tiles; swap to a paid provider if you need uptime SLAs
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap contributors"
                />

                {/* Driver territories as polygons */}
                {drivers.map(d => (
                    d.polygon?.length ? (
                        <Polygon
                            key={`poly-${d.id}`}
                            positions={d.polygon}
                            pathOptions={{ color: d.color, weight: 2, fillOpacity: 0.08 }}
                        />
                    ) : null
                ))}

                {/* Clustered markers for all stops */}
                <MarkerClusterGroup chunkedLoading>
                    {drivers.flatMap(d =>
                        (d.stops || []).filter(s => isFinite(s.lat) && isFinite(s.lng)).map(s => (
                            <Marker
                                key={`stop-${s.id || `${s.lat}-${s.lng}`}`}
                                position={[s.lat, s.lng]}
                                eventHandlers={{
                                    click: () => onMarkerClick?.(s),
                                }}
                            >
                                <Popup>
                                    <div style={{minWidth: 220}}>
                                        <div style={{fontWeight: 600}}>{s.name || "Unnamed"}</div>
                                        <div>{s.address}</div>
                                        {s.phone ? <div>{s.phone}</div> : null}
                                        {d?.name ? <div style={{marginTop: 6, fontSize: 12}}>Driver: {d.name}</div> : null}
                                    </div>
                                </Popup>
                            </Marker>
                        ))
                    )}

                    {/* Optional: show unrouted in gray */}
                    {unrouted.filter(s => isFinite(s.lat) && isFinite(s.lng)).map(s => (
                        <Marker
                            key={`unrouted-${s.id || `${s.lat}-${s.lng}`}`}
                            position={[s.lat, s.lng]}
                            eventHandlers={{ click: () => onMarkerClick?.(s) }}
                        >
                            <Popup>
                                <div style={{minWidth: 220}}>
                                    <div style={{fontWeight: 600}}>{s.name || "Unnamed"}</div>
                                    <div>{s.address}</div>
                                    <div style={{marginTop: 6, fontSize: 12, opacity: 0.7}}>Unrouted</div>
                                </div>
                            </Popup>
                        </Marker>
                    ))}
                </MarkerClusterGroup>
            </MapContainer>
        </div>
    );
}