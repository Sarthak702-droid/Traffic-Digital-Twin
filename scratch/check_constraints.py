import json

lines = []
with open('/tmp/debug_candidates.jsonl') as f:
    for line in f:
        lines.append(json.loads(line))

# group by case
cases = {}
for l in lines:
    cases.setdefault(l['case'], []).append(l)

for case_id, evals in cases.items():
    if "c1-c6" not in case_id:
        continue
    # we need baseline (idx 0)
    baseline = next((e for e in evals if e['idx'] == 0), None)
    if not baseline:
        continue
        
    req_delay_red = 0.05
    max_exit_reg = 0.02
    max_backlog_reg = 0.02
    max_wait_reg = 0.02
    max_spill_reg = 0.02
    max_debt_reg = 0.10
    
    print(f"\nCase: {case_id}")
    b_res = baseline['res']
    print(f"Baseline queue_delay: {b_res['queue_delay']:.2f}")
    
    for cand in evals:
        if cand['idx'] == 0: continue
        res = cand['res']
        
        valid = True
        reasons = []
        
        if res['queue_delay'] > b_res['queue_delay'] * (1 - req_delay_red) + 1e-9:
            valid = False
            reasons.append(f"queue_delay {res['queue_delay']:.2f} > {b_res['queue_delay'] * (1 - req_delay_red):.2f}")
        if res['throughput'] < b_res['throughput'] * (1 - max_exit_reg) - 1e-9:
            valid = False
            reasons.append(f"throughput {res['throughput']:.2f} < {b_res['throughput'] * (1 - max_exit_reg):.2f}")
        if res['backlog'] > b_res['backlog'] * (1 + max_backlog_reg) + 1e-9:
            valid = False
            reasons.append(f"backlog {res['backlog']:.2f} > {b_res['backlog'] * (1 + max_backlog_reg):.2f}")
        if res['boundary_wait'] > b_res['boundary_wait'] * (1 + max_wait_reg) + 1e-9:
            valid = False
            reasons.append(f"boundary_wait {res['boundary_wait']:.2f} > {b_res['boundary_wait'] * (1 + max_wait_reg):.2f}")
        if res['spill'] > b_res['spill'] * (1 + max_spill_reg) + 1e-9:
            valid = False
            reasons.append(f"spill {res['spill']:.2f} > {b_res['spill'] * (1 + max_spill_reg):.2f}")
        if res['worst_service_debt'] > b_res['worst_service_debt'] * (1 + max_debt_reg) + 1e-9:
            valid = False
            reasons.append(f"debt {res['worst_service_debt']} > {b_res['worst_service_debt'] * (1 + max_debt_reg)}")
            
        print(f"  Cand {cand['idx']}: valid={valid} reasons={reasons}")
