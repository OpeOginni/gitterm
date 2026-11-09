/**
 * Provider access headers renamed to what the Gitterm proxy forwards (the copy_headers
 * lists in apps/proxy/Caddyfile*). Boat's `_port_auth` cookie travels as a header there.
 */
export function proxyRouteHeaders(headers: Record<string, string>): Record<string, string> {
  const forwarded = new Set([
    "e2b-traffic-access-token",
    "x-daytona-preview-token",
    "x-daytona-skip-preview-warning",
    "x-exedev-authorization",
  ]);
  const routed: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const boat = name.toLowerCase() === "cookie" ? /^_port_auth=([^;]+)$/.exec(value)?.[1] : null;
    if (boat) routed["X-GitTerm-Boat-Token"] = boat;
    else if (forwarded.has(name.toLowerCase())) routed[name] = value;
    else throw new Error(`The Gitterm proxy cannot forward the ${name} preview header`);
  }
  return routed;
}
