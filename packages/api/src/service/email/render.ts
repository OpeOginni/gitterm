import type { ReactElement } from "react";
import { render } from "@react-email/components";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renders a React Email template into HTML and plain-text bodies.
 * Templates should use `emailTailwindConfig` from `./theme` for consistent styling.
 */
export async function renderEmail(subject: string, element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
