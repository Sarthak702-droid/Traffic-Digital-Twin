"use client";

import {Button} from "@/components/ui/button";
import {LoadingState} from "@/components/ui/loading";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, request, pendingCommand, clearPendingCommand } from "@/lib/api";
import { useWorkspace } from "@/lib/state";

export interface Session { actor:string;role:"operator"|"supervisor"|"viewer" }

export function useSession(){
 return useQuery({queryKey:["session"],queryFn:async ({signal}):Promise<Session|null>=>{
  try{return await request<Session>("/session",{signal})}
  catch(error){if(error instanceof ApiError&&error.status===401)return null;throw error}
 },retry:false,refetchInterval:30000});
}

export function SessionPanel({onReviewFinished}:{onReviewFinished?:(commandId:string)=>void}={}){
 const session=useSession();
 const client=useQueryClient();
 const [username,setUsername]=useState("");
 const [password,setPassword]=useState("");
 const [uncertain,setUncertain]=useState<string|null>(null);
 const [reviewed,setReviewed]=useState(false);
 const setRole=useWorkspace(s=>s.setRole);

 useEffect(()=>{
  const update=()=>setUncertain(pendingCommand());
  const expired=()=>{
   // Repeated 401s from an expired batch must not reset active queries again.
   if(!client.getQueryData<Session|null>(["session"]))return;
   client.setQueryData<Session|null>(["session"],null);
   client.removeQueries({predicate:q=>q.queryKey[0]!=="session"});
  };
  update();
  window.addEventListener("command-outcome",update);
  window.addEventListener("storage",update);
  window.addEventListener("session-expired",expired);
  return()=>{window.removeEventListener("command-outcome",update);window.removeEventListener("storage",update);window.removeEventListener("session-expired",expired)};
 },[client]);

 useEffect(()=>{setRole(session.isSuccess&&session.data?.role?session.data.role:"viewer")},[session.isSuccess,session.data?.role,setRole]);

 const login=useMutation({
  mutationFn:()=>request<Session>("/session/login",{method:"POST",body:JSON.stringify({username,password})}),
  onSuccess:(identity)=>{
   setPassword("");
   client.setQueryData(["session"],identity);
   client.invalidateQueries();
  },
 });
 const logout=useMutation({
  mutationFn:()=>request<{success:boolean}>("/session/logout",{method:"POST",body:"{}"}),
  onSuccess:()=>{
   setRole("viewer");
   client.removeQueries({predicate:q=>q.queryKey[0]!=="session"});
   client.setQueryData<Session|null>(["session"],null);
   client.invalidateQueries({queryKey:["session"]});
  },
 });

 const outcome=useQuery({queryKey:["command-outcome",uncertain],queryFn:()=>request<{status:string;response:unknown}>(`/commands/${uncertain}`),enabled:!!uncertain&&session.isSuccess&&!!session.data,refetchInterval:3000,retry:false});
 const identity=session.isSuccess?session.data:null;
 const active=!!identity;
 const authError=session.error instanceof ApiError ? session.error : null;
 const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();login.mutate()};

 return <section className="session-panel" aria-label="Session and command recovery">
 {active && session.data ? <div><p>Authenticated session · <strong>{session.data.actor}</strong> · {session.data.role}</p><Button variant="outline" type="button" onClick={()=>logout.mutate()} loading={logout.isPending}>Sign out</Button>{logout.error&&<p role="alert">Sign-out could not be confirmed. Try again before leaving this browser.</p>}</div>
 : <div>
   {session.isPending ? <LoadingState compact label="Checking session…"/> : <p role="alert">{authError?.status===401?"Sign in to use the operator workspace.":session.isError?"Session service unavailable. Your unsent draft and command ID remain here.":"Sign in to use the operator workspace."}</p>}
   {!session.isPending&&<form onSubmit={submit}>
    <label>Username <input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required/></label>
    <label>Password <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
    <Button type="submit" loading={login.isPending}>{login.isPending?"Signing in…":"Sign in"}</Button>
   </form>}
   {login.error&&<p role="alert">{login.error instanceof ApiError&&login.error.status===401?"Invalid username or password.":"Sign-in unavailable. Try again when the API recovers."}</p>}
  </div>}
 {uncertain&&<div role="alert"><h2>Previous command needs review</h2><p>Command <code>{uncertain}</code> · {outcome.data?.status||"outcome unavailable"}. Do not repeat an uncertain action.</p>
 <details><summary>Saved outcome</summary><pre>{JSON.stringify(outcome.data?.response??{},null,2)}</pre></details>
 <p>{!active?"Sign in as the same operator to inspect this command. The browser will not submit it again.":outcome.error && (outcome.error as {status?:number}).status===404 ? "This Go API has no durable record of the command, so it was not committed here. Review the current plan and Audit & Health before clearing this stale browser-only record." : "Inspect the current plan and Audit & Health. If the outcome remains unknown, ask a supervisor to reconcile it before further changes."}</p>
 <label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I have checked the recorded outcome and current plan.</label>
 <button disabled={!active||!reviewed||!(outcome.data?.status==="completed" || (outcome.error as {status?:number}|undefined)?.status===404)} onClick={()=>{const commandId=uncertain;clearPendingCommand();setReviewed(false);onReviewFinished?.(commandId);client.invalidateQueries()}}>Finish review (does not retry)</button>
 </div>}
 </section>;
}
