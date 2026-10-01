import {ArrowRight, CircleHelp, Route, ShieldCheck, Siren} from 'lucide-react';
import {NetworkCanvas} from './network-canvas';
import {emergencyStage} from './emergency-corridor-panel';
import type {Network} from '../../../packages/contracts/typescript/network';
import type {TrafficState} from '../../../packages/contracts/typescript/events';

export function EmergencySimulation({network,frame,onSelect}:{network:Network;frame:TrafficState|null;onSelect:(id:string)=>void}) {
 const active=frame?.scenario_type==='ambulance_corridor'?frame.emergency:null;
 const route=active?.route_node_ids??network.scenarios.find(s=>s.id==='ambulance_corridor')?.route_node_ids??[];
 const stage=emergencyStage(active?.status);
 const stageLabel=stage?stage.replaceAll('_',' '):!frame?'State unavailable':active?'Status unavailable':'Not scheduled';
 return <section className="emergency-simulation" aria-labelledby="emergency-map-title">
  <header className="emergency-map-heading">
   <div className="emergency-map-icon"><Siren size={22}/></div>
   <div><span className="overline">VIRTUAL EMERGENCY ROUTE</span><h2 id="emergency-map-title">Ambulance Corridor Priority</h2><p>Follow the corridor. Inspect safe transitions.</p></div>
   <span className={`emergency-map-stage stage-${stage??'unavailable'}`}>{stageLabel}</span>
  </header>
  <div className="emergency-map-meta"><span><Route size={14}/>{route.length} route points · {route.filter(id=>network.nodes.some(n=>n.id===id&&n.kind==='controlled')).length} controlled junctions</span><span>Virtual clock <strong>{frame?`${frame.simulation_time_s.toFixed(1)} s`:'Unavailable'}</strong></span></div>
  <ol className="emergency-route-stops" aria-label="Virtual emergency route">
   {route.map((id,index)=>{
    const node=network.nodes.find(n=>n.id===id);const controlled=node?.kind==='controlled';
    const signal=active?frame?.signals.find(s=>s.node_id===id):undefined;
    const eta=active?.eta_s[index];const validEta=typeof eta==='number'&&Number.isFinite(eta)&&eta>=0;
    return <li key={`${id}-${index}`}><button type="button" onClick={()=>onSelect(id)} aria-label={`Inspect route stop ${id}`}>
     <span className="route-stop-top"><span className="route-stop-number">{index+1}</span><strong>{id}</strong>{index<route.length-1&&<ArrowRight size={14} aria-hidden="true"/>}</span>
     <span className={`route-stop-signal signal-${signal?.indication??'unknown'}`}>{controlled?signal?`${signal.indication.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase())} · ${Math.ceil(signal.remaining_s)} s`:'Signal unavailable':node?'Boundary · no signal':'Node unavailable'}</span>
     <span className="route-stop-eta">{validEta?`ETA ${Math.round(eta)} s`:'ETA unavailable'}</span>
    </button></li>;
   })}
  </ol>
  <div className="emergency-map-canvas"><NetworkCanvas network={network} frame={frame} route={route} onSelect={onSelect}/><span className="emergency-map-caption">AGGREGATE NETWORK · SELECT A JUNCTION TO INSPECT</span></div>
  <div className="emergency-map-legend" aria-label="Map legend"><span><i className="legend-route"/>Designated route</span><span><i className="legend-stock"/>Road-cell vehicle stock</span><span><i className="legend-junction"/>Signal ring · current indication</span></div>
  <footer className="emergency-map-note"><ShieldCheck size={16}/><span>Virtual priority respects clearance, receiving storage and recovery.</span><CircleHelp size={15}/><span>ETAs describe modeled progress; no tracked ambulance position.</span></footer>
 </section>;
}
