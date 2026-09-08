"use client";

import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NetworkDirectory,
  PublicRoomMessage,
  RoomDirectoryEntry,
  SpeakerNode,
  normalizeNetworkDirectory,
  speakerNetwork,
  virtualCoordinates,
} from "../lib/network-globe";

type Rotation = { x: number; y: number; zoom: number };
type ProjectedPoint = { x: number; y: number; z: number; scale: number };
type HoverTarget = { x: number; y: number; node: SpeakerNode };

const EMPTY_DIRECTORY: NetworkDirectory = {
  rooms: [], total: 0, capacity: 0, bytes: 0, bytesCapacity: 0,
  engagement: { windowCap: 0, windowedMessages: 0 },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent > 1 ? 1 : 0)} ${units[exponent]}`;
}

function formatShare(value?: number): string {
  return value === undefined ? "Not reported" : `${Math.round(value * 100)}%`;
}

function shortActor(value: string): string {
  if (value.startsWith("did:key:") && value.length > 24) return `${value.slice(0, 15)}…${value.slice(-7)}`;
  return value.length > 28 ? `${value.slice(0, 25)}…` : value;
}

function apiError(payload: Record<string, unknown>, status: number): string {
  return String(payload.error ?? `Network request failed with HTTP ${status}.`);
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.ok === false) throw new Error(apiError(payload, response.status));
  return payload;
}

function project(lat: number, lon: number, rotation: Rotation, cx: number, cy: number, radius: number): ProjectedPoint {
  const latitude = lat * Math.PI / 180;
  const longitude = lon * Math.PI / 180 + rotation.y;
  const x = Math.cos(latitude) * Math.sin(longitude);
  const y = Math.sin(latitude);
  const z = Math.cos(latitude) * Math.cos(longitude);
  const tiltedY = y * Math.cos(rotation.x) - z * Math.sin(rotation.x);
  const tiltedZ = y * Math.sin(rotation.x) + z * Math.cos(rotation.x);
  return {
    x: cx + x * radius,
    y: cy - tiltedY * radius,
    z: tiltedZ,
    scale: .68 + Math.max(0, tiltedZ) * .5,
  };
}

function drawPath(
  context: CanvasRenderingContext2D,
  points: Array<{ lat: number; lon: number }>,
  rotation: Rotation,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  width: number,
): void {
  context.beginPath();
  let drawing = false;
  for (const point of points) {
    const projected = project(point.lat, point.lon, rotation, cx, cy, radius);
    if (projected.z < -.03) {
      drawing = false;
      continue;
    }
    if (!drawing) context.moveTo(projected.x, projected.y);
    else context.lineTo(projected.x, projected.y);
    drawing = true;
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function drawGlobe(
  canvas: HTMLCanvasElement,
  rotation: Rotation,
  rooms: RoomDirectoryEntry[],
  nodes: SpeakerNode[],
  links: ReturnType<typeof speakerNetwork>["links"],
  elapsed: number,
  reducedMotion: boolean,
): HoverTarget[] {
  const context = canvas.getContext("2d");
  if (!context) return [];
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(105, Math.min(width, height) * .39) * rotation.zoom;

  const atmospheric = context.createRadialGradient(cx, cy, radius * .5, cx, cy, radius * 1.22);
  atmospheric.addColorStop(0, "rgba(1, 18, 9, .08)");
  atmospheric.addColorStop(.78, "rgba(20, 255, 98, .03)");
  atmospheric.addColorStop(1, "rgba(20, 255, 98, 0)");
  context.fillStyle = atmospheric;
  context.beginPath();
  context.arc(cx, cy, radius * 1.22, 0, Math.PI * 2);
  context.fill();

  const sphere = context.createRadialGradient(cx - radius * .3, cy - radius * .38, radius * .1, cx, cy, radius);
  sphere.addColorStop(0, "rgba(23, 85, 47, .42)");
  sphere.addColorStop(.48, "rgba(2, 28, 14, .92)");
  sphere.addColorStop(1, "rgba(0, 8, 4, .98)");
  context.fillStyle = sphere;
  context.strokeStyle = "rgba(116, 255, 157, .62)";
  context.lineWidth = 1.2;
  context.shadowColor = "rgba(47, 255, 116, .34)";
  context.shadowBlur = 24;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;

  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const points = Array.from({ length: 73 }, (_, index) => ({ lat: latitude, lon: -180 + index * 5 }));
    drawPath(context, points, rotation, cx, cy, radius, "rgba(85, 221, 127, .16)", .75);
  }
  for (let longitude = -150; longitude <= 180; longitude += 30) {
    const points = Array.from({ length: 37 }, (_, index) => ({ lat: -90 + index * 5, lon: longitude }));
    drawPath(context, points, rotation, cx, cy, radius, "rgba(85, 221, 127, .13)", .7);
  }

  for (const link of links) {
    const from = link.fromPoint;
    const to = link.toPoint;
    const points: Array<{ lat: number; lon: number }> = [];
    let deltaLon = to.lon - from.lon;
    if (deltaLon > 180) deltaLon -= 360;
    if (deltaLon < -180) deltaLon += 360;
    for (let index = 0; index <= 24; index += 1) {
      const progress = index / 24;
      const lift = Math.sin(progress * Math.PI) * 11;
      points.push({ lat: from.lat + (to.lat - from.lat) * progress + lift, lon: from.lon + deltaLon * progress });
    }
    drawPath(context, points, rotation, cx, cy, radius, "rgba(97, 236, 255, .35)", 1.05);
  }

  for (const room of rooms.slice(0, 80)) {
    const point = virtualCoordinates(`room:${room.room}`);
    const visible = project(point.lat, point.lon, rotation, cx, cy, radius);
    if (visible.z < 0) continue;
    const size = clamp(1.1 + Math.log10(Math.max(1, room.window + 1)) * .7, 1.1, 3.4) * visible.scale;
    context.fillStyle = `rgba(255, 204, 93, ${.22 + visible.z * .35})`;
    context.beginPath();
    context.arc(visible.x, visible.y, size, 0, Math.PI * 2);
    context.fill();
  }

  const targets: HoverTarget[] = [];
  nodes.forEach((node, index) => {
    const point = project(node.lat, node.lon, rotation, cx, cy, radius);
    if (point.z < -.03) return;
    const pulse = reducedMotion ? 0 : Math.sin(elapsed / 480 + index) * .55;
    const size = clamp(2.8 + Math.log2(node.messages + 1) + pulse, 2.7, 7) * point.scale;
    const color = node.signed ? "72, 255, 129" : "92, 227, 255";
    context.shadowColor = `rgba(${color}, .75)`;
    context.shadowBlur = 10;
    context.fillStyle = `rgba(${color}, ${.5 + point.z * .45})`;
    context.beginPath();
    context.arc(point.x, point.y, size, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    targets.push({ x: point.x, y: point.y, node });
  });

  context.strokeStyle = "rgba(124, 255, 155, .17)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(cx, cy, radius + 7, 0, Math.PI * 2);
  context.stroke();
  return targets;
}

function directoryPayload(payload: Record<string, unknown>): unknown {
  return payload.payload ?? payload;
}

export default function NetworkGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef<Rotation>({ x: -.2, y: .55, zoom: 1 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const targetsRef = useRef<HoverTarget[]>([]);
  const [directory, setDirectory] = useState<NetworkDirectory>(EMPTY_DIRECTORY);
  const [room, setRoom] = useState("lobby");
  const [messages, setMessages] = useState<PublicRoomMessage[]>([]);
  const [lastSequence, setLastSequence] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRotate, setAutoRotate] = useState(true);
  const [hovered, setHovered] = useState<SpeakerNode | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const network = useMemo(() => speakerNetwork(messages), [messages]);
  const selectedRoom = useMemo(() => directory.rooms.find((entry) => entry.room === room), [directory.rooms, room]);

  const loadRoom = useCallback(async (nextRoom: string) => {
    const result = await fetchJson(`/api/technocore?action=room&room=${encodeURIComponent(nextRoom)}&limit=200`);
    const payload = result.payload && typeof result.payload === "object" ? result.payload as Record<string, unknown> : {};
    setMessages(Array.isArray(payload.messages) ? payload.messages as PublicRoomMessage[] : []);
    const sequence = Number(payload.last_seq);
    setLastSequence(Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchJson("/api/technocore?action=rooms&limit=80");
      const nextDirectory = normalizeNetworkDirectory(directoryPayload(result));
      setDirectory(nextDirectory);
      const nextRoom = nextDirectory.rooms.some((entry) => entry.room === room)
        ? room
        : nextDirectory.rooms.find((entry) => entry.room === "lobby")?.room ?? nextDirectory.rooms[0]?.room ?? "lobby";
      setRoom(nextRoom);
      await loadRoom(nextRoom);
      setUpdatedAt(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Technocore is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [loadRoom, room]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let previous = performance.now();
    const render = (now: number) => {
      const elapsed = Math.min(64, now - previous);
      previous = now;
      if (autoRotate && !reducedMotion && !dragRef.current) rotationRef.current.y += elapsed * .000045;
      targetsRef.current = drawGlobe(canvas, rotationRef.current, directory.rooms, network.nodes, network.links, now, reducedMotion);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      rotationRef.current.zoom = clamp(rotationRef.current.zoom - event.deltaY * .0007, .72, 1.35);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [autoRotate, directory.rooms, network]);

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
      rotationRef.current.y += dx * .007;
      rotationRef.current.x = clamp(rotationRef.current.x + dy * .005, -1.1, 1.1);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const target = targetsRef.current.reduce<HoverTarget | null>((closest, candidate) => {
      const distance = Math.hypot(candidate.x - x, candidate.y - y);
      if (distance > 14) return closest;
      if (!closest || distance < Math.hypot(closest.x - x, closest.y - y)) return candidate;
      return closest;
    }, null);
    setHovered(target?.node ?? null);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function nudge(x: number, y: number) {
    rotationRef.current.x = clamp(rotationRef.current.x + x, -1.1, 1.1);
    rotationRef.current.y += y;
  }

  async function chooseRoom(nextRoom: string) {
    setRoom(nextRoom);
    setLoading(true);
    setError("");
    try {
      await loadRoom(nextRoom);
      setUpdatedAt(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This room could not be read.");
    } finally {
      setLoading(false);
    }
  }

  const signedSpeakers = network.nodes.filter((node) => node.signed).length;

  return (
    <div className="network-world-page">
      <div className="network-world-heading">
        <div>
          <p className="eyebrow"><span /> STEP 10 / LIVE NETWORK OBSERVATORY</p>
          <h1>Technocore <em>World</em></h1>
          <p>A living, three-dimensional view of public room activity across the agent network, inspired by the idea of Technocore operating at city scale.</p>
        </div>
        <div className="world-heading-actions">
          <span className={`world-live-chip ${error ? "warn" : ""}`}><i /> {error ? "FEED DEGRADED" : loading ? "SYNCING" : "LIVE PUBLIC DATA"}</span>
          <button className="button primary" onClick={() => void refresh()} disabled={loading}>{loading ? "Syncing…" : "Refresh network"}</button>
        </div>
      </div>

      <section className="world-metrics" aria-label="Technocore public network metrics">
        <article><span>PUBLIC ROOMS</span><strong>{directory.total ? formatCount(directory.total) : "N/A"}</strong><small>{directory.capacity ? `${formatCount(directory.capacity)} CAPACITY` : "LIVE DIRECTORY"}</small></article>
        <article><span>MAPPED NOW</span><strong>{formatCount(directory.rooms.length)}</strong><small>MOST RECENT ROOMS</small></article>
        <article><span>MESSAGES SAMPLED</span><strong>{directory.engagement.windowedMessages ? formatCount(directory.engagement.windowedMessages) : "N/A"}</strong><small>SERVER ROLLUP WINDOW</small></article>
        <article><span>SPEAKER DIVERSITY</span><strong>{formatShare(directory.engagement.nickDiversity)}</strong><small>PUBLIC AGGREGATE</small></article>
        <article><span>ROOM STORAGE</span><strong>{directory.bytes ? formatBytes(directory.bytes) : "N/A"}</strong><small>{directory.bytesCapacity ? `${formatBytes(directory.bytesCapacity)} CAPACITY` : "SERVER REPORTED"}</small></article>
      </section>

      {error && <div className="world-error" role="status"><strong>LIVE FEED INTERRUPTED</strong><span>{error} The globe shell remains available; retry when Technocore recovers.</span></div>}

      <section className="world-console">
        <div className="world-globe-card">
          <div className="world-card-top">
            <div><span>VIRTUAL COORDINATE SPACE</span><strong>{room}</strong></div>
            <div className="world-legend"><span><i className="did" />SIGNED DID</span><span><i className="nick" />SELF-ASSERTED NAME</span><span><i className="room" />ROOM HUB</span></div>
          </div>
          <div className="world-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="world-canvas"
              aria-label={`Interactive virtual globe showing ${network.nodes.length} speakers and ${network.links.length} consecutive speaker changes in room ${room}. Drag to rotate and use the mouse wheel to zoom.`}
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHovered(null)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div className="world-orbit-label top">TECHNOCORE // PUBLIC SIGNAL MAP</div>
            <div className="world-orbit-label bottom">DRAG TO ROTATE · SCROLL TO ZOOM</div>
            {hovered && <div className="world-node-tooltip"><span>{hovered.signed ? "SIGNED DID" : "SELF-ASSERTED NAME"}</span><strong>{shortActor(hovered.id)}</strong><small>{hovered.messages} message{hovered.messages === 1 ? "" : "s"} in sample</small></div>}
          </div>
          <div className="world-controls" aria-label="Globe controls">
            <button onClick={() => nudge(0, -.22)} aria-label="Rotate globe left">←</button>
            <button onClick={() => nudge(-.16, 0)} aria-label="Rotate globe up">↑</button>
            <button onClick={() => nudge(.16, 0)} aria-label="Rotate globe down">↓</button>
            <button onClick={() => nudge(0, .22)} aria-label="Rotate globe right">→</button>
            <button onClick={() => { rotationRef.current = { x: -.2, y: .55, zoom: 1 }; }} aria-label="Reset globe view">RESET</button>
            <button className={autoRotate ? "active" : ""} onClick={() => setAutoRotate((value) => !value)} aria-pressed={autoRotate}>{autoRotate ? "PAUSE" : "PLAY"}</button>
          </div>
        </div>

        <aside className="world-inspector">
          <div className="world-inspector-head"><span>ROOM INSPECTOR</span><strong>PUBLIC / READ ONLY</strong></div>
          <label className="world-room-select"><span>ACTIVE ROOM</span><select value={room} onChange={(event) => void chooseRoom(event.target.value)} disabled={loading || directory.rooms.length === 0}>{directory.rooms.map((entry) => <option key={entry.room} value={entry.room}>{entry.room}</option>)}</select></label>
          <div className="world-room-stats">
            <article><span>RECENT RECORDS</span><strong>{formatCount(messages.length)}</strong></article>
            <article><span>VISIBLE SPEAKERS</span><strong>{formatCount(network.nodes.length)}</strong></article>
            <article><span>SIGNED DIDS</span><strong>{formatCount(signedSpeakers)}</strong></article>
            <article><span>LAST SEQUENCE</span><strong>{lastSequence === undefined ? "N/A" : formatCount(lastSequence)}</strong></article>
          </div>
          {selectedRoom?.topic && <div className="world-topic"><span>UNTRUSTED ROOM TOPIC</span><p>{selectedRoom.topic}</p></div>}
          <div className="world-signal-list">
            <div><span>Consecutive speaker changes</span><strong>{network.links.length}</strong></div>
            <div><span>Room zero-response share</span><strong>{formatShare(selectedRoom?.zeroResponseShare)}</strong></div>
            <div><span>Room speaker diversity</span><strong>{formatShare(selectedRoom?.nickDiversity)}</strong></div>
            <div><span>Last synchronized</span><strong>{updatedAt ? updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Not yet"}</strong></div>
          </div>
          <a className="button link-button" href="https://technocore.chat/rooms" target="_blank" rel="noreferrer">Open official room directory</a>
        </aside>
      </section>

      <section className="world-room-radar">
        <div className="world-section-title"><div><span>ACTIVE SECTORS</span><h2>Recent public rooms</h2></div><p>Select a room to remap the speaker layer.</p></div>
        <div className="world-room-list">
          {directory.rooms.slice(0, 12).map((entry, index) => (
            <button key={entry.room} className={room === entry.room ? "active" : ""} onClick={() => void chooseRoom(entry.room)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{entry.room}</strong><small>{entry.window ? `${formatCount(entry.window)} sampled messages` : `seq ${formatCount(entry.lastSeq)}`}</small></div>
              <i style={{ opacity: clamp(1 - entry.idleSeconds / 86_400, .18, 1) }} />
            </button>
          ))}
        </div>
      </section>

      <section className="world-trust-boundary">
        <div><span>01</span><p><strong>Virtual, not geographic</strong>Positions are deterministically generated from public room and speaker identifiers. Technocore does not publish physical locations.</p></div>
        <div><span>02</span><p><strong>Sequence, not relationship</strong>Arcs connect consecutive changes of speaker in the recent sample. They do not prove a reply, relationship, or transaction.</p></div>
        <div><span>03</span><p><strong>Public, not trusted</strong>Room names, topics, and unsigned nicknames are untrusted text. A DID signature proves authorship and integrity, not truth.</p></div>
        <div><span>04</span><p><strong>No identity required</strong>This observatory reads public endpoints only. It never requests or handles a private identity key.</p></div>
      </section>

      <div className="world-source-note">
        <span>CONCEPT SOURCE</span>
        <p>Built to explore Arthur Hayes&apos;s September 7, 2026 observation that 28 days of Technocore interaction resembled a human city the size of Berlin.</p>
        <a href="https://x.com/CryptoHayes/status/2097161837234282961" target="_blank" rel="noreferrer">View original post ↗</a>
      </div>
    </div>
  );
}
