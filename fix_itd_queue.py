with open("services/vision/itd_pipeline.py", "r") as f:
    content = f.read()

old_motion = """                            dx = bottom_center[0] - prev_pt[0]
                            dy = bottom_center[1] - prev_pt[1]
                            dist_px = math.hypot(dx, dy)
                            if track_id not in track_motion:
                                track_motion[track_id] = []
                            track_motion[track_id].append(dist_px)
                            if len(track_motion[track_id]) > 8:
                                track_motion[track_id].pop(0)"""

new_motion = """                            dx = (bottom_center[0] - prev_pt[0]) / orig_w
                            dy = (bottom_center[1] - prev_pt[1]) / orig_h
                            dt = frame_step / fps
                            speed_norm_per_s = math.hypot(dx, dy) / max(1e-3, dt)
                            if track_id not in track_motion:
                                track_motion[track_id] = []
                            track_motion[track_id].append(speed_norm_per_s)
                            if len(track_motion[track_id]) > 8:
                                track_motion[track_id].pop(0)"""

old_threshold = """                                recent = track_motion.get(track_id, [0.0])
                                avg_speed = sum(recent) / max(1, len(recent))
                                if avg_speed < 8.0:
                                    active_queued += 1"""

new_threshold = """                                recent = track_motion.get(track_id, [0.0])
                                avg_speed = sum(recent) / max(1, len(recent))
                                threshold = self.geometry.get("queue_speed_threshold_norm", 0.02)
                                if avg_speed < threshold:
                                    active_queued += 1"""

content = content.replace(old_motion, new_motion)
content = content.replace(old_threshold, new_threshold)

with open("services/vision/itd_pipeline.py", "w") as f:
    f.write(content)
