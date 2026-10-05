import re
with open("services/vision/recorded_clip.py", "r") as f:
    content = f.read()

replacement = """                    destination.write(json.dumps(row, sort_keys=True) + '\\n')
                    count += 1
            if not count:
                raise ValueError('No finalized observation windows were produced')
            if max_duration_s is not None and previous_end < max_duration_s - 0.5:
                raise ValueError(f'Incomplete decode: requested {max_duration_s}s, reached {previous_end}s')
            os.replace(temporary, observations_path)"""

content = re.sub(r"                    destination\.write\(json\.dumps\(row, sort_keys=True\) \+ '\\n'\)\n                    count \+= 1\n            if not count:\n                raise ValueError\('No finalized observation windows were produced'\)\n            os\.replace\(temporary, observations_path\)", replacement, content)

with open("services/vision/recorded_clip.py", "w") as f:
    f.write(content)
