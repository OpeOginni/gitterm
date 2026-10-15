import type { Terminal } from "@xterm/xterm";

export function attachTouch(terminal: Terminal, host: HTMLElement, activity: () => void) {
  const screen = terminal.element!.querySelector<HTMLElement>(".xterm-screen")!;
  let start: { x: number; y: number } | undefined;
  let last = { x: 0, y: 0 };
  let axis: "x" | "y" | undefined;
  let remainder = 0;
  const begin = (event: TouchEvent) => {
    start =
      event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
        : undefined;
    if (start) last = start;
    axis = undefined;
    remainder = 0;
  };
  const move = (event: TouchEvent) => {
    if (!start || event.touches.length !== 1) {
      start = undefined;
      return;
    }
    const touch = event.touches[0];
    if (!axis) {
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      if (Math.max(dx, dy) < 10) return;
      axis = dx > dy && host.scrollWidth > host.clientWidth ? "x" : "y";
    }
    event.preventDefault();
    // Prevent xterm's own touch handler from also scrolling this gesture.
    event.stopPropagation();
    activity();
    if (axis === "x") host.scrollLeft += last.x - touch.clientX;
    else {
      const lineHeight = screen.getBoundingClientRect().height / terminal.rows;
      remainder += last.y - touch.clientY;
      const lines = Math.trunc(remainder / Math.max(1, lineHeight));
      if (lines) {
        if (terminal.modes.mouseTrackingMode !== "none") {
          // xterm encodes the wheel using the application's negotiated protocol.
          screen.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: touch.clientX,
              clientY: touch.clientY,
              deltaY: lines,
              deltaMode: WheelEvent.DOM_DELTA_LINE,
            }),
          );
        } else if (terminal.buffer.active.type === "normal") terminal.scrollLines(lines);
        remainder -= lines * lineHeight;
      }
    }
    last = { x: touch.clientX, y: touch.clientY };
  };
  const end = (event: TouchEvent) => {
    if (axis) {
      event.preventDefault();
      event.stopPropagation();
    }
    start = undefined;
  };
  screen.addEventListener("touchstart", begin, { passive: true, capture: true });
  screen.addEventListener("touchmove", move, { passive: false, capture: true });
  screen.addEventListener("touchend", end, { passive: false, capture: true });
  screen.addEventListener("touchcancel", end, { passive: false, capture: true });
  return () => {
    screen.removeEventListener("touchstart", begin, true);
    screen.removeEventListener("touchmove", move, true);
    screen.removeEventListener("touchend", end, true);
    screen.removeEventListener("touchcancel", end, true);
  };
}
