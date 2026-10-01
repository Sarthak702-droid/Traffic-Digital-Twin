import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {Button} from './button';
import {LoadingState} from './loading';
afterEach(cleanup);
it('announces a pending action and prevents duplicate submission until it finishes',()=>{
 const submit=vi.fn(); const {rerender}=render(<Button loading onClick={submit}>Export report</Button>);
 const button=screen.getByRole('button',{name:'Export report'});
 expect(button).toHaveAttribute('aria-busy','true'); expect(button).toBeDisabled();
 fireEvent.click(button); expect(submit).not.toHaveBeenCalled();
 rerender(<Button loading={false} onClick={submit}>Export report</Button>);
 expect(button).not.toBeDisabled(); fireEvent.click(button); expect(submit).toHaveBeenCalledOnce();
});
it('exposes one readable loading status without announcing decorative placeholders',()=>{
 render(<LoadingState label="Loading audit history…"/>);
 expect(screen.getByRole('status')).toHaveTextContent('Loading audit history…');
 expect(screen.getByRole('status')).toHaveAttribute('aria-busy','true');
 expect(screen.getByTestId('loading-placeholder')).toHaveAttribute('aria-hidden','true');
});
it('keeps an existing permission-disabled button disabled when loading completes',()=>{
 const {rerender}=render(<Button loading disabled>Approve</Button>);
 rerender(<Button loading={false} disabled>Approve</Button>);
 expect(screen.getByRole('button',{name:'Approve'})).toBeDisabled();
});
