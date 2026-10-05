"""One causal demand release sequence for proposals and matched rollouts."""
import math


def boundary_offers(state, rates, horizon_s, check_budget=lambda: None):
    """Yield tick offers without mutating the snapshot or reading future bins.

    Commitments already included in the snapshot replace forecast demand until
    their known release horizon ends. Remaining mass caps every release.
    Tick coordinates follow the simulator's [tick, tick + 1) convention.
    """
    commitments = [
        {'link': c.boundary_link_id, 'start': c.release_start_simulation_s,
         'end': c.release_end_simulation_s, 'remaining': c.remaining_mass_veh,
         'rate': c.rate_vps}
        for c in state.demand_commitments
    ]
    for c in commitments:
        if (c['link'] not in rates
                or not all(math.isfinite(c[k]) and c[k] >= 0
                           for k in ('start', 'end', 'remaining', 'rate'))
                or c['end'] <= c['start']):
            raise ValueError('Invalid known demand commitment')
    known_end = {link: max((c['end'] for c in commitments if c['link'] == link),
                           default=-1) for link in rates}
    for tick in range(1, horizon_s + 1):
        check_budget()
        now = state.simulation_time_s + tick
        offered = {link: 0.0 if now < known_end[link] else rate
                   for link, rate in rates.items()}
        for c in commitments:
            overlap = max(0, min(now + 1, c['end']) - max(now, c['start']))
            amount = min(c['remaining'], overlap * c['rate'])
            c['remaining'] -= amount
            offered[c['link']] += amount
        yield offered
