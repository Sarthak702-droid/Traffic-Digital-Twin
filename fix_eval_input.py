import re
with open("services/intelligence/model.py", "r") as f:
    content = f.read()

old_eval = """    def _evaluation_input(self,state):
        frozen=pb.TrafficState();frozen.CopyFrom(state)
        if frozen.schema_version=='1.1':
            cell_ids=[item.link_id for item in frozen.cells]
            if len(cell_ids)!=len(set(cell_ids)) or set(cell_ids)!=set(self.links):
                raise ValueError('Operating comparison requires a complete cell snapshot')
            if frozen.config_hash!=config_hash(self.config):
                raise ValueError('Operating comparison configuration differs from snapshot')
            if {item.node_id for item in frozen.signals}!=set(self.index.phases_by_node):
                raise ValueError('Operating comparison requires every controlled signal')
            pending={item.phase_id:item.green_s for item in frozen.scheduler.pending_plan}
            if frozen.scheduler.HasField('requested_at_tick') or pending and pending!=self.plan(frozen):
                raise ValueError('Operating comparison has a pending virtual plan')
        rates,methods=boundary_forecast_rates(frozen,self.index)
        assumptions={'run_id':frozen.run_id,'input_session_id':frozen.input_session_id,'demand_source':frozen.demand_source,'input_quality':frozen.input_quality,'config_hash':frozen.config_hash,'forecast_origin_source_s':frozen.latest_finalized_window_end_source_s,'rates_vps':rates,'forecast_methods':methods}
        digest=hashlib.sha256(json.dumps(assumptions,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        return {'state':frozen,'cells':self._initial_cells(frozen),'backlogs':{item.link_id:item.backlog_veh for item in frozen.boundary_demand},'rates':rates,'methods':methods,'demand_hash':digest}"""

new_eval = """    def _evaluation_input(self,state):
        frozen=pb.TrafficState();frozen.CopyFrom(state)
        if frozen.schema_version=='1.1':
            cell_ids=[item.link_id for item in frozen.cells]
            if len(cell_ids)!=len(set(cell_ids)) or set(cell_ids)!=set(self.links):
                raise ValueError('Operating comparison requires a complete cell snapshot')
            if frozen.config_hash!=config_hash(self.config):
                raise ValueError('Operating comparison configuration differs from snapshot')
            if {item.node_id for item in frozen.signals}!=set(self.index.phases_by_node):
                raise ValueError('Operating comparison requires every controlled signal')
            pending={item.phase_id:item.green_s for item in frozen.scheduler.pending_plan}
            if frozen.scheduler.HasField('requested_at_tick') or pending and pending!=self.plan(frozen):
                raise ValueError('Operating comparison has a pending virtual plan')
        rates,methods=boundary_forecast_rates(frozen,self.index)
        horizon_len = 300
        demand_trace = []
        committed = {edge: [0.0]*horizon_len for edge in self.index.boundary_inputs}
        evidence_horizon = {edge: 0.0 for edge in self.index.boundary_inputs}
        for row in frozen.observation_history:
            if row.observation_status != 'valid': continue
            if row.window_end_s > frozen.simulation_time_s:
                start_s = max(frozen.simulation_time_s, row.window_start_s)
                end_s = row.window_end_s
                if end_s > start_s:
                    rate = row.crossings_veh / (row.window_end_s - row.window_start_s)
                    for t in range(horizon_len):
                        tick_start = frozen.simulation_time_s + t
                        tick_end = tick_start + 1.0
                        overlap_start = max(start_s, tick_start)
                        overlap_end = min(end_s, tick_end)
                        if overlap_end > overlap_start:
                            committed[row.boundary_link_id][t] += rate * (overlap_end - overlap_start)
                    evidence_horizon[row.boundary_link_id] = max(evidence_horizon[row.boundary_link_id], end_s - frozen.simulation_time_s)
        for t in range(horizon_len):
            tick_demand = {}
            for edge in self.index.boundary_inputs:
                if t < evidence_horizon[edge]:
                    tick_demand[edge] = committed[edge][t]
                else:
                    tick_demand[edge] = rates.get(edge, 0.0)
            demand_trace.append(tick_demand)
        assumptions={'run_id':frozen.run_id,'input_session_id':frozen.input_session_id,'demand_source':frozen.demand_source,'input_quality':frozen.input_quality,'config_hash':frozen.config_hash,'forecast_origin_source_s':frozen.latest_finalized_window_end_source_s,'rates_vps':rates,'forecast_methods':methods,'committed':committed,'evidence_horizon':evidence_horizon}
        digest=hashlib.sha256(json.dumps(assumptions,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        return {'state':frozen,'cells':self._initial_cells(frozen),'backlogs':{item.link_id:item.backlog_veh for item in frozen.boundary_demand},'rates':rates,'methods':methods,'demand_hash':digest,'demand_trace':demand_trace}"""

content = content.replace(old_eval, new_eval)

with open("services/intelligence/model.py", "w") as f:
    f.write(content)
