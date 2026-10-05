import re
with open("services/vision/itd_pipeline.py", "r") as f:
    content = f.read()

replacement = """                            crossing_dir = counter.check_crossing(track_id, prev_pt, bottom_center)
                            expected_dir = self.geometry.get("primary_direction", "approaching")
                            if crossing_dir == expected_dir:
                                if cls_name != "pedestrain":
                                    current_bin_crossings += 1
                                current_bin_classes[cls_name] = current_bin_classes.get(cls_name, 0) + 1"""

content = re.sub(r"                            crossing_dir = counter\.check_crossing\(track_id, prev_pt, bottom_center\)\n                            if crossing_dir == \"approaching\":\n                                if cls_name != \"pedestrain\":\n                                    current_bin_crossings \+= 1\n                                current_bin_classes\[cls_name\] = current_bin_classes\.get\(cls_name, 0\) \+ 1", replacement, content)

with open("services/vision/itd_pipeline.py", "w") as f:
    f.write(content)
