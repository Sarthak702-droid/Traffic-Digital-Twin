/** Request-bound placeholders; callers replace these with data or an error. */
export function LoadingState({label, compact=false}:{label:string;compact?:boolean}) {
 return <div className={`loading-state ${compact?'loading-state-compact':''}`} role="status" aria-live="polite" aria-busy="true">
  <div className="loading-caption"><span className="loading-spinner" aria-hidden="true"/>{label}</div>
  <div className="loading-placeholder" data-testid="loading-placeholder" aria-hidden="true">
   <span className="loading-line"/><span className="loading-line"/><span className="loading-line"/>
  </div>
 </div>;
}
