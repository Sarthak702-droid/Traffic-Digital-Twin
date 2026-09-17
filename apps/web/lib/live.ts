"use client";
import {useEffect,useState} from 'react';
import {create} from 'zustand';
import {z} from 'zod';
import type {TrafficState} from '../../../packages/contracts/typescript/events';
const nonnegative=z.number().finite().nonnegative();
const movement=z.object({movement_id:z.string(),queue_veh:nonnegative,arrival_rate_vpm:nonnegative,departure_rate_vpm:nonnegative,avg_speed_kph:nonnegative,occupancy_ratio:nonnegative.max(1),downstream_capacity_veh:nonnegative,current_phase_id:z.string(),waiting_age_s:nonnegative,vehicle_count:nonnegative.int(),arrivals_total:nonnegative.int(),departures_total:nonnegative.int(),permission:z.enum(['green','amber','red'])});
export const liveSchema=z.object({schema_version:z.literal('1.0'),run_id:z.string().min(1),timestamp:z.string().datetime({offset:true}),simulation_time_s:nonnegative,source:z.literal('synthetic'),movements:z.array(movement),signals:z.array(z.object({node_id:z.string(),phase_id:z.string(),indication:z.enum(['green','amber','all_red']),remaining_s:nonnegative,permitted_movement_ids:z.array(z.string())})),vehicles_in_network:nonnegative.int(),inserted_total:nonnegative.int(),arrived_total:nonnegative.int(),teleported_total:nonnegative.int(),scenario_type:z.string(),seed:nonnegative.int()});
export const useLiveStore=create<{frame:TrafficState|null;received:number;connected:boolean;failed:boolean;latency:number;set:(value:Partial<{frame:TrafficState|null;received:number;connected:boolean;failed:boolean;latency:number}>)=>void}>(set=>({frame:null,received:0,connected:false,failed:false,latency:0,set}));
export function useLive(){
 const store=useLiveStore();const [now,setNow]=useState(Date.now());
 useEffect(()=>{let socket:WebSocket;let timer:ReturnType<typeof setTimeout>;let disposed=false;
  const connect=()=>{socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/v1/live`);
   socket.onopen=()=>useLiveStore.getState().set({connected:true,failed:false});
   socket.onmessage=event=>{try{const envelope=JSON.parse(event.data);if(envelope.schema_version!=='1.0')throw Error('Unsupported event');if(envelope.type==='network.state'){const frame=liveSchema.parse(envelope.payload);const latency=Math.max(0,Date.now()-Date.parse(frame.timestamp));useLiveStore.getState().set({frame,received:Date.now(),latency,failed:false});}else if(envelope.type==='health.updated'){const simulation=envelope.payload.components?.find((c:{component:string})=>c.component==='simulation');if(simulation?.status==='unavailable')useLiveStore.getState().set({failed:true});}}catch{useLiveStore.getState().set({failed:true});}};
   socket.onerror=()=>socket.close();socket.onclose=()=>{useLiveStore.getState().set({connected:false});if(!disposed)timer=setTimeout(connect,1000);};};connect();
  const interval=setInterval(()=>setNow(Date.now()),250);return()=>{disposed=true;clearTimeout(timer);clearInterval(interval);socket.close();};
 },[]);
 return {...store,fresh:store.connected&&!store.failed&&!!store.frame&&now-store.received<2500};
}
