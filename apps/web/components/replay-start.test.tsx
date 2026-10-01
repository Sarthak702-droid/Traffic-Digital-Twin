import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {ReplayStart} from "./replay-start";

afterEach(cleanup);
describe("explicit replay replacement", () => {
  it("requires visible confirmation before replacing an active run", () => {
    const start=vi.fn(); render(<ReplayStart hasRun disabled={false} onStart={start}/>);
    fireEvent.click(screen.getByRole("button", {name:"Start golden replay"}));
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", {name:"Replace run with prerecorded replay"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Cancel"}));
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name:"Start golden replay"}));
    fireEvent.click(screen.getByRole("button", {name:"Replace run and start labeled replay"}));
    expect(start).toHaveBeenCalledTimes(1);
  });
  it("prevents submission if authorization or availability changes while confirming", () => {
    const start=vi.fn(); const {rerender}=render(<ReplayStart hasRun disabled={false} onStart={start}/>);
    fireEvent.click(screen.getByRole("button", {name:"Start golden replay"}));
    rerender(<ReplayStart hasRun disabled onStart={start}/>);
    expect(screen.getByRole("button", {name:"Replace run and start labeled replay"})).toBeDisabled();
    expect(start).not.toHaveBeenCalled();
  });
});
