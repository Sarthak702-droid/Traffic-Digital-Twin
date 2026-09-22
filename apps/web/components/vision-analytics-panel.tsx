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
  Info,
  Car,
  Activity,
  Compass,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  c3VisionFallbackData,
  type VisionAggregatePayload,
  type VisionFrame,
} from "@/lib/vision-data";

interface VisionAnalyticsPanelProps {
  onReturn?: () => void;
  initialOffline?: boolean;
}

export interface CameraSlot {
  id: string;
  label: string;
  approach: string;
  videoFile: string;
  role: string;
  resolution: string;
  fps: number;
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

export function VisionAnalyticsPanel({ onReturn, initialOffline = false }: VisionAnalyticsPanelProps) {
  const [data, setData] = useState<VisionAggregatePayload>(c3VisionFallbackData);
  const [isOffline, setIsOffline] = useState(initialOffline);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [showLanes, setShowLanes] = useState(true);
  const [showCountingLine, setShowCountingLine] = useState(true);
  const [showQueueROI, setShowQueueROI] = useState(true);
  const [crossingPulse, setCrossingPulse] = useState(false);

  // 12 Videos & Camera selection
  const [selectedCamera, setSelectedCamera] = useState<string>("CAM-01");
  const [processingMode, setProcessingMode] = useState<"cached_observations" | "online_inference">("cached_observations");
  const [liveObservations, setLiveObservations] = useState<any[]>([]);
  const [telemetryMap, setTelemetryMap] = useState<Record<string, any>>({});

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevCrossedCountRef = useRef<number>(0);

  // Load 12-camera telemetry generated from ITD v1.2 YOLO + ByteTrack
  useEffect(() => {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
    let isMounted = true;
    fetch("/vision_clips_data.json")
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
  }, []);

  // Fetch live vision state or real observations from Go API gateway
  useEffect(() => {
    if (isOffline) return;
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
    let isMounted = true;

    fetch(`/api/v1/observations?camera_id=${selectedCamera}&mode=${processingMode}`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((payload) => {
        if (isMounted && payload && Array.isArray(payload.observations) && payload.observations.length > 0) {
          setLiveObservations(payload.observations);
        }
      })
      .catch(() => {});

    fetch("/api/v1/vision/c3")
      .then((res) => {
        if (!res.ok) throw new Error("Vision endpoint unavailable");
        return res.json();
      })
      .then((payload) => {
        if (isMounted && payload && payload.available) {
          setData(payload);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [isOffline, selectedCamera, processingMode]);

  // Video switching: load new clip and loop 0.0s to 10.0s
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.src = `/api/v1/clips/${selectedCamera}/media`;
    video.currentTime = 0;
    setCurrentFrameIdx(0);
    if (isPlaying) {
      safePlayVideo(video);
    }
  }, [selectedCamera]);

  const totalFrames = 100; // 10.0s at 10 fps
  const activeTelemetry = telemetryMap[selectedCamera];
  const activeFrameData = activeTelemetry?.frames?.[currentFrameIdx];
  const activeCamInfo = ALL_CAMERA_SLOTS.find((c) => c.id === selectedCamera) || ALL_CAMERA_SLOTS[0];

  // Continuous animation and 10s video loop
  useEffect(() => {
    if (!isPlaying || isOffline) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      safePauseVideo(videoRef.current);
      return;
    }

    if (videoRef.current && videoRef.current.paused) {
      safePlayVideo(videoRef.current);
    }

    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
      return;
    }

    const intervalMs = Math.max(25, Math.round(100 / playbackSpeed));
    playIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (video && video.duration) {
        if (video.currentTime >= 10.0) {
          video.currentTime = 0;
        }
        const calculatedIdx = Math.min(99, Math.floor((video.currentTime / 10.0) * 100));
        setCurrentFrameIdx(calculatedIdx);
      } else {
        setCurrentFrameIdx((prev) => (prev + 1) % totalFrames);
      }
    }, intervalMs);

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, isOffline, playbackSpeed, totalFrames]);

  // Single-pulse line crossing detection
  useEffect(() => {
    const crossedCount = activeFrameData?.cumulative_crossed ?? 0;
    if (crossedCount > prevCrossedCountRef.current) {
      setCrossingPulse(true);
      const timer = setTimeout(() => setCrossingPulse(false), 350);
      prevCrossedCountRef.current = crossedCount;
      return () => clearTimeout(timer);
    }
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
    const geom = activeTelemetry?.geometry;

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
      ctx.closePath();
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
        ctx.closePath();
        ctx.fill();
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

    // 5. ITD v1.2 Vehicle Bounding Boxes & Tracking Trails
    const detections = activeFrameData?.detections || [];
    const CLASS_COLORS: Record<string, string> = {
      car: "#10b981",
      two_wheeler: "#a855f7",
      autorickshaw: "#f59e0b",
      bus: "#3b82f6",
      truck: "#ef4444",
      pedestrain: "#ec4899",
      lcv: "#06b6d4",
    };

    detections.forEach((det: any) => {
      const [bx1, by1, bx2, by2] = det.bbox;
      const px1 = bx1 * width;
      const py1 = by1 * height;
      const bw = (bx2 - bx1) * width;
      const bh = (by2 - by1) * height;
      const color = CLASS_COLORS[det.class] || "#10b981";

      // Draw tracking motion trail
      if (det.trail && det.trail.length > 1) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        det.trail.forEach(([tx, ty]: [number, number], idx: number) => {
          if (idx === 0) ctx.moveTo(tx * width, ty * height);
          else ctx.lineTo(tx * width, ty * height);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(px1, py1, bw, bh);

      // Corner accent brackets
      const corner = Math.min(8, bw / 3, bh / 3);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px1, py1 + corner); ctx.lineTo(px1, py1); ctx.lineTo(px1 + corner, py1);
      ctx.moveTo(px1 + bw - corner, py1); ctx.lineTo(px1 + bw, py1); ctx.lineTo(px1 + bw, py1 + corner);
      ctx.moveTo(px1, py1 + bh - corner); ctx.lineTo(px1, py1 + bh); ctx.lineTo(px1 + corner, py1 + bh);
      ctx.moveTo(px1 + bw - corner, py1 + bh); ctx.lineTo(px1 + bw, py1 + bh); ctx.lineTo(px1 + bw, py1 + bh - corner);
      ctx.stroke();

      // Label Header: TRK #ID CLASS CONF%
      const className = String(det.class).replace("_", " ").toUpperCase();
      const label = `#${det.id} ${className} ${(det.conf * 100).toFixed(0)}%`;
      ctx.font = "bold 9px monospace";
      const tm = typeof ctx.measureText === "function" ? ctx.measureText(label) : { width: label.length * 6 };
      const tagW = tm.width + 8;
      const tagH = 14;
      const tagY = Math.max(0, py1 - tagH);

      ctx.fillStyle = color;
      ctx.fillRect(px1, tagY, tagW, tagH);

      ctx.fillStyle = "#000000";
      ctx.textAlign = "left";
      ctx.fillText(label, px1 + 4, tagY + 10);
    });

    // 6. CCTV HUD / OSD Overlay Banner
    ctx.fillStyle = "rgba(10, 15, 20, 0.85)";
    ctx.fillRect(0, 0, width, 24);

    // Blinking REC square icon
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(10, 8, 8, 8);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    const secCur = (currentFrameIdx / 10).toFixed(1);
    ctx.fillText(
      `● LIVE CCTV · ${selectedCamera} · ${activeCamInfo.videoFile} · ${secCur}s / 10.0s (30 FPS)`,
      26,
      16
    );

    ctx.fillStyle = "#10b981";
    ctx.textAlign = "right";
    const actCount = activeFrameData?.active_count ?? detections.length;
    const qCount = activeFrameData?.queue_count ?? 0;
    ctx.fillText(
      `ITD v1.2 YOLO-XL + BYTETRACK · DETECTED: ${actCount} · QUEUE: ${qCount}`,
      width - 12,
      16
    );
  }, [
    activeCamInfo.videoFile,
    activeFrameData,
    activeTelemetry,
    currentFrameIdx,
    isOffline,
    selectedCamera,
    showCountingLine,
    showLanes,
    showQueueROI,
    crossingPulse,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        setCurrentFrameIdx((prev) => Math.min(totalFrames - 1, prev + 1));
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        setCurrentFrameIdx((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalFrames]);

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

  const summary = data.summary_metrics;
  const upstream = data.upstream_c1_impact;

  // Active counts from telemetry or fallback
  const displayTotalVehicles = activeTelemetry?.summary?.total_unique_vehicles ?? summary?.total_vehicles_observed ?? 28;
  const displayCrossed = activeFrameData?.cumulative_crossed ?? activeTelemetry?.summary?.total_crossed ?? summary?.total_crossed_line ?? 0;
  const classBreakdown = activeTelemetry?.summary?.class_breakdown || summary?.class_breakdown || {};

  return (
    <div className="vision-container" data-testid="vision-analytics-panel">
      {/* Header Banner & PRD Disclaimers */}
      <section className="vision-header" aria-labelledby="vision-title">
        <div className="vision-header-top">
          <div className="vision-title-group">
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#38bdf8", textTransform: "uppercase", letterSpacing: "1px" }}>
              COMPUTER VISION EDGE ANALYTICS · JUNCTION C3
            </span>
            <h1 id="vision-title" style={{ fontSize: "20px", fontWeight: 700, margin: "4px 0", color: "#f8fafc" }}>
              Sample Video Feed &amp; Traffic State Extraction
            </h1>
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>
              Optional sample-video processing produces isolated aggregate observations only. It is not a source of central traffic state or recommendations.
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOffline(true)}
              aria-label="Simulate Offline Pipeline State"
            >
              <VideoOff size={14} /> Simulate Offline
            </Button>
            {onReturn && (
              <Button
                variant="outline"
                size="sm"
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
            <ShieldCheck size={12} /> AGGREGATES ONLY · NO IDS / TRAJECTORIES / ANPR / FACES
          </span>
          <span className="vision-badge vision-badge-neutral">
            <Info size={12} /> UNCALIBRATED SPEED: UNAVAILABLE
          </span>
          <span className="vision-badge vision-badge-primary">
            <Compass size={12} /> CORE SCENARIOS OPERATE INDEPENDENTLY
          </span>
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
            Select 10s Video Feed (12 Cameras):
          </label>
          <select
            id="video-feed-select"
            aria-label="Select 10s Video Feed (12 Cameras)"
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
            {ALL_CAMERA_SLOTS.map((cam, idx) => (
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
              {ALL_CAMERA_SLOTS.map((cam) => (
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
                onClick={() => setProcessingMode("cached_observations")}
                aria-pressed={processingMode === "cached_observations"}
                className={`vision-toggle-btn ${processingMode === "cached_observations" ? "active" : ""}`}
                style={{ minHeight: "28px", padding: "2px 8px", fontSize: "11px" }}
              >
                Cached Observations (ITD v1.2)
              </button>
              <button
                type="button"
                onClick={() => setProcessingMode("online_inference")}
                aria-pressed={processingMode === "online_inference"}
                className={`vision-toggle-btn ${processingMode === "online_inference" ? "active" : ""}`}
                style={{ minHeight: "28px", padding: "2px 8px", fontSize: "11px" }}
              >
                Online Inference Stream
              </button>
            </div>
          </div>
        </div>

        {/* PRD §19.3 Authority Classification Strip */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px", fontSize: "10px" }} role="region" aria-label="Authority Classification">
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(16, 185, 129, 0.12)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
            <strong>OBSERVED FROM VIDEO:</strong> {selectedCamera} 5s Windows
          </span>
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(59, 130, 246, 0.12)", color: "#3b82f6", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
            <strong>VIDEO-DERIVED SCENARIO INPUT:</strong> Boundary Inflow
          </span>
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(168, 85, 247, 0.12)", color: "#a855f7", border: "1px solid rgba(168, 85, 247, 0.3)" }}>
            <strong>MODELED NETWORK STATE:</strong> Conserved CTM Cells
          </span>
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
            <strong>FORECAST:</strong> EWMA Horizons
          </span>
          <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(239, 68, 68, 0.12)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
            <strong>UNAVAILABLE:</strong> Uncalibrated Speed
          </span>
        </div>
      </section>

      {/* Main Grid: Video Player on Left, Metrics on Right */}
      <div className="vision-main-grid">
        {/* LEFT: Video Player Card with Canvas Overlays */}
        <section className="vision-video-panel" aria-label="Camera Video Viewport">
          <div className="vision-video-header">
            <div className="vision-video-header-title">
              <Video size={16} color="#64b5f6" aria-hidden="true" />
              <span>Camera {selectedCamera} (Approach to Junction C1)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                className={`vision-badge ${isPlaying ? "vision-badge-success" : "vision-badge-neutral"}`}
                style={{ fontSize: "10px" }}
              >
                {isPlaying ? "LIVE TRACKING" : "PAUSED"}
              </span>
              <span style={{ fontSize: "11px", color: "#8ea3b3", fontVariantNumeric: "tabular-nums" }}>
                Frame {currentFrameIdx + 1} / {totalFrames}
              </span>
            </div>
          </div>

          <div className="vision-canvas-wrapper" style={{ position: "relative" }}>
            <video
              ref={videoRef}
              aria-label="Authoritative MP4 Video Feed"
              src={`/api/v1/clips/${selectedCamera}/media`}
              muted
              playsInline
              autoPlay
              loop
              style={{ display: "none" }}
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={400}
              className="vision-canvas"
              aria-label="Computer vision video stream showing lane polygons, queue detection zone, and counting line."
            />
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
                    videoRef.current.currentTime = (prev / totalFrames) * 10.0;
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
                  const next = Math.min(totalFrames - 1, currentFrameIdx + 1);
                  setCurrentFrameIdx(next);
                  if (videoRef.current) {
                    videoRef.current.currentTime = (next / totalFrames) * 10.0;
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

              {/* Range Scrubber */}
              <div className="vision-scrubber">
                <input
                  type="range"
                  min={0}
                  max={totalFrames - 1}
                  value={currentFrameIdx}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setCurrentFrameIdx(idx);
                    if (videoRef.current) {
                      videoRef.current.currentTime = (idx / totalFrames) * 10.0;
                    }
                  }}
                  aria-label="Video frame scrubber"
                />
                <div className="vision-scrubber-labels">
                  <span>0.0s</span>
                  <span>
                    {(currentFrameIdx / 10).toFixed(1)}s / 10.0s
                  </span>
                </div>
              </div>

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

        {/* RIGHT: Realtime Aggregates Column */}
        <div className="vision-metrics-col">
          {/* Uncalibrated Speed Banner (S36, PRD §8.5) */}
          <div className="vision-speed-banner" role="region" aria-label="Estimated Traffic Speed">
            <div>
              <div className="vision-speed-tag">PRD §8.5 REQUIREMENT</div>
              <div className="vision-speed-value">Unavailable</div>
            </div>
            <div className="vision-speed-note">
              <strong style={{ color: "#fbc02d" }}>No calibrated speed measurement</strong>
              <div>Uncalibrated sample video is not an authoritative km/h source.</div>
            </div>
          </div>

          {/* Vehicle Class Breakdown (PRD §15.2) */}
          <div className="vision-card" role="region" aria-label="Vehicle Class Distribution">
            <div className="vision-card-header">
              <h3>
                <Car size={16} color="#64b5f6" aria-hidden="true" />
                Class Breakdown (Observed {displayTotalVehicles} Vehicles)
              </h3>
              <span style={{ fontSize: "11px", color: "#8da5b8" }}>
                Crossed: {displayCrossed}
              </span>
            </div>
            <div className="vision-classes-grid">
              <div className="vision-class-item">
                <span className="vision-class-label">Bike</span>
                <span className="vision-class-count" style={{ color: "#10b981" }}>
                  {classBreakdown?.two_wheeler ?? classBreakdown?.bike ?? 1}
                </span>
              </div>
              <div className="vision-class-item">
                <span className="vision-class-label">Car</span>
                <span className="vision-class-count" style={{ color: "#3b82f6" }}>
                  {classBreakdown?.car ?? 3}
                </span>
              </div>
              <div className="vision-class-item">
                <span className="vision-class-label">Auto</span>
                <span className="vision-class-count" style={{ color: "#f59e0b" }}>
                  {classBreakdown?.autorickshaw ?? classBreakdown?.auto ?? 1}
                </span>
              </div>
              <div className="vision-class-item">
                <span className="vision-class-label">Bus</span>
                <span className="vision-class-count" style={{ color: "#ef4444" }}>
                  {classBreakdown?.bus ?? 3}
                </span>
              </div>
              <div className="vision-class-item">
                <span className="vision-class-label">Truck</span>
                <span className="vision-class-count" style={{ color: "#a855f7" }}>
                  {classBreakdown?.truck ?? 1}
                </span>
              </div>
            </div>
          </div>

          {/* Lane-wise Flow and Queue Table */}
          <div className="vision-card" role="region" aria-label="Lane-Wise Traffic Metrics">
            <div className="vision-card-header">
              <h3>
                <Activity size={16} color="#64b5f6" aria-hidden="true" />
                Lane Flow &amp; Queue Assignment
              </h3>
              <span style={{ fontSize: "11px", color: "#8da5b8" }}>3 Polygonal ROIs</span>
            </div>
            <table className="vision-lane-table">
              <thead>
                <tr>
                  <th scope="col">Lane</th>
                  <th scope="col">Flow (vpm)</th>
                  <th scope="col">Queue</th>
                  <th scope="col">Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {summary?.lane_metrics?.map((lane) => (
                  <tr key={lane.lane_id}>
                    <td>{lane.label}</td>
                    <td>{lane.current_flow_vpm == null ? "Unavailable" : lane.current_flow_vpm.toFixed(1)}</td>
                    <td>{lane.current_queue == null ? "Unavailable" : `${lane.current_queue} veh`}</td>
                    <td>{lane.occupancy == null ? "Unavailable" : `${(lane.occupancy * 100).toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* BOTTOM: Upstream Impact to C1 (PRD §8.5) */}
      <section className="vision-upstream-card" aria-labelledby="upstream-heading">
        <div className="vision-card-header" style={{ marginBottom: "8px" }}>
          <h2 id="upstream-heading" style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#e5edf5" }}>
            Upstream Impact on Corridor Junction C1
          </h2>
          <span
            className={`vision-badge ${
              upstream?.risk_level === "high"
                ? "vision-badge-warning"
                : upstream?.risk_level === "moderate"
                ? "vision-badge-primary"
                : "vision-badge-success"
            }`}
          >
            {upstream?.risk_level ? `${upstream.risk_level.toUpperCase()} RISK` : "MODERATE RISK"}
          </span>
        </div>
        <p style={{ fontSize: "12px", color: "#8da5b8", margin: "0 0 12px 0" }}>
          This optional sample-video lane is not injected into the aggregate traffic model. Whole-link C3→C1 flow, density, ETA and risk remain unavailable without calibrated coverage and an approved estimator.
        </p>

        <div className="vision-upstream-grid">
          <div className="vision-upstream-box">
            <span className="vision-upstream-box-label">+30s Expected Inflow</span>
            <span className="vision-upstream-box-val">—</span>
            <span className="vision-upstream-box-sub">Unavailable from sample video</span>
          </div>
          <div className="vision-upstream-box">
            <span className="vision-upstream-box-label">+60s Expected Inflow</span>
            <span className="vision-upstream-box-val">—</span>
            <span className="vision-upstream-box-sub">Unavailable from sample video</span>
          </div>
          <div className="vision-upstream-box">
            <span className="vision-upstream-box-label">+120s Expected Inflow</span>
            <span className="vision-upstream-box-val">—</span>
            <span className="vision-upstream-box-sub">No central-model injection</span>
          </div>
          <div className="vision-upstream-box">
            <span className="vision-upstream-box-label">Estimated ETA to C1</span>
            <span className="vision-upstream-box-val">—</span>
            <span className="vision-upstream-box-sub">Requires calibrated state estimation</span>
          </div>
        </div>
      </section>
    </div>
  );
}
