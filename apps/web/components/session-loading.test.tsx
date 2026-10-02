import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {SessionPanel, type Session} from './session-panel';
import {request} from '@/lib/api';
vi.mock('@/lib/api',async importOriginal=>({...await importOriginal<typeof import('@/lib/api')>(),request:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('shows a skeleton while the session request is pending and replaces it with the verified identity',async()=>{
 let finish!:(value:Session)=>void;
 vi.mocked(request).mockReturnValue(new Promise<Session>(resolve=>{finish=resolve;}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={client}><SessionPanel/></QueryClientProvider>);
 expect(screen.getByRole('status')).toHaveTextContent('Checking session…');
 expect(screen.queryByRole('button',{name:'Sign in'})).not.toBeInTheDocument();
 finish({actor:'test-operator',role:'operator'});
 await waitFor(()=>expect(screen.getByText('test-operator')).toBeInTheDocument());
 expect(screen.queryByTestId('loading-placeholder')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Sign out'})).toBeEnabled();
 client.clear();
});

it('explains how to provision local access and load virtual data while signed out',async()=>{
 vi.mocked(request).mockResolvedValue(null);
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={client}><SessionPanel/></QueryClientProvider>);
 await screen.findByText('Local startup help');
 expect(screen.getByText(/create-gateway-user.py/)).toBeInTheDocument();
 expect(screen.getByText(/Seeded reference scenario/)).toBeInTheDocument();
 client.clear();
});
