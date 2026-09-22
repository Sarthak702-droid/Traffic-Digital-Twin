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
  role: string;
  resolution: string;
  fps: number;
}

const CAMERA_SLOTS: CameraSlot[] = [
  { id: "CAM-01", label: "CAM-01", approach: "C2 → C1 Approach", role: "external_boundary_input", resolution: "3840x2160", fps: 30 },
  { id: "CAM-02", label: "CAM-02", approach: "C4 → C1 Approach", role: "external_boundary_input", resolution: "3840x2160", fps: 30 },
  { id: "CAM-03", label: "CAM-03", approach: "C5 → C1 Approach", role: "external_boundary_input", resolution: "3840x2160", fps: 30 },
  { id: "CAM-04", label: "CAM-04", approach: "C1 → C2 Internal", role: "internal_link_observation", resolution: "3840x2160", fps: 30 },
  { id: "CAM-05", label: "CAM-05", approach: "C1 → C4 Internal", role: "internal_link_observation", resolution: "3840x2160", fps: 30 },
  { id: "CAM-06", label: "CAM-06", approach: "C6 Approach", role: "external_boundary_input", resolution: "3840x2160", fps: 30 },
];

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

  // T13 Dual-mode & Camera selection
  const [selectedCamera, setSelectedCamera] = useState<string>("CAM-01");
  const [processingMode, setProcessingMode] = useState<"cached_observations" | "online_inference">("cached_observations");
  const [liveObservations, setLiveObservations] = useState<any[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevCrossedCountRef = useRef<number>(0);

  // Fetch live vision state or real observations from Go API gateway
  useEffect(() => {
    if (isOffline) return;
    let isMounted = true;
    
    // Fetch observations for selected camera & mode
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
      .catch(() => {
        // Fallback to pre-computed OpenCV aggregates
      });
    return () => {
      isMounted = false;
    };
  }, [isOffline, selectedCamera, processingMode]);

  const totalFrames = data.frames?.length || 240;
  const currentFrame: VisionFrame | null = data.frames?.[currentFrameIdx] ?? null;

  // Frame animation loop
  useEffect(() => {
    if (!isPlaying || isOffline || totalFrames === 0) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      return;
    }

    const intervalMs = Math.max(20, Math.round(100 / playbackSpeed));
    playIntervalRef.current = setInterval(() => {
      setCurrentFrameIdx((prev) => (prev + 1) % totalFrames);
    }, intervalMs);

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, isOffline, playbackSpeed, totalFrames]);

  // Flash crossing line once when count increments (Story S38: single-pulse alert)
  useEffect(() => {
    if (!currentFrame) return;
    if (currentFrame.total_crossed > prevCrossedCountRef.current) {
      setCrossingPulse(true);
      const timer = setTimeout(() => setCrossingPulse(false), 300);
      prevCrossedCountRef.current = currentFrame.total_crossed;
      return () => clearTimeout(timer);
    }
  }, [currentFrame]);

  // Render video frame on HTML5 Canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isOffline) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // 1. Asphalt Road Background
    ctx.fillStyle = "#1e242b";
    ctx.fillRect(0, 0, width, height);

    // Sidewalks
    ctx.fillStyle = "#161b22";
    ctx.fillRect(0, 0, 80, height);
    ctx.fillRect(width - 80, 0, 80, height);

    // Road surface perspective corridor
    ctx.fillStyle = "#27313a";
    ctx.beginPath();
    ctx.moveTo(120, 0);
    ctx.lineTo(width - 120, 0);
    ctx.lineTo(width - 60, height);
    ctx.lineTo(60, height);
    ctx.closePath();
    ctx.fill();

    // 2. Lane Polygons and Dividers
    const laneWidthTop = (width - 240) / 3.0;
    const laneWidthBottom = (width - 120) / 3.0;

    if (showLanes) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 14]);

      for (let l = 1; l <= 2; l++) {
        const topX = 120 + l * laneWidthTop;
        const botX = 60 + l * laneWidthBottom;
        ctx.beginPath();
        ctx.moveTo(topX, 0);
        ctx.lineTo(botX, height);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Lane labels at top
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "rgba(180, 205, 225, 0.7)";
      ctx.textAlign = "center";
      ctx.fillText("L1 (Turn)", 120 + 0.5 * laneWidthTop, 18);
      ctx.fillText("L2 (Thru)", 120 + 1.5 * laneWidthTop, 18);
      ctx.fillText("L3 (Curb)", 120 + 2.5 * laneWidthTop, 18);
    }

    // 3. Queue ROI Polygon Zone (y in 240..360)
    if (showQueueROI) {
      ctx.fillStyle = "rgba(139, 92, 246, 0.16)";
      ctx.strokeStyle = "rgba(167, 139, 250, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(100, 240);
      ctx.lineTo(width - 100, 240);
      ctx.lineTo(width - 80, 360);
      ctx.lineTo(80, 360);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(196, 181, 253, 0.85)";
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("QUEUE DETECTION ROI", 92, 256);
    }

    // 4. Directional Virtual Counting Line at y=360
    if (showCountingLine) {
      ctx.strokeStyle = crossingPulse ? "#fbbf24" : "rgba(245, 158, 11, 0.85)";
      ctx.lineWidth = crossingPulse ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(80, 360);
      ctx.lineTo(width - 80, 360);
      ctx.stroke();

      // Line label badge
      ctx.fillStyle = crossingPulse ? "#d97706" : "rgba(217, 119, 6, 0.9)";
      ctx.fillRect(width - 170, 348, 86, 18);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("COUNTING LINE ↓", width - 127, 361);
    }

    // Camera Watermark & Frame Disclaimers. This operational view deliberately
    // never renders per-object boxes, IDs, or trajectories.
    ctx.fillStyle = "rgba(10, 15, 20, 0.8)";
    ctx.fillRect(0, 0, width, 24);
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("NON-ODISHA SAMPLE VIDEO FEED · NO ANPR · NO FACIAL RECOGNITION", 12, 16);

    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(`CAM-C3-N · FRAME ${String(currentFrameIdx).padStart(4, "0")}/${totalFrames}`, width - 12, 16);
  }, [
    currentFrame,
    currentFrameIdx,
    isOffline,
    showCountingLine,
    showLanes,
    showQueueROI,
    totalFrames,
    crossingPulse,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Keyboard navigation (Space: Play/Pause, Arrows: Scrub)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

  // Offline / Disconnected State View (Story S37, Finding A17)
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

  return (
    <div className="vision-container" data-testid="vision-analytics-panel">
      {/* Header with Ethic, Privacy & Provenance Disclaimers */}
      <section className="vision-header" aria-labelledby="vision-title">
        <div className="vision-header-top">
          <div className="vision-title-group">
            <div className="overline" style={{ color: "#64b5f6", fontWeight: 600 }}>
              COMPUTER VISION EDGE ANALYTICS · JUNCTION C3
            </div>
            <h1 id="vision-title">Sample Video Feed &amp; Traffic State Extraction</h1>
            <p>
              Optional sample-video processing produces isolated aggregate observations only. It is not a source of central traffic state or recommendations.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Button
              variant="outline"
              onClick={() => setIsOffline(true)}
              aria-label="Simulate Offline Pipeline State"
              title="Test offline recovery states"
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

        <div className="vision-disclaimer-strip" role="region" aria-label="Privacy and Governance Disclaimers">
          <span className="vision-badge vision-badge-warning">
            <AlertTriangle size={12} aria-hidden="true" /> NON-ODISHA SAMPLE VIDEO FEED
          </span>
          <span className="vision-badge vision-badge-success">
            <ShieldCheck size={12} aria-hidden="true" /> AGGREGATES ONLY · NO IDS / TRAJECTORIES / ANPR / FACES
          </span>
          <span className="vision-badge vision-badge-neutral">
            <Compass size={12} aria-hidden="true" /> UNCALIBRATED SPEED: UNAVAILABLE
          </span>
          <span className="vision-badge vision-badge-primary">
            <Activity size={12} aria-hidden="true" /> CORE SCENARIOS OPERATE INDEPENDENTLY
          </span>
        </div>

        {/* T13 Stream Selection & Mode Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center", marginTop: "14px", padding: "10px 14px", background: "#161b22", borderRadius: "6px", border: "1px solid #30363d" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#8da5b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Active Camera:</span>
            <div style={{ display: "flex", gap: "4px" }} role="group" aria-label="Camera Selector">
              {CAMERA_SLOTS.map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => setSelectedCamera(cam.id)}
                  aria-pressed={selectedCamera === cam.id}
                  className={`vision-toggle-btn ${selectedCamera === cam.id ? "active" : ""}`}
                  style={{ minHeight: "28px", padding: "2px 8px", fontSize: "11px" }}
                >
                  {cam.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#8da5b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Processing Mode:</span>
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
              src={`/api/v1/clips/${selectedCamera}/media`}
              muted
              playsInline
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                zIndex: 1,
                opacity: 0.85,
              }}
              aria-label="Authoritative MP4 Video Feed"
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="vision-canvas"
              style={{ position: "relative", zIndex: 2 }}
              aria-label="Sample video viewport with aggregate measurement zones"
            />
          </div>

          {/* Transport and Controls Toolbar */}
          <div className="vision-toolbar">
            {/* Overlay Switches */}
            <div className="vision-toggles-row" role="group" aria-label="Vision Overlay Toggles">
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
                    if (next) videoRef.current.play().catch(() => {});
                    else videoRef.current.pause();
                  }
                }}
                aria-label={isPlaying ? "Pause video" : "Play video"}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>

              <button
                type="button"
                className="vision-transport-btn"
                onClick={() => setCurrentFrameIdx((prev) => Math.max(0, prev - 1))}
                aria-label="Step back one frame"
                title="Step back 1 frame (Left Arrow)"
              >
                <SkipBack size={16} />
              </button>

              <button
                type="button"
                className="vision-transport-btn"
                onClick={() => setCurrentFrameIdx((prev) => Math.min(totalFrames - 1, prev + 1))}
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
                    if (videoRef.current && videoRef.current.duration) {
                      videoRef.current.currentTime = (idx / totalFrames) * videoRef.current.duration;
                    }
                  }}
                  aria-label="Video frame scrubber"
                />
                <div className="vision-scrubber-labels">
                  <span>0.0s</span>
                  <span>
                    {((currentFrameIdx / 10).toFixed(1))}s / {(totalFrames / 10).toFixed(1)}s
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
                Class Breakdown (Observed {
                  liveObservations.length > 0
                    ? liveObservations[Math.min(Math.floor(currentFrameIdx / 50), liveObservations.length - 1)]?.forward_count ?? summary?.total_vehicles_observed ?? 0
                    : summary?.total_vehicles_observed ?? 0
                } Vehicles)
              </h3>
              <span style={{ fontSize: "11px", color: "#8da5b8" }}>Crossed: {currentFrame?.total_crossed ?? summary?.total_crossed_line ?? 0}</span>
            </div>
            <div className="vision-classes-grid">
              <div className="vision-class-item">
                <span className="vision-class-label">Bike</span>
                <span className="vision-class-count" style={{ color: "#10b981" }}>
                  {liveObservations.length > 0
                    ? (liveObservations[Math.min(Math.floor(currentFrameIdx / 50), liveObservations.length - 1)]?.class_counts?.["two wheeler"] ?? summary?.class_breakdown?.bike ?? 0)
                    : (summary?.class_breakdown?.bike ?? 0)}
                </span>
              </div>
              <div className="vision-class-item">
                <span className="vision-class-label">Car</span>
                <span className="vision-class-count" style={{ color: "#3b82f6" }}>
                  {liveObservations.length > 0
                    ? (liveObservations[Math.min(Math.floor(currentFrameIdx / 50), liveObservations.length - 1)]?.class_counts?.car ?? summary?.class_breakdown?.car ?? 0)
                    : (summary?.class_breakdown?.car ?? 0)}
                </span>
              </div>
              <div className="vision-class-item">
                <span className="vision-class-label">Auto</span>
                <span className="vision-class-count" style={{ color: "#f59e0b" }}>
                  {liveObservations.length > 0
                    ? (liveObservations[Math.min(Math.floor(currentFrameIdx / 50), liveObservations.length - 1)]?.class_counts?.autorickshaw ?? summary?.class_breakdown?.auto ?? 0)
                    : (summary?.class_breakdown?.auto ?? 0)}
                </span>
              </div>
              <div className="vision-class-item">
                <span className="vision-class-label">Bus</span>
                <span className="vision-class-count" style={{ color: "#ef4444" }}>
                  {liveObservations.length > 0
                    ? (liveObservations[Math.min(Math.floor(currentFrameIdx / 50), liveObservations.length - 1)]?.class_counts?.bus ?? summary?.class_breakdown?.bus ?? 0)
                    : (summary?.class_breakdown?.bus ?? 0)}
                </span>
              </div>
              <div className="vision-class-item">
                <span className="vision-class-label">Truck</span>
                <span className="vision-class-count" style={{ color: "#a855f7" }}>
                  {liveObservations.length > 0
                    ? (liveObservations[Math.min(Math.floor(currentFrameIdx / 50), liveObservations.length - 1)]?.class_counts?.truck ?? summary?.class_breakdown?.truck ?? 0)
                    : (summary?.class_breakdown?.truck ?? 0)}
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
            <span className="vision-upstream-box-val">
              —
            </span>
            <span className="vision-upstream-box-sub">Requires calibrated state estimation</span>
          </div>
        </div>
      </section>
    </div>
  );
}
