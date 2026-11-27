import type { Terminal } from "@xterm/xterm";

/** How long a press is held before it selects text, as phones do. */
const LONG_PRESS_MS = 500;

/**
 * Vertical swipes scroll: the program's own scrolling when it tracks the mouse (tmux, most
 * TUIs), otherwise the terminal's scrollback. A long press calls `longPress`, to select text.
 * Taps fall through, to focus the terminal.
 */
export function attachTouch(terminal: Terminal, activity: () => void, longPress: () => void) {
  const screen = terminal.element!.querySelector<HTMLElement>(".xterm-screen")!;
  let startY: number | undefined;
  let lastY = 0;
  let scrolling = false;
  let pressed = false;
  let remainder = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const begin = (event: TouchEvent) => {
    startY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
    if (startY !== undefined) lastY = startY;
    scrolling = false;
    pressed = false;
    remainder = 0;
    clearTimeout(timer);
    if (startY !== undefined) {
      timer = setTimeout(() => {
        pressed = true;
        longPress();
      }, LONG_PRESS_MS);
    }
  };
  const move = (event: TouchEvent) => {
    if (startY === undefined || event.touches.length !== 1) {
      startY = undefined;
      return;
    }
    const touch = event.touches[0];
    if (!scrolling) {
      if (Math.abs(touch.clientY - startY) < 10) return;
      scrolling = true;
      clearTimeout(timer);
    }
    event.preventDefault();
    // Prevent xterm's own touch handler from also scrolling this gesture.
    event.stopPropagation();
    activity();
    const lineHeight = screen.getBoundingClientRect().height / terminal.rows;
    remainder += lastY - touch.clientY;
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
    lastY = touch.clientY;
  };
  const end = (event: TouchEvent) => {
    clearTimeout(timer);
    // A scroll or a long press is not a tap: don't focus the terminal.
    if (scrolling || pressed) {
      event.preventDefault();
      event.stopPropagation();
    }
    startY = undefined;
  };
  screen.addEventListener("touchstart", begin, { passive: true, capture: true });
  screen.addEventListener("touchmove", move, { passive: false, capture: true });
  screen.addEventListener("touchend", end, { passive: false, capture: true });
  screen.addEventListener("touchcancel", end, { passive: false, capture: true });
  return () => {
    clearTimeout(timer);
    screen.removeEventListener("touchstart", begin, true);
    screen.removeEventListener("touchmove", move, true);
    screen.removeEventListener("touchend", end, true);
    screen.removeEventListener("touchcancel", end, true);
  };
}
