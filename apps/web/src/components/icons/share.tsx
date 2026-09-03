import type { SVGProps } from "react";

/**
 * A small-size-safe share glyph.
 *
 * Lucide's Share2 draws its nodes and connectors as five separate shapes.
 * Their rounded strokes overlap at the node edges and form visible bulbs when
 * the 24px artwork is rasterized at compact navigation sizes. This preserves
 * Share2's larger three-pixel nodes and two-pixel stroke, but paints one path
 * and stops each connector cap at the outside of its node outline.
 */
export function ShareIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.455 9.984l5.09-2.968M9.455 14.016l5.09 2.968" />
    </svg>
  );
}
