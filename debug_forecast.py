from services.intelligence.tests.test_bound_history_forecast import *
from services.intelligence.model import Model
from services.intelligence.forecast_demand import boundary_forecast_rates

model = Model()
state = video_state(model, [0]*6)
print("simulation_time_s:", state.simulation_time_s)
print("watermark:", state.latest_finalized_window_end_source_s)
for i, row in enumerate(state.observation_history):
    print(f"row {i}: end={row.window_end_s}, available={row.available_at_source_s}")
try:
    boundary_forecast_rates(state, model.index)
    print("Success")
except Exception as e:
    import traceback
    traceback.print_exc()
