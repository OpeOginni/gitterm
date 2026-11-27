export function observeViewport(shell: HTMLElement) {
  const viewport = window.visualViewport;
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // Do not resize the terminal during accessibility pinch zoom.
      if (viewport && viewport.scale !== 1) return;
      shell.style.height = `${viewport?.height ?? innerHeight}px`;
      shell.style.top = `${viewport?.offsetTop ?? 0}px`;
    });
  };
  update();
  window.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", update);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
  };
}
