import re

with open("services/intelligence/tests/test_epic6.py", "r") as f:
    content = f.read()

# Make C6-C3-C1 traffic much heavier so that a timing change actually improves total delay > 5%
replacement = """    for mid, m in model.moves.items():
        if mid in ("C6-C3-C1", "C3-C1-C2", "C3-C1-C4"):
            q, c, r, a = 30.0, 40, 50.0, 60.0
        else:
            q, c, r, a = 1.0, 2, 5.0, 10.0
        state.movements.add(
            movement_id=mid, queue_veh=q, vehicle_count=c, arrival_rate_vpm=r,
            downstream_capacity_veh=25.0, current_phase_id=model.serving[mid], waiting_age_s=a,
        )"""

content = re.sub(r'    for mid, m in model.moves.items():\n(?:        .*\n)*            waiting_age_s=25\.0,\n        \)', replacement, content)

with open("services/intelligence/tests/test_epic6.py", "w") as f:
    f.write(content)
