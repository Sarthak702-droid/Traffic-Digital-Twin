import { z } from "zod";
const n=z.number().finite().nonnegative();
const timing=z.object({node_id:z.string(),phase_id:z.string(),green_s:n});
export const recommendationSchema=z.object({id:z.string().min(1),run_id:z.string().min(1),timestamp:z.string(),priority:z.string(),reason:z.string(),changes:z.array(timing),safety_status:z.string(),status:z.string(),explanation_facts:z.array(z.string())});
export const comparisonSchema=z.object({run_id:z.string(),recommendation_id:z.string(),baseline_max_queue_veh:n,candidate_max_queue_veh:n,baseline_avg_delay_s:n,candidate_avg_delay_s:n,initial_time_s:n,model_version:z.string(),baseline_spillback_s:n,candidate_spillback_s:n,baseline_stops_per_vehicle:n,candidate_stops_per_vehicle:n,horizon_s:n,seed:n,baseline_queue_delay_veh_s:n,candidate_queue_delay_veh_s:n,baseline_boundary_throughput_veh:n,candidate_boundary_throughput_veh:n,baseline_congested_link_s:n,candidate_congested_link_s:n,baseline_boundary_backlog_veh:n,candidate_boundary_backlog_veh:n,metrics_version:z.string()});
const forecast=z.object({id:z.string(),run_id:z.string(),movement_id:z.string(),horizon_s:n,queue_veh:n,occupancy_ratio:n.max(1),arrivals_veh:n,risk:z.string(),spillback_eta_s:n.nullish(),model_version:z.string(),explanation_facts:z.array(z.string())});
const analysis=z.object({run_id:z.string(),simulation_time_s:n,forecasts:z.array(forecast),recommendation:recommendationSchema.nullish(),alternatives:z.array(recommendationSchema),comparison:comparisonSchema.nullish()});
const health=z.object({timestamp:z.string(),components:z.array(z.object({component:z.string(),status:z.string(),message:z.string()}))});
const run=z.object({id:z.string(),config_id:z.string(),scenario_type:z.string(),seed:n,mode:z.enum(["observe","recommend","manual"]),status:z.string(),started_at:z.string(),ended_at:z.string().nullable()});
const audit=z.object({sequence:n,id:z.string(),run_id:z.string().nullable(),recommendation_id:z.string().nullable(),actor:z.string(),event_type:z.string(),before_values:z.unknown(),after_values:z.unknown(),reason:z.string(),safety_result:z.string(),created_at:z.string()});
export function validateResponse(path:string,data:unknown){
 const p=path.split("?")[0];
 if(p==="/analysis")return analysis.parse(data);
 if(p==="/health")return health.parse(data);
 if(p==="/runs")return Array.isArray(data)?z.array(run).parse(data):run.parse(data);
 if(p==="/audit")return z.object({events:z.array(audit),next_after:n}).parse(data);
 if(p==="/mode"||p.startsWith("/mode/"))return z.object({mode:z.enum(["observe","recommend","manual"]),locks:z.array(z.string()).optional(),manual:z.boolean().optional()}).parse(data);
 if(p==="/locks")return z.object({locks:z.array(z.string())}).parse(data);
 if(p==="/decisions/unresolved")return z.object({unresolved:z.array(z.object({command_id:z.string(),recommendation_id:z.string(),actor:z.string(),created_at:z.string(),payload:z.unknown()}))}).parse(data);
 if(p==="/decisions/resolve")return z.object({settled:z.boolean(),command_id:z.string(),recommendation_id:z.string(),resolution:z.string()}).parse(data);
 if(p.startsWith("/scenarios/"))return z.object({run_id:z.string(),scenario_type:z.string(),seed:n,status:z.string()}).parse(data);
 if(p.startsWith("/recommendations/"))return p.endsWith("/simulate")?comparisonSchema.parse(data):recommendationSchema.parse(data);
 return data;
}
