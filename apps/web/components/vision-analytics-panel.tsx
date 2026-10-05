"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  Video,
  VideoOff,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Car,
  Activity,
  Compass,
  Layers,
  Radio,
  Zap,
  Gauge,
} from "lucide-react";
import { canvasSize, detectionFrameIndex, sameGeometry, isAggregateTelemetry, DISPLAY_TELEMETRY_VERSION, displayMediaURL, annotationMediaURL } from "@/lib/video-display";
import {LoadingState} from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import type { ProcessedClip } from "@/lib/run-input";
import { observationQuery } from "@/lib/observation-query";
import { latestDisplayObservation } from "@/lib/observations";
import type { Analysis, TrafficState } from "../../../packages/contracts/typescript/events";

interface VisionAnalyticsPanelProps {
  onReturn?: () => void;
  initialOffline?: boolean;
  frame?: TrafficState | null;
  analysis?: Analysis | null;
  boundaryMapping?: Record<string, string>;
  sourceSessions?: Record<string, string>;
  processedClips?: ProcessedClip[];
  onSelectSourceSession?: (camera: string, session: string) => void;
}

export interface CameraSlot {
  id: string;
  label: string;
  approach: string;
  videoFile: string;
  role: string;
  resolution: string;
  fps: number;
  clipSha256?: string;
  geometry?: unknown;
}

export const ALL_CAMERA_SLOTS: CameraSlot[] = [
  { id: "CAM-01", label: "CAM-01", approach: "C2 → C1 Approach", videoFile: "12937197_3840_2160_30fps.mp4", role: "external_boundary_input", resolution: "3840x2160 (4K UHD)", fps: 30 },
  { id: "CAM-02", label: "CAM-02", approach: "C4 → C1 Approach", videoFile: "12954360_3840_2160_30fps.mp4", role: "external_boundary_input", resolution: "3840x2160 (4K UHD)", fps: 30 },
  { id: "CAM-03", label: "CAM-03", approach: "C5 → C1 Approach", videoFile: "12960820_3840_2160_30fps.mp4", role: "external_boundary_input", resolution: "3840x2160 (4K UHD)", fps: 30 },
  { id: "CAM-04", label: "CAM-04", approach: "C3 → C1 Internal", videoFile: "12972416_3840_2160_30fps.mp4", role: "internal_link_observation", resolution: "3840x2160 (4K UHD)", fps: 30 },
  { id: "CAM-05", label: "CAM-05", approach: "C1 → C3 Internal", videoFile: "13268898_3840_2160_30fps.mp4", role: "internal_link_observation", resolution: "3840x2160 (4K UHD)", fps: 30 },
  { id: "CAM-06", label: "CAM-06", approach: "C6 → C3 Boundary", videoFile: "13105470_3840_2160_30fps.mp4", role: "external_boundary_input", resolution: "3840x2160 (4K UHD)", fps: 30 },
  { id: "CAM-07", label: "CAM-07", approach: "Corridor Aux 1", videoFile: "12937233_3840_2160_30fps.mp4", role: "concurrent_benchmark_only", resolution: "3840x2160 (4K UHD)", fps: 30 },
  { id: "CAM-08", label: "CAM-08", approach: "Corridor Aux 2", videoFile: "13269027_3840_2160_30fps.mp4", role: "concurrent_benchmark_only", resolution: "3840x2160 (4K UHD)", fps: 30 },
  { id: "CAM-09", label: "CAM-09", approach: "Intersection 1", videoFile: "14828714_1080_1920_30fps.mp4", role: "concurrent_benchmark_only", resolution: "1080x1920 (HD)", fps: 30 },
  { id: "CAM-10", label: "CAM-10", approach: "Intersection 2", videoFile: "14932177_2160_3840_30fps.mp4", role: "concurrent_benchmark_only", resolution: "2160x3840 (4K UHD)", fps: 30 },
  { id: "CAM-11", label: "CAM-11", approach: "Intersection 3", videoFile: "14932195_2160_3840_30fps.mp4", role: "concurrent_benchmark_only", resolution: "2160x3840 (4K UHD)", fps: 30 },
  { id: "CAM-12", label: "CAM-12", approach: "Intersection 4", videoFile: "14938748_2160_3840_30fps.mp4", role: "concurrent_benchmark_only", resolution: "2160x3840 (4K UHD)", fps: 30 },
];

type StreamLaneMetric = {
  id: string;
  label: string;
  active: number;
  queue: number;
  share: number;
};

const STREAM_ROLE_DETAILS: Record<CameraSlot["role"], { label: string; description: string; networkUse: string }> = {
  external_boundary_input: {
    label: "Boundary approach",
    description: "This recorded sample supplies a virtual boundary demand profile when video-derived demand is selected for a run.",
    networkUse: "Video-derived virtual boundary input",
  },
  internal_link_observation: {
    label: "Internal corridor link",
    description: "This sample observes an internal corridor movement. It is displayed independently and does not override modeled network state.",
    networkUse: "Internal observation only",
  },
  concurrent_benchmark_only: {
    label: "Independent benchmark stream",
    description: "This sample is a separate benchmark stream. It is not mapped to a live junction or injected into the traffic model.",
    networkUse: "No network injection",
  },
};

function displayVehicleClass(className: string) {
  const labels: Record<string, string> = {
    two_wheeler: "Bike",
    autorickshaw: "Auto",
    pedestrain: "Pedestrian",
    lcv: "LCV",
  };
  return labels[className] || className.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const ROUTE_CLASS_META: Record<string, { label: string; color: string; bg: string }> = {
  car: { label: "Cars", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)" },
  two_wheeler: { label: "2-Wheelers", color: "#10b981", bg: "rgba(16, 185, 129, 0.12)" },
  autorickshaw: { label: "Auto-Rickshaws", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)" },
  bus: { label: "Buses", color: "#ef4444", bg: "rgba(239, 68, 68, 0.12)" },
  truck: { label: "Trucks", color: "#a855f7", bg: "rgba(168, 85, 247, 0.12)" },
  lcv: { label: "LCVs", color: "#06b6d4", bg: "rgba(6, 182, 212, 0.12)" },
  pedestrain: { label: "Pedestrians", color: "#ec4899", bg: "rgba(236, 72, 153, 0.12)" },
  bicycle: { label: "Bicycles", color: "#84cc16", bg: "rgba(132, 204, 22, 0.12)" },
};

const RADAR_CLASS_COLORS: Record<string, string> = {
  car: "#3b82f6",
  two_wheeler: "#10b981",
  autorickshaw: "#f59e0b",
  bus: "#ef4444",
  truck: "#a855f7",
  pedestrain: "#ec4899",
  lcv: "#06b6d4",
  bicycle: "#84cc16",
};

function getStreamLaneMetrics(frame: any, telemetry: any): StreamLaneMetric[] {
  const detections = frame?.detections || [];
  const bands = [
    { id: "left", label: "Left ROI band (Outbound · Jaane wala ↑)", active: 0 },
    { id: "centre", label: "Centre ROI band (Median)", active: 0 },
    { id: "right", label: "Right ROI band (Inbound · Aane wala ↓)", active: 0 },
  ];

  detections.forEach((detection: any) => {
    const bbox = detection?.bbox;
    if (detection.class === "pedestrain") return;
    if (!Array.isArray(bbox) || bbox.length < 4) return;
    const centreX = (Number(bbox[0]) + Number(bbox[2])) / 2;
    const band = centreX < 1 / 3 ? 0 : centreX < 2 / 3 ? 1 : 2;
    bands[band].active += 1;
  });

  const activeCount = Number(frame?.active_count ?? detections.length ?? 0);
  const queueCount = Number(frame?.queue_count ?? 0);
  const knownActive = bands.reduce((total, band) => total + band.active, 0);
  const effectiveActive = Math.max(activeCount, knownActive, 1);

  return bands.map((band) => {
    const share = band.active / effectiveActive;
    return {
      id: band.id,
      label: band.label,
      active: band.active,
      // The pipeline supplies a stream-wide queue count, so distribute it by the
      // observed ROI-band activity rather than pretending it is lane calibrated.
      queue: Math.round(queueCount * share),
      share,
    };
  });
}

function getObservedFlowVpm(frames: any[] | undefined, frameIndex: number): number | null {
  if (!frames?.length) return null;
  const current = frames[Math.min(frameIndex, frames.length - 1)];
  const windowStart = frames[Math.max(0, frameIndex - 49)];
  const elapsedSeconds = Number(current?.time_s) - Number(windowStart?.time_s);
  const crossed = Number(current?.cumulative_crossed ?? 0) - Number(windowStart?.cumulative_crossed ?? 0);
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || !Number.isFinite(crossed)) return null;
  return Math.max(0, (crossed / elapsedSeconds) * 60);
}

function safePlayVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
  try {
    const res = video.play();
    if (res && typeof res.catch === "function") {
      res.catch(() => {});
    }
  } catch {
    // jsdom
  }
}

function safePauseVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
  try {
    video.pause();
  } catch {
    // jsdom
  }
}

function activeCameraResolution(camera: string, slots: CameraSlot[]): [number, number] {
  const match = slots.find((slot) => slot.id === camera)?.resolution.match(/(\d+)x(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : [16, 9];
}

export function VisionAnalyticsPanel({ onReturn, initialOffline = false, frame = null, analysis = null, boundaryMapping = {}, sourceSessions = {}, processedClips = [], onSelectSourceSession }: VisionAnalyticsPanelProps) {
  const [isOffline, setIsOffline] = useState(initialOffline);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [mediaTime, setMediaTime] = useState(0);
  const [mediaSize, setMediaSize] = useState({ width: 960, height: 540 });
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [showLanes, setShowLanes] = useState(true);
  const [showCountingLine, setShowCountingLine] = useState(true);
  const [showQueueROI, setShowQueueROI] = useState(true);
  const [crossingPulse, setCrossingPulse] = useState(false);

  // 12 Videos & Camera selection
  const [selectedCamera, setSelectedCamera] = useState<string>("CAM-01");
  const [chartHover, setChartHover] = useState<{
    frame: any;
    index: number;
    time: number;
    x: number;
  } | null>(null);
  const processingMode = "cached_observations";
  const [liveObservations, setLiveObservations] = useState<any[]>([]);
  const [observationStatus, setObservationStatus] = useState("missing");
  const [observationReason, setObservationReason] = useState("");
  const [telemetryMap, setTelemetryMap] = useState<Record<string, any>>({});
  const [annotationManifest, setAnnotationManifest] = useState<any>(null);
  const [displayManifest, setDisplayManifest] = useState<any>(null);
  const [cameraSlots, setCameraSlots] = useState<CameraSlot[]>(ALL_CAMERA_SLOTS);
  const [cameraRegistryReady, setCameraRegistryReady] = useState(typeof process !== "undefined" && process.env?.NODE_ENV === "test");
  const [cameraRegistryError, setCameraRegistryError] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prevCrossedCountRef = useRef<number>(0);

  const displayURL = displayMediaURL(selectedCamera, cameraSlots.find(camera => camera.id === selectedCamera)?.clipSha256, displayManifest);
  const selectedSlot = cameraSlots.find(camera => camera.id === selectedCamera);
  const annotationURL = annotationMediaURL(selectedCamera, selectedSlot?.clipSha256, selectedSlot?.geometry, annotationManifest);
  const mediaURL = annotationURL || displayURL || `/api/v1/clips/${selectedCamera}/media`;

  useEffect(() => {
    let mounted = true;
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
    fetch("/vision-display-media/manifest.json", {cache: "no-store"}).then(response => response.ok ? response.json() : null)
      .then(manifest => { if (mounted) setDisplayManifest(manifest); }).catch(() => {});
    return () => { mounted = false; };
  }, [selectedCamera]);

  // Load 12-camera telemetry generated from ITD v1.2 YOLO + ByteTrack
  useEffect(() => {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
    let isMounted = true;
    fetch("/vision-display-data.json", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((payload) => {
        if (isMounted && payload && typeof payload === "object") {
          setTelemetryMap(payload);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [selectedCamera]);

  useEffect(() => {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
    fetch("/api/v1/cameras").then((response) => response.ok ? response.json() : null).then((payload) => {
      if (!payload?.cameras || !Array.isArray(payload.assets)) { setCameraRegistryError(true); return; }
      const assets = new Map<string, any>(payload.assets.map((asset: any) => [asset.assigned_slot, asset]));
      const slots = Object.entries(payload.cameras).map(([id, raw]) => {
        const camera = raw as any;
        const asset = assets.get(id);
        if (!asset || !camera.assigned_video || asset.filename !== camera.assigned_video) return null;
        return { id, label: id, approach: camera.virtual_direction || id, videoFile: camera.assigned_video, role: camera.network_role === "internal_link_sample_analytics" ? "internal_link_observation" : camera.network_role, resolution: asset.resolution || "unknown", fps: Number(asset.fps || 0), clipSha256: asset.sha256, geometry: camera.geometry } as CameraSlot;
      }).filter((slot): slot is CameraSlot => slot !== null).sort((a, b) => a.id.localeCompare(b.id));
      if (slots.length === 0) { setCameraRegistryError(true); return; }
      setCameraSlots(slots);
      setSelectedCamera(current => slots.some(slot => slot.id === current) ? current : slots[0].id);
      setCameraRegistryReady(true);
    }).catch(() => setCameraRegistryError(true));
  }, []);

  useEffect(() => {
    setAnnotationManifest(null);
    if (!selectedSlot?.clipSha256 || !cameraRegistryReady) return;
    const controller = new AbortController();
    fetch(`/api/v1/clips/${selectedCamera}/annotation`, {cache: "no-store", signal: controller.signal})
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (controller.signal.aborted || !annotationMediaURL(selectedCamera, selectedSlot.clipSha256, selectedSlot.geometry, payload)) return;
        setAnnotationManifest(payload);
        if (isAggregateTelemetry(payload.aggregates)) setTelemetryMap(current => ({...current, [selectedCamera]: payload.aggregates}));
      }).catch(() => {});
    return () => controller.abort();
  }, [selectedCamera, selectedSlot?.clipSha256, selectedSlot?.geometry, cameraRegistryReady]);

  const observationURL = observationQuery(selectedCamera, processingMode, frame, boundaryMapping, sourceSessions, Math.floor(mediaTime));

  // Fetch live vision state or real observations from Go API gateway
  useEffect(() => {
    // Clear only when observation identity changes. A later display-copy URL
    // for the same registered clip must not erase an already loaded response.
    setLiveObservations([]);
    setObservationStatus("missing");
    setObservationReason("");
    if (isOffline) return;
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
    let isMounted = true;

    fetch(observationURL)
      .then((res) => {
        if (!res.ok) throw Error(`Observation request failed (${res.status})`);
        return res.json();
      })
      .then((payload) => {
        if (isMounted && payload) {
          setLiveObservations(Array.isArray(payload.observations) ? payload.observations : []);
          setObservationStatus(payload.status || "missing");
          setObservationReason(payload.reason || "");
        }
      })
      .catch((error) => { if (isMounted) { setLiveObservations([]); setObservationStatus("missing"); setObservationReason(error instanceof Error ? error.message : "Observations unavailable"); } });

    return () => {
      isMounted = false;
    };
  }, [isOffline, observationURL]);

  // Display-only clip selection. Playback never changes the run's bound input.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.src = mediaURL;
    setMediaError(false);
    setMediaReady(false);
    video.currentTime = 0;
    setCurrentFrameIdx(-1);
    setMediaTime(0);
    prevCrossedCountRef.current = 0;
    setCrossingPulse(false);
    const dimensions = activeCameraResolution(selectedCamera, cameraSlots);
    setMediaSize(canvasSize(dimensions[0], dimensions[1]));
    if (isPlaying) {
      safePlayVideo(video);
    }
  }, [selectedCamera, mediaURL]);

  const totalFrames = telemetryMap[selectedCamera]?.frames?.length || 100;
  const registeredCamera = cameraSlots.find((camera) => camera.id === selectedCamera);
  const cachedTelemetry = telemetryMap[selectedCamera];
  const activeTelemetry = isAggregateTelemetry(cachedTelemetry) && cachedTelemetry?.video_file === registeredCamera?.videoFile
    && (!registeredCamera?.clipSha256 || cachedTelemetry?.source_identity?.clip_sha256 === registeredCamera.clipSha256)
    && (!registeredCamera?.geometry || sameGeometry(cachedTelemetry?.geometry, registeredCamera.geometry))
    ? cachedTelemetry : undefined;
  const activeFrameData = mediaReady && currentFrameIdx >= 0 ? activeTelemetry?.frames?.[currentFrameIdx] : undefined;
  const activeCamInfo = cameraSlots.find((c) => c.id === selectedCamera) || cameraSlots[0];

  // Display playback never changes the authoritative run or observation session.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackSpeed;
    if (!isPlaying || isOffline) safePauseVideo(video);
    else safePlayVideo(video);
  }, [isPlaying, isOffline, playbackSpeed, selectedCamera, cameraRegistryReady]);

  const syncMediaTime = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    // Sampled encoders can round the final frame beyond source coverage.
    // Loop display at the immutable source end; never hold stale annotations.
    if (annotationURL && video.currentTime >= annotationManifest.duration_s) video.currentTime = 0;
    const time = video.currentTime;
    setMediaTime(Math.floor(time * 100) / 100);
    setCurrentFrameIdx(detectionFrameIndex(activeTelemetry, time));
  }, [activeTelemetry, annotationURL, annotationManifest]);

  // Single-pulse line crossing detection
  useEffect(() => {
    const crossedCount = activeFrameData?.cumulative_crossed ?? 0;
    if (crossedCount > prevCrossedCountRef.current) {
      setCrossingPulse(true);
      const timer = setTimeout(() => setCrossingPulse(false), 350);
      prevCrossedCountRef.current = crossedCount;
      return () => clearTimeout(timer);
    }
    prevCrossedCountRef.current = crossedCount;
    setCrossingPulse(false);
  }, [activeFrameData]);

  // Render real video + computer vision overlays on HTML5 canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isOffline) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const video = videoRef.current;
    const geom = activeTelemetry?.geometry || (registeredCamera?.geometry as any);

    // 1. Draw Real Video Frame or Dark CCTV Placeholder
    if (video && video.readyState >= 2 && video.videoWidth > 0 && typeof ctx.drawImage === "function") {
      ctx.drawImage(video, 0, 0, width, height);
    } else {
      ctx.fillStyle = "#0a0f16";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      ctx.fillStyle = "#64748b";
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`CCTV FEED BUFFERING · ${selectedCamera} (${activeCamInfo.videoFile})`, width / 2, height / 2);
    }

    // 2. Camera Geometry: Road ROI & Lane Polygons
    if (showLanes && geom?.road_roi && geom.road_roi.length > 2) {
      ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      geom.road_roi.forEach(([rx, ry]: [number, number], i: number) => {
        if (i === 0) ctx.moveTo(rx * width, ry * height);
        else ctx.lineTo(rx * width, ry * height);
      });
      ctx.closePath?.();
      ctx.stroke();
    }

    // 3. Queue Detection ROI Polygon Zone
    if (showQueueROI) {
      const qRoi = geom?.queue_roi;
      if (qRoi && qRoi.length > 2) {
        ctx.fillStyle = "rgba(168, 85, 247, 0.16)";
        ctx.strokeStyle = "rgba(192, 132, 252, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        qRoi.forEach(([qx, qy]: [number, number], i: number) => {
          if (i === 0) ctx.moveTo(qx * width, qy * height);
          else ctx.lineTo(qx * width, qy * height);
        });
        ctx.closePath?.();
        ctx.fill?.();
        ctx.stroke();

        ctx.fillStyle = "#e9d5ff";
        ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "left";
        const firstPt = qRoi[0];
        ctx.fillText("QUEUE DETECTION ROI", firstPt[0] * width + 8, firstPt[1] * height + 16);
      }
    }

    // 4. Directional Virtual Counting Line
    if (showCountingLine && geom?.counting_line) {
      const cl = geom.counting_line;
      const lx1 = cl.p1[0] * width;
      const ly1 = cl.p1[1] * height;
      const lx2 = cl.p2[0] * width;
      const ly2 = cl.p2[1] * height;

      ctx.strokeStyle = crossingPulse ? "#fbbf24" : "rgba(245, 158, 11, 0.9)";
      ctx.lineWidth = crossingPulse ? 4 : 2.5;
      ctx.beginPath();
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.stroke();

      const midX = (lx1 + lx2) / 2;
      const midY = (ly1 + ly2) / 2;
      ctx.fillStyle = crossingPulse ? "#d97706" : "rgba(217, 119, 6, 0.9)";
      ctx.fillRect(midX - 55, midY - 10, 110, 20);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      const crossed = activeFrameData?.cumulative_crossed ?? 0;
      ctx.fillText(`COUNTING LINE (${crossed}) ↓`, midX, midY + 4);
    }

    // Verified detector boxes/class confidence are rasterized into private
    // sampled preview media. No tracking details enter aggregate telemetry.
    const detections: never[] = [];

    // 6. CCTV HUD / OSD Overlay Banner
    ctx.fillStyle = "rgba(10, 15, 20, 0.85)";
    ctx.fillRect(0, 0, width, 44);

    // Blinking REC square icon
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(10, 8, 8, 8);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    const secCur = mediaTime.toFixed(2);
    ctx.fillText(
      `● RECORDED VIDEO · ${selectedCamera} · ${activeCamInfo.videoFile} · SOURCE ${secCur}s`,
      26,
      16
    );

    ctx.fillStyle = "#10b981";
    ctx.textAlign = "right";
    const actCount = activeFrameData?.active_count ?? detections.length;
    const qCount = typeof activeFrameData?.queue_count === "number" ? activeFrameData.queue_count : "unavailable";
    ctx.fillText(
      activeFrameData ? `CACHED DETECTIONS · VEHICLES: ${actCount} · PEDESTRIANS: ${activeFrameData.pedestrian_count ?? 0} · QUEUE ROI: ${qCount}` : "DETECTION UNAVAILABLE AT THIS SOURCE TIME",
      width - 12,
      36
    );
  }, [
    activeCamInfo.videoFile,
    activeFrameData,
    activeTelemetry,
    currentFrameIdx,
    mediaTime,
    isOffline,
    selectedCamera,
    showCountingLine,
    showLanes,
    showQueueROI,
    crossingPulse,
  ]);

  const drawRef = useRef(renderCanvas);
  drawRef.current = renderCanvas;
  useEffect(() => {
    let animation: number;
    const draw = () => { syncMediaTime(); drawRef.current(); animation = requestAnimationFrame(draw); };
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") { renderCanvas(); return; }
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [syncMediaTime]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        const next = Math.min(totalFrames - 1, Math.max(0, currentFrameIdx + 1));
        if (videoRef.current) videoRef.current.currentTime = activeTelemetry?.frames?.[next]?.time_s ?? 0;
        syncMediaTime();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const prev = Math.max(0, currentFrameIdx - 1);
        if (videoRef.current) videoRef.current.currentTime = activeTelemetry?.frames?.[prev]?.time_s ?? 0;
        syncMediaTime();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalFrames, currentFrameIdx, activeTelemetry, syncMediaTime]);

  // Offline / Disconnected State View
  if (isOffline) {
    return (
      <div className="vision-container" data-testid="vision-offline-panel">
        <div className="vision-offline-container">
          <div className="vision-offline-icon" aria-hidden="true">
            <VideoOff size={32} />
          </div>
          <h2>Sample Video Edge Pipeline Disconnected</h2>
          <p>
            Optional computer vision sample-video extraction is currently unavailable or disconnected.
            As specified in PRD §8.5 &amp; Backlog S37, core synthetic scenarios and golden replay remain 100% independent
            of computer vision feeds.
          </p>
          <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
            <Button
              variant="default"
              onClick={() => setIsOffline(false)}
              aria-label="Reconnect Sample Video Feed"
            >
              <RotateCcw size={16} /> Reconnect Sample Feed
            </Button>
            {onReturn && (
              <Button
                variant="outline"
                onClick={onReturn}
                aria-label="Return to Command Center"
              >
                Return to Command Center <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!cameraRegistryReady) return cameraRegistryError ? <div className="vision-container" role="alert">Camera registry unavailable; recorded feeds cannot be verified.</div> : <LoadingState label="Loading registered cameras…"/>;

  const streamRole = STREAM_ROLE_DETAILS[activeCamInfo.role];
  const streamFrames = activeTelemetry?.frames as any[] | undefined;

  // Each selected video owns the numbers in its dashboard. The C3 fallback is
  // used only until the selected clip's telemetry has loaded.
  const displayTotalVehicles = activeTelemetry?.summary?.total_unique_vehicles ?? 0;
  const displayCrossed = activeFrameData?.cumulative_crossed ?? "—";
  const displayActiveVehicles = activeFrameData?.active_count ?? 0;
  const displayQueueVehicles = activeFrameData?.queue_count ?? null;
  const classBreakdown = activeTelemetry?.summary?.class_breakdown || {};
  const laneMetrics = getStreamLaneMetrics(activeFrameData, activeTelemetry);
  const replayTimeS = mediaTime;
  const currentObservation = latestDisplayObservation(liveObservations, replayTimeS);
  const observedFlowVpm = currentObservation?.observation_status === "valid" ? Number(currentObservation.flow_vpm) : null;
  const coverageLabel = activeTelemetry ? `${Number(activeTelemetry.duration_s).toFixed(2)}s analyzed · cached aggregates sampled at ${(1 / activeTelemetry.sample_interval_s).toFixed(2)} FPS · ${activeCamInfo.resolution}` : "Detection cache unavailable; process this registered clip";
  const activeClassCounts = activeFrameData?.class_counts || {};
  const [dominantClass, dominantClassCount] = Object.entries(activeClassCounts)
    .sort(([, left], [, right]) => Number(right) - Number(left))[0] || ["—", 0];

  const queuePressure = displayActiveVehicles > 0 ? (displayQueueVehicles ?? 0) / displayActiveVehicles : 0;
  const queuePressureLabel = displayQueueVehicles === null ? "Queue estimate unavailable" : !activeFrameData ? "Detection unavailable" : displayActiveVehicles === 0
    ? "No vehicles in frame"
    : queuePressure >= 0.6
    ? "High queue pressure"
    : queuePressure >= 0.3
    ? "Queue building"
    : "Free-moving frame";
  const peakActiveVehicles = streamFrames?.length
    ? Math.max(...streamFrames.map((frame) => Number(frame?.active_count ?? 0)))
    : displayActiveVehicles;
  const knownQueues = streamFrames?.filter(frame=>frame.queue_count != null).map(frame=>Number(frame.queue_count)) ?? [];
  const peakQueueVehicles = knownQueues.length ? Math.max(...knownQueues) : null;

  const streamFlowRate = streamFrames?.length
    ? getObservedFlowVpm(streamFrames, streamFrames.length - 1)
    : null;

  // Time-series coordinates and SVG path calculation for route traffic dynamics analysis
  const chartFrames = (streamFrames && streamFrames.length > 0) ? streamFrames : [];
  const chartMaxTime = Math.max(10, Number(chartFrames[chartFrames.length - 1]?.time_s ?? activeTelemetry?.duration_s ?? 60));
  const maxActive = chartFrames.length ? Math.max(...chartFrames.map((f: any) => Number(f.active_count || 0))) : 0;
  const maxQueue = chartFrames.length ? Math.max(...chartFrames.map((f: any) => Number(f.queue_count || 0))) : 0;
  const maxCrossed = chartFrames.length ? Math.max(...chartFrames.map((f: any) => Number(f.cumulative_crossed || 0))) : 0;
  const chartMaxVal = Math.max(10, maxActive, maxQueue, maxCrossed);
  const chartYCeil = Math.ceil(chartMaxVal * 1.15);

  const chartSvgW = 800;
  const chartSvgH = 200;
  const chartPadL = 45;
  const chartPadR = 25;
  const chartPadT = 25;
  const chartPadB = 30;
  const chartPlotW = chartSvgW - chartPadL - chartPadR;
  const chartPlotH = chartSvgH - chartPadT - chartPadB;
  const chartMinX = chartPadL;
  const chartMaxX = chartSvgW - chartPadR;
  const chartMinY = chartPadT;
  const chartMaxY = chartSvgH - chartPadB;

  const getChartX = (t: number) => chartMinX + (Math.max(0, Math.min(t, chartMaxTime)) / chartMaxTime) * chartPlotW;
  const getChartY = (val: number) => chartMaxY - (Math.max(0, Math.min(val, chartYCeil)) / chartYCeil) * chartPlotH;

  const activePoints = chartFrames.map((f: any) => `${getChartX(f.time_s).toFixed(1)},${getChartY(f.active_count || 0).toFixed(1)}`);
  const activePathD = activePoints.length ? `M ${activePoints.join(" L ")}` : "";
  const activeAreaD = activePoints.length
    ? `M ${getChartX(chartFrames[0].time_s).toFixed(1)},${chartMaxY} L ${activePoints.join(" L ")} L ${getChartX(chartFrames[chartFrames.length - 1].time_s).toFixed(1)},${chartMaxY} Z`
    : "";

  const queuePoints = chartFrames.filter((f: any) => f.queue_count != null).map((f: any) => `${getChartX(f.time_s).toFixed(1)},${getChartY(f.queue_count || 0).toFixed(1)}`);
  const queuePathD = queuePoints.length ? `M ${queuePoints.join(" L ")}` : "";
  const queueAreaD = queuePoints.length
    ? `M ${getChartX(chartFrames[0].time_s).toFixed(1)},${chartMaxY} L ${queuePoints.join(" L ")} L ${getChartX(chartFrames[chartFrames.length - 1].time_s).toFixed(1)},${chartMaxY} Z`
    : "";

  const crossedPoints = chartFrames.map((f: any) => `${getChartX(f.time_s).toFixed(1)},${getChartY(f.cumulative_crossed || 0).toFixed(1)}`);
  const crossedPathD = crossedPoints.length ? `M ${crossedPoints.join(" L ")}` : "";

  const chartYTicks = [0, Math.round(chartYCeil / 3), Math.round((chartYCeil * 2) / 3), chartYCeil];
  const chartTimeStep = chartMaxTime > 90 ? 30 : chartMaxTime > 40 ? 10 : 5;
  const chartXTicks: number[] = [];
  for (let t = 0; t <= chartMaxTime; t += chartTimeStep) {
    chartXTicks.push(t);
  }
  if (chartXTicks[chartXTicks.length - 1] < chartMaxTime - 2) {
    chartXTicks.push(Math.round(chartMaxTime));
  }

  const chartPlayheadX = getChartX(mediaTime);

  const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartFrames.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (relX - (chartPadL * rect.width) / chartSvgW) / ((chartPlotW * rect.width) / chartSvgW)));
    const hoverTime = ratio * chartMaxTime;

    let bestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < chartFrames.length; i++) {
      const diff = Math.abs(chartFrames[i].time_s - hoverTime);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
    const f = chartFrames[bestIdx];
    setChartHover({
      frame: f,
      index: bestIdx,
      time: f.time_s,
      x: getChartX(f.time_s),
    });
  };

  const handleChartClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartFrames.length || !videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (relX - (chartPadL * rect.width) / chartSvgW) / ((chartPlotW * rect.width) / chartSvgW)));
    const targetTime = ratio * chartMaxTime;
    videoRef.current.currentTime = targetTime;
    syncMediaTime();
  };

  const classEntries = Object.entries(classBreakdown || {})
    .filter(([, count]) => (count as number) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number));

  // Sampled aggregate increments do not establish individual passage times.
  const recentEvents: Array<{time_s:number;cumulative:number;headway_s:null;active_count:number;dominantClass:string;laneBand:string}>=[];
  const dominantLane="Unavailable";
  const platoonMode="Unavailable";

  const currentDetections = activeFrameData?.detections || [];

  return (
    <div className="vision-container" data-testid="vision-analytics-panel">
      {/* Header Banner & PRD Disclaimers */}
      <section className="vision-header" aria-labelledby="vision-title">
        <div className="vision-header-top">
          <div className="vision-title-group">
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#38bdf8", textTransform: "uppercase", letterSpacing: "1px" }}>
              COMPUTER VISION EDGE ANALYTICS · {selectedCamera} · {streamRole.label.toUpperCase()}
            </span>
            <h1 id="vision-title" style={{ fontSize: "20px", fontWeight: 700, margin: "4px 0", color: "#f8fafc" }}>
              Sample Video Feed &amp; Traffic State Extraction
            </h1>
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>
              {activeCamInfo.approach} · {streamRole.description}
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <Button
              variant="outline"
              onClick={() => setIsOffline(true)}
              aria-label="Simulate Offline Pipeline State"
            >
              <VideoOff size={14} /> Simulate Offline
            </Button>
            {onReturn && (
              <Button
                variant="outline"
                onClick={onReturn}
                aria-label="Return to Command Center"
              >
                Command Center <ArrowRight size={14} />
              </Button>
            )}
          </div>
        </div>

        {/* PRD Disclaimers */}
        <div className="vision-disclaimer-strip" role="region" aria-label="Legal & Operational Disclaimers">
          <span className="vision-badge vision-badge-warning">
            <AlertTriangle size={12} /> NON-ODISHA SAMPLE VIDEO FEED
          </span>
          <span className="vision-badge vision-badge-primary">
            <ShieldCheck size={12} /> AGGREGATES ONLY · NO PERSISTED TRACK IDENTITIES
          </span>
          <span className="vision-badge vision-badge-primary">
            <Compass size={12} /> CORE SCENARIOS OPERATE INDEPENDENTLY
          </span>
          <span className="vision-badge vision-badge-warning">UNCALIBRATED SPEED: UNAVAILABLE · recorded footage is not an authoritative km/h source</span>
        </div>

        {/* 12-VIDEO STREAM DROPDOWN SELECTOR */}
        <div
          style={{
            marginTop: "12px",
            marginBottom: "6px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            background: "rgba(15, 23, 42, 0.75)",
            padding: "10px 14px",
            borderRadius: "8px",
            border: "1px solid #1e293b",
          }}
        >
          <label
            htmlFor="video-feed-select"
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "#38bdf8",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              whiteSpace: "nowrap",
            }}
          >
            Select analyzed video segment (registered cameras):
          </label>
          <select
            id="video-feed-select"
            aria-label="Select analyzed video segment (registered cameras)"
            value={selectedCamera}
            onChange={(e) => setSelectedCamera(e.target.value)}
            style={{
              flex: 1,
              minWidth: "280px",
              background: "#090d13",
              color: "#f1f5f9",
              border: "1px solid #3b82f6",
              borderRadius: "6px",
              padding: "7px 12px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              outline: "none",
              boxShadow: "0 0 10px rgba(59, 130, 246, 0.15)",
            }}
          >
            {cameraSlots.map((cam, idx) => (
              <option key={cam.id} value={cam.id}>
                {`Video ${String(idx + 1).padStart(2, "0")}: ${cam.id} — ${cam.approach} (${cam.videoFile} · ${cam.resolution})`}
              </option>
            ))}
          </select>
        </div>

        {/* Quick Camera Buttons & Dual-Mode Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", marginTop: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#8da5b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Active Camera:
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }} role="group" aria-label="Camera Selector">
              {cameraSlots.map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => setSelectedCamera(cam.id)}
                  aria-pressed={selectedCamera === cam.id}
                  className={`vision-toggle-btn ${selectedCamera === cam.id ? "active" : ""}`}
                  style={{ minHeight: "28px", padding: "2px 8px", fontSize: "11px" }}
                >
                  {cam.id}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#8da5b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Processing Mode:
            </span>
            <div style={{ display: "flex", gap: "4px" }} role="group" aria-label="Processing Mode Selector">
              <button
                type="button"
                aria-pressed={processingMode === "cached_observations"}
                className={`vision-toggle-btn ${processingMode === "cached_observations" ? "active" : ""}`}
                style={{ minHeight: "28px", padding: "2px 8px", fontSize: "11px" }}
              >
                Cached Observations (ITD v1.2)
              </button>
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>Online inference requires a running vision job; CPU benchmark is below real-time.</span>
            </div>
          </div>
        </div>

        {frame?.demand_source === "video_profile" && boundaryMapping[selectedCamera] ? (
          <p className="field-hint">Observations are bound to the active recorded-input run. Playback selection changes no run input.</p>
        ) : (
          <label className="field-hint">Observation source session
            <select aria-label="Observation source session" value={sourceSessions[selectedCamera] || ""} disabled={!onSelectSourceSession}
              onChange={event=>onSelectSourceSession?.(selectedCamera,event.target.value)}>
              <option value="">Select finalized observations</option>
              {processedClips.filter(clip=>clip.camera_id===selectedCamera && clip.status==="cached_valid" && (!frame?.config_hash || clip.config_hash===frame.config_hash)).map(clip=>(
                <option key={clip.source_session_id} value={clip.source_session_id}>{clip.source_session_id.slice(0,12)} · config {clip.config_hash.slice(0,8)} · {clip.window_count} windows</option>
              ))}
            </select>
          </label>
        )}

        {/* PRD §19.3 Authority Classification Strip */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px", fontSize: "10px" }} role="region" aria-label="Authority Classification">
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(16, 185, 129, 0.12)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
            <strong>OBSERVED FROM VIDEO:</strong> {selectedCamera} 5s Windows
          </span>
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(59, 130, 246, 0.12)", color: "#3b82f6", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
            <strong>VIDEO STREAM SCOPE:</strong> {streamRole.networkUse}
          </span>
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(168, 85, 247, 0.12)", color: "#a855f7", border: "1px solid rgba(168, 85, 247, 0.3)" }}>
            <strong>MODELED NETWORK STATE:</strong> Conserved CTM Cells
          </span>
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
            <strong>FORECAST:</strong> EWMA Horizons
          </span>
        </div>
      </section>

      {/* Main Grid: Video Player on Left, Metrics on Right */}
      <div className="vision-main-grid">
        {/* LEFT COLUMN: Video Viewport & Corridor Radar */}
        <div className="vision-video-col">
          <section className="vision-video-panel" aria-label="Camera Video Viewport">
          <div className="vision-video-header">
            <div className="vision-video-header-title">
              <Video size={16} color="#64b5f6" aria-hidden="true" />
              <span>Camera {selectedCamera} ({activeCamInfo.approach})</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                className={`vision-badge ${isPlaying ? "vision-badge-success" : "vision-badge-neutral"}`}
                style={{ fontSize: "10px" }}
              >
                {isPlaying ? "RECORDED LOOP · DISPLAY ONLY" : "PAUSED"}
              </span>
              <span style={{ fontSize: "11px", color: "#8ea3b3", fontVariantNumeric: "tabular-nums" }}>
                {activeFrameData ? `Sample ${currentFrameIdx + 1} / ${totalFrames}` : "Detection unavailable"}
              </span>
            </div>
          </div>

            <span role="status" className="text-xs text-muted-foreground">
              {annotationURL ? `Vehicle annotation preview · ${annotationManifest.sample_fps.toFixed(1)} samples/s · provisional detector output` : "Vehicle annotations unavailable for this clip"}
            </span>
          <div className="vision-canvas-wrapper" style={{ position: "relative", aspectRatio: `${mediaSize.width} / ${mediaSize.height}`, width: `min(100%, ${640 * mediaSize.width / mediaSize.height}px)` }}>
            <video
              ref={videoRef}
              aria-label="Recorded clip display only"
              data-media-ready={mediaReady}
              src={mediaURL}
              muted
              playsInline
              loop
              preload="auto"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (video.videoWidth && video.videoHeight) setMediaSize(canvasSize(video.videoWidth, video.videoHeight));
                video.playbackRate = playbackSpeed;
                if (isPlaying) safePlayVideo(video); else safePauseVideo(video);
                syncMediaTime();
              }}
              onLoadedData={() => setMediaReady(true)}
              onTimeUpdate={syncMediaTime}
              onSeeked={syncMediaTime}
              onError={() => { setMediaError(true); setMediaReady(false); }}
              style={{ display: "none" }}
            />
            <canvas
              ref={canvasRef}
              width={mediaSize.width}
              height={mediaSize.height}
              className="vision-canvas"
              aria-label="Computer vision video stream showing lane polygons, queue detection zone, and counting line."
            />
            {mediaError && <p role="alert">Registered MP4 could not be loaded for {selectedCamera}.</p>}
          </div>

          {/* Video Toolbar: Layer Toggles & Transport Controls */}
          <div className="vision-toolbar">
            <div className="vision-toggles-row">
              <span style={{ fontSize: "11px", fontWeight: 600, color: "#8da5b8", textTransform: "uppercase" }}>
                Overlays:
              </span>
              <button
                type="button"
                className={`vision-toggle-btn ${showLanes ? "active" : ""}`}
                onClick={() => setShowLanes(!showLanes)}
                aria-pressed={showLanes}
              >
                Lane Polygons
              </button>
              <button
                type="button"
                className={`vision-toggle-btn ${showCountingLine ? "active" : ""}`}
                onClick={() => setShowCountingLine(!showCountingLine)}
                aria-pressed={showCountingLine}
              >
                Counting Line
              </button>
              <button
                type="button"
                className={`vision-toggle-btn ${showQueueROI ? "active" : ""}`}
                onClick={() => setShowQueueROI(!showQueueROI)}
                aria-pressed={showQueueROI}
              >
                Queue ROI Zone
              </button>
            </div>

            {/* Transport controls and scrubber */}
            <div className="vision-transport-row">
              <button
                type="button"
                className="vision-transport-btn"
                onClick={() => {
                  const next = !isPlaying;
                  setIsPlaying(next);
                  if (videoRef.current) {
                    if (next) safePlayVideo(videoRef.current);
                    else safePauseVideo(videoRef.current);
                  }
                }}
                aria-label={isPlaying ? "Pause video" : "Play video"}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>

              <button
                type="button"
                className="vision-transport-btn"
                onClick={() => {
                  const prev = Math.max(0, currentFrameIdx - 1);
                  setCurrentFrameIdx(prev);
                  if (videoRef.current) {
                    videoRef.current.currentTime = activeTelemetry?.frames?.[prev]?.time_s ?? 0;
                  }
                }}
                aria-label="Step back one frame"
                title="Step back 1 frame (Left Arrow)"
              >
                <SkipBack size={16} />
              </button>

              <button
                type="button"
                className="vision-transport-btn"
                onClick={() => {
                  const next = Math.min(totalFrames - 1, Math.max(0, currentFrameIdx + 1));
                  setCurrentFrameIdx(next);
                  if (videoRef.current) {
                    videoRef.current.currentTime = activeTelemetry?.frames?.[next]?.time_s ?? 0;
                  }
                }}
                aria-label="Step forward one frame"
                title="Step forward 1 frame (Right Arrow)"
              >
                <SkipForward size={16} />
              </button>

              <button
                type="button"
                className="vision-transport-btn"
                onClick={() => {
                  setCurrentFrameIdx(0);
                  if (videoRef.current) videoRef.current.currentTime = 0;
                }}
                aria-label="Reset video to frame 0"
                title="Reset to beginning"
              >
                <RotateCcw size={16} />
              </button>

              {/* Speed Buttons */}
              <div style={{ display: "flex", gap: "4px" }}>
                {[0.5, 1.0, 2.0].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    className={`vision-toggle-btn ${playbackSpeed === spd ? "active" : ""}`}
                    style={{ minHeight: "32px", padding: "4px 8px", fontSize: "11px" }}
                    onClick={() => {
                      setPlaybackSpeed(spd);
                      if (videoRef.current) videoRef.current.playbackRate = spd;
                    }}
                    aria-pressed={playbackSpeed === spd}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Corridor Micro-Radar & Virtual Sensor Gate */}
        <section className="vision-card vision-radar-panel" role="region" aria-label="Corridor Micro-Radar and Sensor Gate">
          <div className="vision-card-header" style={{ marginBottom: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Radio size={16} color="#38bdf8" />
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                {selectedCamera} Corridor Micro-Radar &amp; Sensor Gate
              </h3>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className={`vision-badge ${crossingPulse ? "vision-badge-warning" : "vision-badge-success"}`} style={{ fontSize: "10px" }}>
                {crossingPulse ? "● AGGREGATE COUNT UPDATED" : "● INDIVIDUAL PASSAGES UNAVAILABLE"}
              </span>
              <span className="vision-badge vision-badge-primary" style={{ fontSize: "10px" }}>
                LIVE 2D ORTHOGRAPHIC
              </span>
            </div>
          </div>
          <p style={{ fontSize: "11px", color: "#8da5b8", margin: "0 0 4px 0" }}>
            Schematic aggregate display only. Calibrated road positions and individual passage times are unavailable.
          </p>

          <div className="vision-radar-grid">
            {/* SUB-COLUMN 1: TOP-DOWN ORTHOGRAPHIC RADAR */}
            <div className="vision-radar-subcol">
              <div className="vision-radar-subcol-title">
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>CORRIDOR ORTHOGRAPHIC RADAR</span>
                  <span style={{ fontSize: "9px", padding: "1px 5px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", borderRadius: "3px", border: "1px solid rgba(16, 185, 129, 0.3)", fontWeight: 700 }}>
                    INDIAN LHT (DRIVE ON LEFT)
                  </span>
                </div>
                <span style={{ fontSize: "10px", color: "#38bdf8", fontWeight: 600 }}>
                  Individual positions unavailable
                </span>
              </div>

              <div className="vision-radar-svg-wrap">
                <svg viewBox="0 0 320 200" width="100%" height="100%" style={{ display: "block" }}>
                  {/* Road Surface */}
                  <polygon points="35,15 285,15 295,185 25,185" fill="#0b121a" stroke="#1e2c3d" strokeWidth="1.5" />

                  {/* Lane Divider Lines */}
                  <line x1="118" y1="15" x2="115" y2="185" stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1.2" />
                  <line x1="202" y1="15" x2="205" y2="185" stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1.2" />

                  {/* Lane Labels: Indian Standard (Left: Outbound/Jaane wala ↑, Right: Inbound/Aane wala ↓) */}
                  <text x="76" y="24" textAnchor="middle" fill="#64748b" fontSize="7" fontWeight="700">LEFT · JAANE WALA ↑</text>
                  <text x="160" y="24" textAnchor="middle" fill="#475569" fontSize="7" fontWeight="600">MEDIAN / DIVIDER</text>
                  <text x="244" y="24" textAnchor="middle" fill="#38bdf8" fontSize="7" fontWeight="700">RIGHT · AANE WALA ↓</text>

                  {/* Flow Direction Indicators (Indian LHT Standard: Left side heads UP ↑ away, Right side heads DOWN ↓ towards) */}
                  <path d="M 76,55 L 76,43 M 73,46 L 76,43 L 79,46" stroke="#10b981" strokeWidth="1.5" fill="none" />
                  <path d="M 160,45 L 160,55 M 157,52 L 160,55 L 163,52" stroke="#334155" strokeWidth="1.2" fill="none" />
                  <path d="M 244,43 L 244,55 M 241,52 L 244,55 L 247,52" stroke="#38bdf8" strokeWidth="1.5" fill="none" />

                  {/* Queue Storage Zone */}
                  <polygon points="31,95 289,95 294,165 26,165" fill="rgba(168, 85, 247, 0.10)" stroke="rgba(192, 132, 252, 0.35)" strokeWidth="1" strokeDasharray="2 2" />
                  <text x="34" y="107" fill="#c084fc" fontSize="8" fontWeight="600" opacity="0.9">QUEUE ROI ZONE</text>

                  {/* Virtual Counting Gate Line */}
                  <line
                    x1="25"
                    y1="168"
                    x2="295"
                    y2="168"
                    stroke={crossingPulse ? "#fbbf24" : "#f59e0b"}
                    strokeWidth={crossingPulse ? 3.5 : 2}
                  />
                  <circle cx="25" cy="168" r="3" fill="#f59e0b" />
                  <circle cx="295" cy="168" r="3" fill="#f59e0b" />
                  <text x="160" y="179" textAnchor="middle" fill="#f59e0b" fontSize="8" fontWeight="700">
                    COUNTING LINE GATE ↓
                  </text>

                  {/* Real-time Scanning Radar Sweep Line */}
                  <line
                    x1="20"
                    y1={(mediaTime * 30) % 165 + 15}
                    x2="300"
                    y2={(mediaTime * 30) % 165 + 15}
                    stroke="rgba(56, 189, 248, 0.22)"
                    strokeWidth="1.5"
                  />

                  {/* Active Tracked Vehicles Plotted on Radar */}
                  {currentDetections.map((det: any, idx: number) => {
                    const cx = det.centroid ? det.centroid[0] : (det.bbox ? (det.bbox[0] + det.bbox[2]) / 2 : 0.5);
                    const cy = det.centroid ? det.centroid[1] : (det.bbox ? (det.bbox[1] + det.bbox[3]) / 2 : 0.5);
                    const vx = 35 + cx * 250;
                    const vy = 20 + cy * 145;
                    const color = RADAR_CLASS_COLORS[det.class] || "#3b82f6";
                    const isBike = det.class === "two_wheeler" || det.class === "bicycle";
                    const isHeavy = det.class === "bus" || det.class === "truck";
                    const vw = isBike ? 6 : isHeavy ? 12 : 9;
                    const vh = isBike ? 10 : isHeavy ? 17 : 13;

                    return (
                      <g key={`det-${idx}-${det.id ?? idx}`}>
                        {/* Motion Trail */}
                        {det.trail && det.trail.length > 1 && (
                          <polyline
                            points={det.trail.map(([tx, ty]: [number, number]) => `${(35 + tx * 250).toFixed(1)},${(20 + ty * 145).toFixed(1)}`).join(" ")}
                            fill="none"
                            stroke={color}
                            strokeWidth="1.2"
                            strokeDasharray="2 2"
                            opacity="0.5"
                          />
                        )}

                        {/* Queue Pulse Halo */}
                        {det.in_queue && (
                          <circle
                            cx={vx}
                            cy={vy}
                            r={Math.max(vw, vh) * 0.85}
                            fill="none"
                            stroke="#c084fc"
                            strokeWidth="1.5"
                            strokeDasharray="2 2"
                          />
                        )}

                        {/* Crossed Glow Halo */}
                        {det.has_crossed && (
                          <circle
                            cx={vx}
                            cy={vy}
                            r={Math.max(vw, vh) * 0.9}
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="1.5"
                          />
                        )}

                        {/* Vehicle Body Blip */}
                        <rect
                          x={vx - vw / 2}
                          y={vy - vh / 2}
                          width={vw}
                          height={vh}
                          rx="2"
                          fill={color}
                          stroke="#06090e"
                          strokeWidth="1.5"
                        />

                        {/* Class Mini Label */}
                        <text
                          x={vx + vw / 2 + 3}
                          y={vy + 3}
                          fill="#cbd5e1"
                          fontSize="7"
                          fontFamily="monospace"
                          fontWeight="600"
                        >
                          {displayVehicleClass(det.class).slice(0, 4).toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="vision-radar-kpi-bar">
                <span>Outbound positions: <strong>Unavailable</strong></span>
                <span>Inbound positions: <strong>Unavailable</strong></span>
                <span>Crossed Gate: <strong>{displayCrossed}</strong></span>
              </div>
            </div>

            {/* SUB-COLUMN 2: VIRTUAL SENSOR GATE & MICRO-HEADWAY LOG */}
            <div className="vision-radar-subcol">
              <div className="vision-radar-subcol-title">
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Zap size={14} color="#f59e0b" />
                  <span>FINALIZED COUNT AGGREGATES</span>
                  <span style={{ fontSize: "9px", padding: "1px 5px", background: "rgba(56, 189, 248, 0.12)", color: "#38bdf8", borderRadius: "3px", border: "1px solid rgba(56, 189, 248, 0.25)", fontWeight: 700 }}>
                    LHT TRAFFIC
                  </span>
                </div>
                <span style={{ fontSize: "10px", color: crossingPulse ? "#fbbf24" : "#10b981", fontWeight: 700 }}>
                  {crossingPulse ? "AGGREGATE UPDATE" : "AGGREGATE DISPLAY"}
                </span>
              </div>

              <div className="vision-gate-metrics-grid">
                <div className="vision-gate-metric-box">
                  <span className="vision-gate-metric-label">Individual headway unavailable</span>
                  <span className="vision-gate-metric-val">
                    {"—"}
                  </span>
                  <span className="vision-gate-metric-sub">Sampled aggregates cannot establish passage gaps</span>
                </div>

                <div className="vision-gate-metric-box">
                  <span className="vision-gate-metric-label">Platoon Mode</span>
                  <span className="vision-gate-metric-val" style={{ fontSize: "13px", color: "#38bdf8" }}>
                    {platoonMode}
                  </span>
                  <span className="vision-gate-metric-sub">Individual passage timing unavailable</span>
                </div>

                <div className="vision-gate-metric-box">
                  <span className="vision-gate-metric-label">Gate Crossings</span>
                  <span className="vision-gate-metric-val" style={{ color: "#f59e0b" }}>
                    {displayCrossed} veh
                  </span>
                  <span className="vision-gate-metric-sub">Serviced past line</span>
                </div>

                <div className="vision-gate-metric-box">
                  <span className="vision-gate-metric-label">Dominant Lane</span>
                  <span className="vision-gate-metric-val" style={{ fontSize: "13px" }}>
                    {dominantLane.replace(" ROI band", "")}
                  </span>
                  <span className="vision-gate-metric-sub">Highest corridor load</span>
                </div>
              </div>

              {/* Recent Crossings Chronological Ticker */}
              <div style={{ marginTop: "4px" }}>
                <span style={{ fontSize: "10px", fontWeight: 700, color: "#8da5b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Individual passage records unavailable:
                </span>
                <div className="vision-events-log-container">
                  {recentEvents.length > 0 ? (
                    recentEvents.map((ev, i) => {
                      const meta = ROUTE_CLASS_META[ev.dominantClass] || { label: ev.dominantClass, color: "#94a3b8", bg: "rgba(148, 163, 184, 0.1)" };
                      return (
                        <div className="vision-event-item" key={`ev-${ev.time_s}-${i}`}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontFamily: "monospace", color: "#38bdf8", fontWeight: 700, fontSize: "10px" }}>
                              @{ev.time_s.toFixed(2)}s
                            </span>
                            <span className="vision-event-badge" style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}40` }}>
                              {meta.label}
                            </span>
                            <span style={{ color: "#94a3b8", fontSize: "10px" }}>
                              {ev.laneBand}
                            </span>
                          </div>
                          <span style={{ color: "#f59e0b", fontFamily: "monospace", fontWeight: 600, fontSize: "10px" }}>
                            {"Individual timing unavailable"}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="vision-empty-events">
                      Individual passage events unavailable · aggregate window counts only
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Diagnostic & Optical Geometry Ribbon */}
          <div className="vision-radar-diag-ribbon">
            <div className="vision-radar-diag-item">
              <Gauge size={12} color="#64748b" />
              <span>Sensor: <strong>{selectedCamera}-VIRT-GATE</strong></span>
            </div>
            <div className="vision-radar-diag-item">
              <span>Model: <strong>ITD v1.2 YOLOv8 + ByteTrack</strong></span>
            </div>
            <div className="vision-radar-diag-item">
              <span>Sampling: <strong>2.0 Hz (0.5s intervals)</strong></span>
            </div>
            <div className="vision-radar-diag-item">
              <span>Calibration: <strong>Corridor ROI Polygon</strong></span>
            </div>
          </div>
        </section>
      </div>

      {/* RIGHT: Realtime Aggregates Column */}
      <div className="vision-metrics-col">
          {/* Selected-stream dashboard — changes with every camera switch. */}
          <div className="vision-card vision-stream-dashboard" role="region" aria-label={`${selectedCamera} stream dashboard`}>
            <div className="vision-card-header">
              <h3>
                <Layers size={16} color="#64b5f6" aria-hidden="true" />
                {selectedCamera} Stream Dashboard
              </h3>
              <span className="vision-stream-role">{streamRole.label}</span>
            </div>
            <div className="vision-stream-kpis">
              <div><span>Active vehicles</span><strong>{activeFrameData ? displayActiveVehicles : "—"}</strong><small>tracked in frame</small></div>
              <div><span>Queue ROI</span><strong>{displayQueueVehicles ?? "—"}</strong><small>observed vehicles</small></div>
              <div><span>Line flow</span><strong>{observedFlowVpm == null ? "—" : observedFlowVpm.toFixed(1)}</strong><small>{observedFlowVpm == null ? "window not ready" : "vpm · observed"}</small></div>
            </div>
            <p className="vision-stream-coverage">{coverageLabel} · {activeCamInfo.fps} source FPS · {displayURL ? "15 FPS display copy; original preserved · " : ""}{activeCamInfo.videoFile}</p>
          </div>

          <div className="vision-card vision-live-insights" role="region" aria-label={`${selectedCamera} live frame insights`}>
            <div className="vision-card-header">
              <h3>
                <Activity size={16} color="#64b5f6" aria-hidden="true" />
                Recorded Frame Insights
              </h3>
              <span style={{ fontSize: "11px", color: "#8da5b8" }}>{mediaTime.toFixed(2)}s</span>
            </div>
            <div className="vision-stream-kpis">
              <div><span>Queue pressure</span><strong>{displayQueueVehicles !== null ? `${(queuePressure * 100).toFixed(2)}%` : "—"}</strong><small>{queuePressureLabel}</small></div>
              <div><span>Dominant type</span><strong>{displayVehicleClass(String(dominantClass))}</strong><small>{activeFrameData ? Number(dominantClassCount) : "—"} aggregate class count</small></div>
              <div><span>Detected classes</span><strong>{activeFrameData ? Object.keys(activeClassCounts).length : "—"}</strong><small>in this camera frame</small></div>
              <div><span>Pedestrians now</span><strong>{activeFrameData ? activeClassCounts.pedestrain ?? 0 : "—"}</strong><small>in this camera frame</small></div>
            </div>
          </div>

          <div className="vision-card" role="region" aria-label={`${selectedCamera} finalized ITD observation`}>
            <div className="vision-card-header"><h3>ITD 5-second flow detection</h3></div>
            <p className="vision-roi-note">Observation source: {observationStatus.replaceAll("_", " ")} · cached registered clip · {observationReason || "Display seek does not change the run input"}</p>
            {currentObservation ? <div className="vision-stream-kpis">
              <div><span>Window</span><strong>{currentObservation.window_start_s}–{currentObservation.window_end_s}s</strong><small>{currentObservation.observation_status}</small></div>
              <div><span>Directional crossings</span><strong>{currentObservation.crossings_veh ?? "—"}</strong><small>{currentObservation.direction_id ?? "unknown direction"}</small></div>
              <div><span>Flow</span><strong>{currentObservation.observation_status === "valid" ? Number(currentObservation.flow_vpm).toFixed(2) : "—"}</strong><small>veh/min · finalized</small></div>
            </div> : <p className="vision-roi-note">No completed observation window at this media time. Vehicle annotations require a verified preview for this clip.</p>}
            {currentObservation && <p className="vision-roi-note">Available at source {Number(currentObservation.available_at_source_s).toFixed(2)} s · processing completed {currentObservation.processed_at_utc} · {currentObservation.validation_level || "review level unavailable"}</p>}
            {currentObservation?.derivation && <p className="vision-roi-note">Provenance: derived from cached ITD frame telemetry; per-class crossing counts unavailable.</p>}
          </div>

          {/* Vehicle Class Breakdown (PRD §15.2) */}
          <div className="vision-card" role="region" aria-label="Vehicle Class Distribution">
            <div className="vision-card-header">
              <h3>
                <Car size={16} color="#64b5f6" aria-hidden="true" />
                {activeTelemetry ? `Class Breakdown (${displayTotalVehicles} vehicles · ${classBreakdown.pedestrain ?? 0} pedestrians)` : "Class Breakdown unavailable"}
              </h3>
              <span style={{ fontSize: "11px", color: "#8da5b8" }}>
                Crossed: {activeFrameData ? displayCrossed : "—"}
              </span>
            </div>
            <div className="vision-classes-grid">
              {(() => {
                const CLASS_DISPLAY: Record<string, { label: string; color: string }> = {
                  two_wheeler: { label: "Bike", color: "#10b981" },
                  car: { label: "Car", color: "#3b82f6" },
                  autorickshaw: { label: "Auto", color: "#f59e0b" },
                  bus: { label: "Bus", color: "#ef4444" },
                  truck: { label: "Truck", color: "#a855f7" },
                  lcv: { label: "LCV", color: "#06b6d4" },
                  pedestrain: { label: "Pedestrian", color: "#ec4899" },
                  bicycle: { label: "Bicycle", color: "#84cc16" },
                };
                const entries = Object.entries(classBreakdown || {}).sort(([, a], [, b]) => (b as number) - (a as number));
                if (entries.length === 0) {
                  return Object.entries(CLASS_DISPLAY).map(([key, meta]) => (
                    <div className="vision-class-item" key={key}>
                      <span className="vision-class-label">{meta.label}</span>
                      <span className="vision-class-count" style={{ color: meta.color }}>—</span>
                    </div>
                  ));
                }
                return entries.map(([cls, count]) => {
                  const meta = CLASS_DISPLAY[cls] || { label: cls.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), color: "#94a3b8" };
                  return (
                    <div className="vision-class-item" key={cls}>
                      <span className="vision-class-label">{meta.label}</span>
                      <span className="vision-class-count" style={{ color: meta.color }}>{count as number}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Selected-stream ROI activity table. It deliberately avoids calling
              video zones calibrated physical lanes. */}
          <div className="vision-card" role="region" aria-label="Lane-Wise Traffic Metrics">
            <div className="vision-card-header">
              <h3>
                <Activity size={16} color="#64b5f6" aria-hidden="true" />
                {selectedCamera} ROI Activity Assignment
              </h3>
              <span style={{ fontSize: "11px", color: "#8da5b8" }}>{activeFrameData ? `Sample ${currentFrameIdx + 1}` : "Detection unavailable"} · 3 ROI bands</span>
            </div>
            <table className="vision-lane-table">
              <thead>
                <tr>
                  <th scope="col">ROI band</th>
                  <th scope="col">Active</th>
                  <th scope="col">Queue est.</th>
                  <th scope="col">Activity share</th>
                </tr>
              </thead>
              <tbody>
                {laneMetrics.map((lane) => (
                  <tr key={lane.id}>
                    <td>{lane.label}</td>
                    <td>{activeFrameData && activeFrameData.detections ? lane.active : "—"}</td>
                    <td>{activeFrameData && activeFrameData.detections ? `${lane.queue} veh` : "—"}</td>
                    <td>{activeFrameData && activeFrameData.detections ? `${(lane.share * 100).toFixed(2)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="vision-roi-note">Queue estimates are apportioned from this stream&apos;s aggregate queue ROI; they are not calibrated lane measurements.</p>
          </div>
        </div>
      </div>

      {/* Route Flow Detection & Traffic Dynamics Analysis */}
      <section
        className="vision-upstream-card"
        role="region"
        aria-label="ITD flow detection by recorded camera"
      >
        <div className="vision-route-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
              <h2 id="upstream-heading" style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#e5edf5" }}>
                ITD v1.2 Route Flow &amp; Traffic Dynamics · {selectedCamera}
              </h2>
              <span className="vision-badge vision-badge-success">RECORDED LOOP · DISPLAY ONLY</span>
              <span className="vision-badge vision-badge-primary">
                {activeCamInfo.role === "external_boundary_input"
                  ? "BOUNDARY DEMAND INPUT"
                  : activeCamInfo.role === "internal_link_observation"
                  ? "INTERNAL CORRIDOR LINK"
                  : "BENCHMARK SAMPLE"}
              </span>
            </div>
            <p style={{ fontSize: "12px", color: "#8da5b8", margin: 0 }}>
              {activeCamInfo.approach} · {streamRole.description} Display loops do not add virtual traffic.
            </p>
          </div>

          {/* Route & Camera Selector Dropdown */}
          <div className="vision-route-select-box">
            <label htmlFor="itd-route-dropdown" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "#38bdf8", whiteSpace: "nowrap" }}>
              <Layers size={14} />
              <span>Route / Camera:</span>
            </label>
            <select
              id="itd-route-dropdown"
              aria-label="Select camera route for flow detection summary"
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              className="vision-route-dropdown-select"
            >
              {cameraSlots.map((camera) => {
                const item = telemetryMap[camera.id];
                const count = item?.summary?.total_unique_vehicles ?? "—";
                const roleTag = camera.role === "external_boundary_input" ? "Boundary" : camera.role === "internal_link_observation" ? "Internal" : "Aux";
                return (
                  <option key={camera.id} value={camera.id}>
                    {camera.id} · {camera.approach} ({roleTag} · {count} veh)
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Selected Route Record Summary */}
        <div className="vision-upstream-grid">
          <div className="vision-upstream-box">
            <span className="vision-upstream-box-label">Monitored Route &amp; Role</span>
            <span className="vision-upstream-box-val" style={{ fontSize: "16px", lineHeight: "1.3" }}>
              {activeCamInfo.approach}
            </span>
            <span className="vision-upstream-box-sub">
              {streamRole.networkUse} · {activeCamInfo.resolution}
            </span>
          </div>

          <div className="vision-upstream-box">
            <span className="vision-upstream-box-label">Observed Unique Vehicles</span>
            <span className="vision-upstream-box-val">
              {activeTelemetry ? `${displayTotalVehicles} veh` : "—"}
            </span>
            <span className="vision-upstream-box-sub">
              {activeTelemetry?.summary?.total_crossed ?? "—"} detector-estimated crossings · {activeTelemetry?.summary?.total_unique_pedestrians ?? "—"} ped
            </span>
          </div>

          <div className="vision-upstream-box">
            <span className="vision-upstream-box-label">Observed Segment Flow</span>
            <span className="vision-upstream-box-val">
              {streamFlowRate != null ? `${streamFlowRate.toFixed(2)} vpm` : "—"}
            </span>
            <span className="vision-upstream-box-sub">
              {streamFlowRate != null ? "Throughput over analyzed segment" : "Flow unavailable"}
            </span>
          </div>

          <div className="vision-upstream-box">
            <span className="vision-upstream-box-label">Peak Density &amp; Queue</span>
            <span className="vision-upstream-box-val">
              {activeTelemetry ? `${peakActiveVehicles} / ${peakQueueVehicles ?? "—"}` : "—"}
            </span>
            <span className="vision-upstream-box-sub">
              Peak active / peak queue in ROI
            </span>
          </div>
        </div>

        {/* Route-Specific Traffic Dynamics & Detection Summary Graph */}
        <div className="vision-chart-container" role="region" aria-label={`Traffic analysis time series for ${selectedCamera}`}>
          <div className="vision-chart-topbar">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Activity size={15} color="#38bdf8" />
                <h3 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "#f1f5f9" }}>
                  {selectedCamera} Corridor Dynamics &amp; Vehicle Accumulation Profile
                </h3>
              </div>
              <span style={{ fontSize: "11px", color: "#64748b" }}>
                Continuous time-series analysis (density, queue formation &amp; throughput) · Click chart to scrub video
              </span>
            </div>

            {/* Legend & Hover / Playhead Status */}
            <div className="vision-chart-legend">
              <div className="vision-chart-legend-item">
                <span className="vision-chart-legend-dot" style={{ background: "#10b981" }} />
                <span>Active Density</span>
              </div>
              <div className="vision-chart-legend-item">
                <span className="vision-chart-legend-dot" style={{ background: "#c084fc" }} />
                <span>Queue ROI Build-up</span>
              </div>
              <div className="vision-chart-legend-item">
                <span className="vision-chart-legend-dash" />
                <span>Line Crossings</span>
              </div>
              {chartHover ? (
                <div style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: "6px", padding: "3px 8px", color: "#38bdf8", fontSize: "11px", fontWeight: 600 }}>
                  @{chartHover.time.toFixed(2)}s: {chartHover.frame.active_count ?? 0} active · {chartHover.frame.queue_count ?? "unavailable"} queued · {chartHover.frame.cumulative_crossed ?? 0} crossed
                </div>
              ) : (
                <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid #334155", borderRadius: "6px", padding: "3px 8px", color: "#94a3b8", fontSize: "11px" }}>
                  Playhead: <strong style={{ color: "#38bdf8" }}>{mediaTime.toFixed(2)}s</strong>
                </div>
              )}
            </div>
          </div>

          {/* SVG Traffic Graph */}
          <div className="vision-chart-svg-wrap">
            <svg
              viewBox="0 0 800 200"
              width="100%"
              height="200"
              style={{ display: "block", overflow: "visible" }}
              onMouseMove={handleChartMouseMove}
              onMouseLeave={() => setChartHover(null)}
              onClick={handleChartClick}
            >
              <defs>
                <linearGradient id="chart-grad-active" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="chart-grad-queue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c084fc" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#c084fc" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Background gridlines & Y-axis labels */}
              {chartYTicks.map((tickVal) => {
                const y = getChartY(tickVal);
                return (
                  <g key={`ytick-${tickVal}`}>
                    <line x1={chartMinX} y1={y} x2={chartMaxX} y2={y} stroke="rgba(255, 255, 255, 0.07)" strokeDasharray="3 3" />
                    <text x={chartMinX - 8} y={y + 3} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">
                      {tickVal}
                    </text>
                  </g>
                );
              })}
              <text x={chartMinX - 8} y={chartMinY - 8} textAnchor="end" fill="#94a3b8" fontSize="10" fontWeight="600">
                veh
              </text>

              {/* X-axis time ticks */}
              {chartXTicks.map((t) => {
                const x = getChartX(t);
                return (
                  <g key={`xtick-${t}`}>
                    <line x1={x} y1={chartMinY} x2={x} y2={chartMaxY} stroke="rgba(255, 255, 255, 0.04)" />
                    <line x1={x} y1={chartMaxY} x2={x} y2={chartMaxY + 5} stroke="rgba(255, 255, 255, 0.2)" />
                    <text x={x} y={chartMaxY + 16} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="monospace">
                      {t}s
                    </text>
                  </g>
                );
              })}

              {/* Area & Line for Active Density */}
              {activeAreaD && <path d={activeAreaD} fill="url(#chart-grad-active)" />}
              {activePathD && <path d={activePathD} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

              {/* Area & Line for Queue Build-Up */}
              {queueAreaD && <path d={queueAreaD} fill="url(#chart-grad-queue)" />}
              {queuePathD && <path d={queuePathD} fill="none" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

              {/* Line for Cumulative Crossings */}
              {crossedPathD && <path d={crossedPathD} fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 3" />}

              {/* Real-time Video Playback Cursor Head */}
              {mediaReady && (
                <g>
                  <line
                    x1={chartPlayheadX}
                    y1={chartMinY - 4}
                    x2={chartPlayheadX}
                    y2={chartMaxY}
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeDasharray="none"
                  />
                  <polygon
                    points={`${chartPlayheadX - 5},${chartMinY - 6} ${chartPlayheadX + 5},${chartMinY - 6} ${chartPlayheadX},${chartMinY}`}
                    fill="#38bdf8"
                  />
                </g>
              )}

              {/* Hover Guide & Tooltip Cursor */}
              {chartHover && (
                <g>
                  <line
                    x1={chartHover.x}
                    y1={chartMinY}
                    x2={chartHover.x}
                    y2={chartMaxY}
                    stroke="#e2e8f0"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                  <circle cx={chartHover.x} cy={getChartY(chartHover.frame.active_count || 0)} r="4" fill="#10b981" stroke="#0b1118" strokeWidth="2" />
                  <circle cx={chartHover.x} cy={getChartY(chartHover.frame.queue_count || 0)} r="4" fill="#c084fc" stroke="#0b1118" strokeWidth="2" />
                  <circle cx={chartHover.x} cy={getChartY(chartHover.frame.cumulative_crossed || 0)} r="4" fill="#f59e0b" stroke="#0b1118" strokeWidth="2" />
                </g>
              )}

              {/* Interactive Scrubbing Click & Hover Capture Overlay */}
              <rect
                x={chartMinX}
                y={chartMinY}
                width={chartPlotW}
                height={chartPlotH}
                fill="transparent"
                style={{ cursor: "crosshair" }}
              />
            </svg>
          </div>

          {/* Fleet Modal Split / Class Composition Breakdown */}
          <div className="vision-fleet-strip">
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#8da5b8", alignSelf: "center", marginRight: "4px" }}>
              Route Fleet Split:
            </span>
            {classEntries.length > 0 ? (
              classEntries.map(([cls, count]) => {
                const meta = ROUTE_CLASS_META[cls] || { label: cls.replace(/_/g, " "), color: "#94a3b8", bg: "rgba(148, 163, 184, 0.1)" };
                const pct = displayTotalVehicles > 0 && cls !== "pedestrain"
                  ? Math.round(((count as number) / displayTotalVehicles) * 100)
                  : null;
                return (
                  <span
                    key={cls}
                    className="vision-fleet-pill"
                    style={{ background: meta.bg, borderColor: `${meta.color}40`, color: meta.color }}
                  >
                    <strong>{meta.label}:</strong> {count as number}
                    {pct !== null ? ` (${pct}%)` : ""}
                  </span>
                );
              })
            ) : (
              <span style={{ fontSize: "11px", color: "#64748b" }}>Fleet breakdown loading…</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
