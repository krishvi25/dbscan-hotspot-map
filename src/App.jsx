import { useEffect, useState, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polygon,
  Polyline,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import Papa from "papaparse";
import * as turf from "@turf/turf";
import { dbscan } from "./dbscan";
import "leaflet/dist/leaflet.css";
import "./leafletFix";

/* ---------------- ICON ---------------- */

function pinIcon(color) {
  return L.divIcon({
    html: `<div style="
      background:${color};
      width:14px;
      height:14px;
      border-radius:50% 50% 50% 0;
      transform: rotate(-45deg);
      border:2px solid white;
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 14],
  });
}

/* ---------------- MAP CLICK ---------------- */

function MapClickHandler({ onSelect, enabled }) {
  useMapEvents({
    click(e) {
      if (enabled) onSelect([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

/* ---------------- APP ---------------- */

export default function App() {
  const [points, setPoints] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [destination, setDestination] = useState(null);
  const [routeOptions, setRouteOptions] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [journeyStarted, setJourneyStarted] = useState(false);
  const [zoneAlert, setZoneAlert] = useState(null);
  const [startName, setStartName] = useState("");
  const [destName, setDestName] = useState("");

  // ✅ NEW SPEED STATES
  const [speed, setSpeed] = useState(0);
  const lastAlertRef = useRef(null);

  const eps = 80 / 111000;
  const minPts = 3;

  function clusterColor(size) {
    if (size >= 6) return "red";
    if (size >= 4) return "orange";
    return "green";
  }

  // ✅ Speed limits per zone
  function getSpeedLimit(color) {
    if (color === "red") return 30;
    if (color === "orange") return 45;
    return 60;
  }

  /* ---------------- VOICE ---------------- */

  function speak(text) {
    if (!window.speechSynthesis) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    if (zoneAlert) speak(zoneAlert);
  }, [zoneAlert]);

  /* ---------------- LOAD CSV ---------------- */

  useEffect(() => {
    Papa.parse("/locations.csv", {
      download: true,
      header: true,
      complete: (res) => {
        const clean = res.data
          .map((r) => ({
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lng),
          }))
          .filter((p) => !isNaN(p.lat) && !isNaN(p.lng));

        setPoints(clean);
      },
    });
  }, []);

  const clustered = dbscan(points, eps, minPts);
  const clusters = {};

  clustered.forEach((p) => {
    if (p.cluster !== -1) {
      clusters[p.cluster] ??= [];
      clusters[p.cluster].push(p);
    }
  });

  /* ---------------- REVERSE GEOCODING ---------------- */

  async function getPlaceName(lat, lng, setter) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
    );
    const data = await res.json();
    setter(data.display_name || "Unknown location");
  }

  function getMyLocation() {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setUserLocation([lat, lng]);
      await getPlaceName(lat, lng, setStartName);
    });
  }

  /* ---------------- ROUTES ---------------- */

  async function showRoutes() {
    if (!userLocation || !destination) return;

    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${userLocation[1]},${userLocation[0]};${destination[1]},${destination[0]}?overview=full&geometries=geojson&alternatives=true`
    );

    const data = await res.json();

    const processed = data.routes.map((r, index) => {
      const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const distance = (r.distance / 1000).toFixed(1);
      const duration = Math.round(r.duration / 60);

      let riskScore = 0;

      Object.values(clusters).forEach((pts) => {
        const hull = turf.convex(
          turf.featureCollection(
            pts.map((p) => turf.point([p.lng, p.lat]))
          )
        );
        if (!hull) return;

        const routeLine = turf.lineString(r.geometry.coordinates);

        if (turf.booleanIntersects(routeLine, hull)) {
          riskScore += pts.length;
        }
      });

      let riskLevel = "Low";
      if (riskScore > 10) riskLevel = "High";
      else if (riskScore > 5) riskLevel = "Medium";

      return { id: index, coords, distance, duration, riskScore, riskLevel };
    });

    processed.sort((a, b) => a.riskScore - b.riskScore);

    setRouteOptions(processed);
    setSelectedRoute(processed[0]);
  }

  /* ---------------- START JOURNEY ---------------- */

  function startJourney() {
    if (!selectedRoute) return;

    setJourneyStarted(true);

    navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLocation([lat, lng]);

        // ✅ Speed detection
        const speedKmh = pos.coords.speed
          ? pos.coords.speed * 3.6
          : 0;

        setSpeed(speedKmh);

        let triggered = false;

        Object.values(clusters).forEach((pts) => {
          const hull = turf.convex(
            turf.featureCollection(
              pts.map((p) => turf.point([p.lng, p.lat]))
            )
          );
          if (!hull) return;

          const userPoint = turf.point([lng, lat]);

          if (turf.booleanPointInPolygon(userPoint, hull)) {
            const color = clusterColor(pts.length);
            const limit = getSpeedLimit(color);

            if (speedKmh > limit) {
              if (lastAlertRef.current !== "overspeed-" + color) {
                setZoneAlert(
                  `⚠️ Overspeed in ${color.toUpperCase()} zone! Limit ${limit} km/h`
                );
                lastAlertRef.current = "overspeed-" + color;
              }
            } else {
              if (lastAlertRef.current !== "inside-" + color) {
                setZoneAlert(
                  `${color.toUpperCase()} zone. Maintain below ${limit} km/h`
                );
                lastAlertRef.current = "inside-" + color;
              }
            }

            triggered = true;
          }
        });

        if (!triggered) {
          setZoneAlert("🟢 Safe Zone");
          lastAlertRef.current = "safe";
        }
      },
      () => {},
      { enableHighAccuracy: true }
    );
  }

  return (
    <div style={{ height: "100vh", width: "100%" }}>

      {/* ✅ Speed Display */}
      {journeyStarted && (
        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            background: "black",
            color: "white",
            padding: "10px 15px",
            borderRadius: 10,
            zIndex: 1000,
            fontWeight: "bold"
          }}
        >
          🚗 {speed.toFixed(1)} km/h
        </div>
      )}

      {zoneAlert && (
        <div className="alert-toast">
          {zoneAlert}
        </div>
      )}

      <div className="glass-panel">
        <h2>🚘 Smart Navigator</h2>

        {!userLocation && (
          <button className="nav-btn" onClick={getMyLocation}>
            📍 Get My Location
          </button>
        )}

        {startName && (
          <div className="location-card">
            <strong>Start</strong>
            <p>{startName}</p>
          </div>
        )}

        {destination && (
          <div className="location-card">
            <strong>Destination</strong>
            <p>{destName}</p>
          </div>
        )}

        {userLocation && destination && routeOptions.length === 0 && (
          <button className="nav-btn primary" onClick={showRoutes}>
            🗺 Show Routes
          </button>
        )}

        {routeOptions.length > 0 && (
          <div style={{ marginTop: 15 }}>
            <h3>Select Route</h3>
            {routeOptions.map((r) => (
              <div
                key={r.id}
                onClick={() => setSelectedRoute(r)}
                className={
                  selectedRoute?.id === r.id
                    ? "route-card selected"
                    : "route-card"
                }
              >
                <strong>Route {r.id + 1}</strong>
                <div>
                  {r.distance} km | {r.duration} min | {r.riskLevel} Risk
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedRoute && !journeyStarted && (
          <button className="nav-btn success" onClick={startJourney}>
            🚀 Start Journey
          </button>
        )}
      </div>

      <MapContainer
        center={[15.55257, 73.75494]}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <MapClickHandler
          enabled={!!userLocation}
          onSelect={async (coords) => {
            setDestination(coords);
            await getPlaceName(coords[0], coords[1], setDestName);
          }}
        />

        {userLocation && (
          <Marker position={userLocation} icon={pinIcon("blue")} />
        )}

        {destination && (
          <Marker position={destination} icon={pinIcon("green")} />
        )}

        {Object.entries(clusters).map(([id, pts]) => {
          const hull = turf.convex(
            turf.featureCollection(
              pts.map((p) => turf.point([p.lng, p.lat]))
            )
          );
          if (!hull) return null;

          const coords = hull.geometry.coordinates[0].map(
            ([lng, lat]) => [lat, lng]
          );

          const color = clusterColor(pts.length);

          return (
            <Polygon
              key={id}
              positions={coords}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.3,
              }}
            />
          );
        })}

        {routeOptions.map((r) => (
          <Polyline
            key={r.id}
            positions={r.coords}
            color={selectedRoute?.id === r.id ? "#00c6ff" : "#999"}
            weight={selectedRoute?.id === r.id ? 6 : 3}
          />
        ))}
      </MapContainer>
    </div>
  );
}
  