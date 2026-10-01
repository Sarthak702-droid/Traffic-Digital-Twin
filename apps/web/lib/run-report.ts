import {request} from './api';
export async function downloadRunReport(runId:string):Promise<void>{
 const report=await request<{schema_version?:string;run_id?:string}>(`/runs/${encodeURIComponent(runId)}/report`);
 if(report.schema_version!=='prototype-run-report-v2'||report.run_id!==runId)throw new Error('Report does not match the requested run.');
 const url=`/api/v1/runs/${encodeURIComponent(runId)}/report`;
 const anchor=document.createElement('a');anchor.href=url;anchor.download=`traffic-run-${runId}.json`;
 document.body.appendChild(anchor);
 try{anchor.click()}finally{setTimeout(()=>anchor.remove(),1000)}
}
