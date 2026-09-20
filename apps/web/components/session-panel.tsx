"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request, pendingCommand, clearPendingCommand } from "@/lib/api";
import { useWorkspace } from "@/lib/state";
export interface Session { actor:string;role:"operator"|"supervisor"|"viewer" }
export function useSession(){return useQuery({queryKey:["session"],queryFn:()=>request<Session>("/session"),retry:false,refetchInterval:30000})}
export function SessionPanel(){
 const session=useSession();const client=useQueryClient();const [username,setUsername]=useState("");const [password,setPassword]=useState("");const [uncertain,setUncertain]=useState<string|null>(null);const [reviewed,setReviewed]=useState(false);
 useEffect(()=>{const update=()=>setUncertain(pendingCommand());const expired=()=>client.invalidateQueries({queryKey:["session"]});update();window.addEventListener("command-outcome",update);window.addEventListener("storage",update);window.addEventListener("session-expired",expired);return()=>{window.removeEventListener("command-outcome",update);window.removeEventListener("storage",update);window.removeEventListener("session-expired",expired)}},[client]);
 useEffect(()=>{if(session.data)useWorkspace.getState().setRole(session.data.role)},[session.data]);
 const login=useMutation({mutationFn:()=>request<Session>("/session/login",{method:"POST",body:JSON.stringify({username,password})}),onSuccess:()=>{setPassword("");client.invalidateQueries()}});
 const logout=useMutation({mutationFn:()=>request("/session/logout",{method:"POST",body:"{}"}),onSuccess:()=>{client.removeQueries();client.invalidateQueries()}});
 const outcome=useQuery({queryKey:["command-outcome",uncertain],queryFn:()=>request<{status:string;response:unknown}>(`/commands/${uncertain}`),enabled:!!uncertain&&session.isSuccess,refetchInterval:3000,retry:false});
 return <section className="session-panel" aria-label="Session and command recovery">
 {session.isSuccess&&!session.isError ? <p>Signed in as <strong>{session.data.actor}</strong> · {session.data.role} <button disabled={logout.isPending} onClick={()=>logout.mutate()}>Sign out</button></p> : <form onSubmit={e=>{e.preventDefault();login.mutate()}}>
 <h2>Sign in to the digital twin</h2><p>Service accounts are provisioned locally by your administrator. An expired session does not submit or discard your draft.</p>
 <label>Username <input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)}/></label>
 <label>Password <input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
 <button disabled={login.isPending}>{login.isPending?"Signing in…":"Sign in"}</button>{login.error&&<p role="alert">{login.error.message}</p>}
 </form>}
 {logout.error&&<p role="alert">{logout.error.message}</p>}
 {uncertain&&<div role="alert"><h2>Previous command needs review</h2><p>Command <code>{uncertain}</code> · {outcome.data?.status||"outcome unavailable"}. Do not repeat an uncertain action.</p>
 <details><summary>Saved outcome</summary><pre>{JSON.stringify(outcome.data?.response??{},null,2)}</pre></details>
 <p>{outcome.error && (outcome.error as {status?:number}).status===404 ? "This Go API has no durable record of the command, so it was not committed here. Review the current plan and Audit & Health before clearing this stale browser-only record." : "Inspect the current plan and Audit & Health. If the outcome remains unknown, ask a supervisor to reconcile it before further changes."}</p>
 <label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I have checked the recorded outcome and current plan.</label>
 <button disabled={!reviewed||!(outcome.data?.status==="completed" || (outcome.error as {status?:number}|undefined)?.status===404)} onClick={()=>{clearPendingCommand();setReviewed(false);client.invalidateQueries()}}>Finish review (does not retry)</button>
 </div>}
 </section>;
}
