import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const IAM_CONSOLE = "https://console.aws.amazon.com/iam/home#";

/** Deep link into the IAM console for a role ARN, or the roles list when the ARN is a placeholder. */
export function iamRoleConsoleUrl(roleArn: string) {
  const name = roleArn.split("/").at(-1);
  return name && !roleArn.includes("<ACCOUNT_ID>")
    ? `${IAM_CONSOLE}/roles/details/${encodeURIComponent(name)}`
    : `${IAM_CONSOLE}/roles`;
}

export function ConsoleLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ArrowUpRight className="size-3.5" />
      </a>
    </Button>
  );
}
