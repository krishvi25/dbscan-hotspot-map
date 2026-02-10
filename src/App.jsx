import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
} from "react-leaflet";
import L from "leaflet";
import Papa from "papaparse";
import * as turf from "@turf/turf";
import { dbscan } from "./dbscan";
import "leaflet/dist/leaflet.css";
import "./leafletFix";

/* ---------- HELPERS ---------- */

function pinIcon(color, small = false) {
  return L.divIcon({
    html: `<div style="
      background:${color};
      width:${small ? 8 : 12}px;
      height:${small ? 8 : 12}px;
      border-radius:50% 50% 50% 0;
      transform: rotate(-45deg);
      border:2px solid white;
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 12],
  });
}

function buildHull(points) {
  if (points.length < 3) return null;

  const turfPoints = turf.featureCollection(
    points.map((p) => turf.point([p.lng, p.lat]))
  );

  const hull = turf.convex(turfPoints);
  return hull
    ? hull.geometry.coordinates[0].map(([lng, lat]) => [lat, lng])
    : null;
}

/* ---------- APP ---------- */

export default function App() {
  const [points, setPoints] = useState([]);

  // DBSCAN inputs
  const [epsMeters, setEpsMeters] = useState(250);
  const [minPts, setMinPts] = useState(4);

  // 🔴🟠 COLOR inputs (NEW)
  const [redMin, setRedMin] = useState(6);
  const [orangeMin, setOrangeMin] = useState(4);

  // Applied
  const [applied, setApplied] = useState({
    epsMeters: 250,
    minPts: 4,
    redMin: 6,
    orangeMin: 4,
  });

  const eps = applied.epsMeters / 111000;

  function clusterColor(size) {
    if (size >= applied.redMin) return "red";
    if (size >= applied.orangeMin) return "orange";
    return "green";
  }

  useEffect(() => {
    Papa.parse("/locations.csv", {
      download: true,
      header: true,
      complete: (res) => {
        const clean = res.data
          .filter((r) => r.lat && r.lng)
          .map((r) => ({ lat: +r.lat, lng: +r.lng }));
        setPoints(clean);
      },
    });
  }, []);

  const clustered = dbscan(points, eps, applied.minPts);

  const clusters = {};
  const noise = [];

  clustered.forEach((p) => {
    if (p.cluster === -1) noise.push(p);
    else {
      clusters[p.cluster] ??= [];
      clusters[p.cluster].push(p);
    }
  });

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* SIDE PANEL */}
      <div
        style={{
          width: "360px",
          padding: "16px",
          background: "#f8f9fa",
          borderRight: "1px solid #ddd",
          overflowY: "auto",
          fontFamily: "Arial",
        }}
      >
        <h3>Hotspot Controls</h3>

        <label><b>Epsilon (meters)</b></label>
        <input
          type="number"
          value={epsMeters}
          onChange={(e) => setEpsMeters(+e.target.value)}
          style={{ width: "100%", padding: "6px" }}
        />

        <label style={{ marginTop: "10px", display: "block" }}>
          <b>Minimum Points</b>
        </label>
        <input
          type="number"
          value={minPts}
          onChange={(e) => setMinPts(+e.target.value)}
          style={{ width: "100%", padding: "6px" }}
        />

        {/* 🔴🟠 COLOR OPTIONS (ADDED HERE ONLY) */}
        <label style={{ marginTop: "10px", display: "block" }}>
          <b>Red ≥ Points</b>
        </label>
        <input
          type="number"
          value={redMin}
          onChange={(e) => setRedMin(+e.target.value)}
          style={{ width: "100%", padding: "6px" }}
        />

        <label style={{ marginTop: "10px", display: "block" }}>
          <b>Orange ≥ Points</b>
        </label>
        <input
          type="number"
          value={orangeMin}
          onChange={(e) => setOrangeMin(+e.target.value)}
          style={{ width: "100%", padding: "6px" }}
        />

        <button
          onClick={() =>
            setApplied({
              epsMeters,
              minPts,
              redMin,
              orangeMin,
            })
          }
          style={{
            marginTop: "12px",
            width: "100%",
            padding: "10px",
            background: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
          }}
        >
          Update Map
        </button>

        <hr />

        <h4>Clusters</h4>
        {Object.entries(clusters).map(([id, pts]) => (
          <div
            key={id}
            style={{
              marginBottom: "12px",
              padding: "8px",
              background: "white",
              borderLeft: `6px solid ${clusterColor(pts.length)}`,
              fontSize: "13px",
            }}
          >
            <b>Cluster {id}</b> ({pts.length} points)
          </div>
        ))}
      </div>

      {/* MAP */}
      <MapContainer
        center={[15.55257, 73.75494]}
        zoom={13}
        style={{ flex: 1 }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {Object.entries(clusters).map(([id, pts]) => {
          const hull = buildHull(pts);
          if (!hull) return null;

          const color = clusterColor(pts.length);

          return (
            <Polygon
              key={id}
              positions={hull}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.3,
              }}
            />
          );
        })}

        {clustered.map((p, i) => {
          const isNoise = p.cluster === -1;
          const color = isNoise
            ? "black"
            : clusterColor(clusters[p.cluster].length);

          return (
            <Marker
              key={i}
              position={[p.lat, p.lng]}
              icon={pinIcon(color, isNoise)}
            >
              <Popup>
                {isNoise ? "Noise Point" : `Cluster ${p.cluster}`}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
