import { z } from "zod";
import fallbackNetworkConfig from "../../../packages/scenario-config/c1-c6.json";

import { validateResponse } from "./response-schemas";
import { useWorkspace } from "./state";

export class ApiError extends Error {
  constructor(message:string,public status:number,public commandId?:string,public uncertain=false,public code?:string,public requestId?:string){super(message);this.name="ApiError";}
}
export function pendingCommand():string|null {try{return localStorage.getItem("twin-uncertain-command")}catch{return null}}
export function clearPendingCommand(){try{localStorage.removeItem("twin-uncertain-command")}catch{};window.dispatchEvent(new Event("command-outcome"));}
export async function request<T>(path:string,options?:RequestInit):Promise<T>{
 const mutation=!!options?.method && !["GET","HEAD"].includes(options.method);
 const auth=path.startsWith("/session");
 const headers=new Headers(options?.headers);headers.set("Content-Type","application/json");
 try {
   const role = useWorkspace.getState().role;
   if (role && !headers.has("X-Role")) headers.set("X-Role", role);
 } catch {}
 const commandId=mutation&&!auth?(headers.get("Idempotency-Key")||crypto.randomUUID()):undefined;
 if(mutation&&!auth && pendingCommand())throw new ApiError("Inspect the previous uncertain command before submitting another action.",409,pendingCommand()!,true);
 if(commandId){headers.set("Idempotency-Key",commandId);try{localStorage.setItem("twin-uncertain-command",commandId)}catch{};window.dispatchEvent(new Event("command-outcome"))}
 const release=()=>{if(commandId&&pendingCommand()===commandId)clearPendingCommand()};
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
 const abort=()=>controller.abort();options?.signal?.addEventListener("abort",abort,{once:true});
 if(options?.signal?.aborted)controller.abort();
 try{
  const response=await fetch(`/api/v1${path}`,{...options,headers,signal:controller.signal});
  let data:unknown;try{data=await response.json()}catch{throw new ApiError("Invalid response from service. Refresh safely.",502,commandId,mutation)}
  if(!response.ok){const error=data as {message?:string;code?:string;command_id?:string;outcome?:string};throw new ApiError(error.message||`Request failed (${response.status})`,response.status,error.command_id||commandId,mutation&&(error.outcome==="unknown"||(response.status>=500&&error.outcome!=="not_dispatched")),error.code,response.headers.get("X-Request-ID")||undefined)}
  try{const parsed=validateResponse(path,data) as T;release();return parsed}catch{throw new ApiError("Service response does not match the expected contract. Data is unavailable.",502,commandId,mutation)}
 }catch(error){
  const e=error instanceof ApiError?error:new ApiError(controller.signal.aborted?"Request timed out or was cancelled. Check the command outcome before retrying.":"Network unavailable. Reconnect and retry reads.",0,commandId,mutation&&!auth);
  if(e.uncertain&&e.commandId){try{localStorage.setItem("twin-uncertain-command",e.commandId)}catch{};window.dispatchEvent(new Event("command-outcome"))}
  if(!e.uncertain)release();
  if(e.status===401)window.dispatchEvent(new Event("session-expired"));
  throw e;
 }finally{clearTimeout(timeout);options?.signal?.removeEventListener("abort",abort)}
}
const positive = z.number().finite().positive();
const node = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["controlled", "boundary"]),
  x: z.number().finite(),
  y: z.number().finite(),
});
const link = z.object({
  id: z.string(),
  from_node: z.string(),
  to_node: z.string(),
  length_m: positive,
  lanes: positive.int(),
  storage_capacity_veh: positive.int(),
  free_flow_speed_kph: positive,
});
const movement = z.object({
  id: z.string(),
  node_id: z.string(),
  incoming_link_id: z.string(),
  outgoing_link_id: z.string(),
  turning_ratio: positive.max(1),
});
const phase = z.object({
  id: z.string(),
  node_id: z.string(),
  movement_ids: z.array(z.string()),
  min_green_s: positive,
  max_green_s: positive,
  amber_s: positive,
  all_red_s: positive,
});
export const networkSchema = z.object({
  schema_version: z.literal("1.0"),
  id: z.string(),
  name: z.string(),
  units: z.record(z.string(), z.string()),
  nodes: z.array(node).min(2),
  links: z.array(link),
  movements: z.array(movement),
  phases: z.array(phase),
  conflicts: z.array(z.tuple([z.string(), z.string()])),
  scenarios: z.array(
    z.object({
      id: z.enum(["peak_surge", "incident_c3", "ambulance_corridor"]),
      seed: positive.int(),
      route_node_ids: z.array(z.string()),
      capacity_ratio: z.number().min(0).max(1),
    }),
  ),
});

export async function getNetwork() {
  try {
    return {...networkSchema.parse(await request<unknown>("/network")), provenance: "server" as const};
  } catch (error) {
    if (!(error instanceof ApiError) || ![0, 500, 502, 503, 504].includes(error.status)) throw error;
    return {...networkSchema.parse(fallbackNetworkConfig), provenance: "bundled-offline" as const};
  }
}
