with open("services/vision/recorded_clip.py", "r") as f:
    content = f.read()

old_block = """                    destination.write(json.dumps(row, sort_keys=True) + '\\n')
                    count += 1
            if not count:
                raise ValueError('No finalized observation windows were produced')
            os.replace(temporary, observations_path)"""

new_block = """                    destination.write(json.dumps(row, sort_keys=True) + '\\n')
                    count += 1
            if not count:
                raise ValueError('No finalized observation windows were produced')
            if max_duration_s is not None and previous_end < max_duration_s - 0.5:
                raise ValueError(f'Incomplete decode: requested {max_duration_s}s, reached {previous_end}s')
            os.replace(temporary, observations_path)"""

content = content.replace(old_block, new_block)

with open("services/vision/recorded_clip.py", "w") as f:
    f.write(content)
