"""
Synthetic Sample Video Generator for Intersection C3 (North Approach).
PRD §8.5, §15.2; Backlog S36.

Generates a deterministic non-Odisha sample video feed with:
- 3-lane road surface with lane divider markings
- Virtual stop line / crossing zone
- Distinct vehicle classes: car, bike, auto, bus, truck
- Camera watermark: NON-ODISHA SAMPLE FEED · DEMO ONLY · NO ANPR / FACES
"""

from __future__ import annotations
import math
import cv2
import numpy as np
from pathlib import Path


def generate_c3_sample_video(
    output_path: str | Path,
    num_frames: int = 240,
    fps: float = 10.0,
    width: int = 640,
    height: int = 480,
) -> Path:
    target_path = Path(output_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(target_path), fourcc, fps, (width, height))

    # Road coordinates (perspective corridor from top to bottom)
    lane_x = [
        (80, 560),   # Road outer bounds (left, right) at bottom
        (180, 460),  # Road outer bounds at top
    ]

    # Deterministic vehicles moving through the frame with 25 frame warm-up
    # vehicle: (id, class_name, lane_idx 0..2, start_frame, speed_px, color_bgr, width, height)
    vehicles_script = [
        (1, "car", 1, 25, 4.2, (200, 100, 50), 38, 55),
        (2, "bike", 0, 32, 5.0, (50, 200, 50), 18, 30),
        (3, "auto", 2, 40, 3.5, (50, 220, 240), 28, 40),
        (4, "bus", 1, 55, 2.8, (40, 60, 220), 45, 88),
        (5, "truck", 2, 70, 2.5, (160, 160, 160), 46, 82),
        (6, "car", 0, 85, 4.4, (220, 140, 70), 38, 55),
        (7, "car", 1, 98, 3.8, (240, 240, 240), 38, 55),
        (8, "bike", 2, 112, 5.2, (80, 220, 100), 18, 30),
        (9, "auto", 0, 125, 3.6, (40, 200, 220), 28, 40),
        (10, "car", 2, 140, 4.1, (180, 80, 220), 38, 55),
        (11, "bus", 1, 155, 2.7, (50, 180, 220), 46, 88),
        (12, "truck", 2, 175, 2.6, (140, 140, 150), 46, 82),
    ]

    for frame_idx in range(num_frames):
        # Create road frame background (dark asphalt)
        frame = np.full((height, width, 3), 32, dtype=np.uint8)

        # Sidewalks / verge
        cv2.rectangle(frame, (0, 0), (120, height), (45, 52, 40), -1)
        cv2.rectangle(frame, (width - 120, 0), (width, height), (45, 52, 40), -1)

        # Asphalt surface
        pts_road = np.array([
            [120, 0],
            [width - 120, 0],
            [width - 60, height],
            [60, height]
        ], np.int32)
        cv2.fillPoly(frame, [pts_road], (48, 48, 52))

        # Lane markings (3 lanes)
        lane_width_bottom = (width - 120) / 3.0
        lane_width_top = (width - 240) / 3.0

        for l_idx in range(1, 3):
            p_top_x = int(120 + l_idx * lane_width_top)
            p_bot_x = int(60 + l_idx * lane_width_bottom)
            # Dashed white line
            for dash_y in range(0, height, 40):
                frac = dash_y / float(height)
                cx = int(p_top_x + frac * (p_bot_x - p_top_x))
                dash_len = int(15 + frac * 10)
                cv2.line(frame, (cx, dash_y), (cx, min(height, dash_y + dash_len)), (220, 220, 220), 2)

        # Stop bar / Directional Counting Line at y = 360
        cv2.line(frame, (80, 360), (width - 80, 360), (0, 215, 255), 3)

        # Queue ROI polygon indicator (light translucent overlay around y=240..360)
        roi_pts = np.array([
            [100, 240],
            [width - 100, 240],
            [width - 80, 360],
            [80, 360]
        ], np.int32)
        roi_overlay = frame.copy()
        cv2.fillPoly(roi_overlay, [roi_pts], (60, 40, 90))
        cv2.addWeighted(roi_overlay, 0.35, frame, 0.65, 0, frame)
        cv2.polylines(frame, [roi_pts], True, (180, 120, 240), 1)

        # Render active vehicles
        for v_id, v_cls, lane, start_f, speed, col, v_w, v_h in vehicles_script:
            if frame_idx < start_f:
                continue
            elapsed = frame_idx - start_f
            y_pos = int(elapsed * speed * 2.2) - 40
            if y_pos > height + 80:
                continue

            # Check if queued in queue zone (simulate brief slowing between y=260 and 340)
            if 260 <= y_pos <= 340 and (frame_idx % 40 < 15):
                y_pos = 260 + int((y_pos - 260) * 0.3)

            # Lane center x position at y_pos
            frac_y = max(0.0, min(1.0, y_pos / float(height)))
            l_w_cur = lane_width_top + frac_y * (lane_width_bottom - lane_width_top)
            l_start_cur = 120 + frac_y * (60 - 120)
            lane_center_x = int(l_start_cur + (lane + 0.5) * l_w_cur)

            # Vehicle scale with perspective
            scale = 0.75 + 0.45 * frac_y
            cur_w = int(v_w * scale)
            cur_h = int(v_h * scale)
            vx1 = lane_center_x - cur_w // 2
            vy1 = y_pos - cur_h // 2
            vx2 = vx1 + cur_w
            vy2 = vy1 + cur_h

            if vy2 < 0 or vy1 > height:
                continue

            # Draw vehicle body
            cv2.rectangle(frame, (vx1, vy1), (vx2, vy2), col, -1)
            cv2.rectangle(frame, (vx1, vy1), (vx2, vy2), (255, 255, 255), 1)

            # Vehicle windshield / cab
            cab_h = max(3, int(cur_h * 0.25))
            cv2.rectangle(frame, (vx1 + 2, vy1 + 2), (vx2 - 2, vy1 + 2 + cab_h), (30, 30, 30), -1)

            # Headlights if heading down
            cv2.circle(frame, (vx1 + 4, vy2 - 3), 2, (200, 255, 255), -1)
            cv2.circle(frame, (vx2 - 4, vy2 - 3), 2, (200, 255, 255), -1)

        # Header watermark: Non-Odisha sample video feed disclaimer
        cv2.rectangle(frame, (0, 0), (width, 36), (16, 18, 22), -1)
        cv2.putText(
            frame,
            "NON-ODISHA SAMPLE VIDEO FEED · DEMO ONLY · NO ANPR / FACES",
            (12, 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (255, 180, 0),
            1,
            cv2.LINE_AA,
        )

        # Footer camera info
        cv2.rectangle(frame, (0, height - 28), (width, height), (16, 18, 22), -1)
        info_str = f"CAM-C3-N · FRAME {frame_idx:04d}/{num_frames} · AGGREGATE OBSERVATIONS ONLY"
        cv2.putText(
            frame,
            info_str,
            (12, height - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (200, 200, 200),
            1,
            cv2.LINE_AA,
        )

        writer.write(frame)

    writer.release()
    return target_path


if __name__ == "__main__":
    out = generate_c3_sample_video("packages/replay/c3_sample_feed.mp4")
    print(f"Generated sample video at: {out}")
