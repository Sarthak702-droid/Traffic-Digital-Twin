"use client";
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
 return <main className="context-panel" role="alert"><h1>Workspace unavailable</h1><p>No successful command outcome is assumed. Retry loading, then inspect current state and audit before sending a new command.</p><button onClick={retry}>Retry workspace</button><a href="/?view=audit">Open audit after recovery</a></main>;
}
