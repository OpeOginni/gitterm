import type { SVGProps } from "react";

/**
 * The Gitterm mark: a block with one piece lifted out and moved away.
 * Drawn on a 28-unit grid. Uses currentColor. The images in /public/brand and /public/favicon_io
 * come from the same geometry.
 */
const MARK_PATH = "M0 7.5h13v7h7v13H0zM21 .5h7v7h-7z";

export function Mark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" fill="currentColor" aria-hidden {...props}>
      <path d={MARK_PATH} />
    </svg>
  );
}
