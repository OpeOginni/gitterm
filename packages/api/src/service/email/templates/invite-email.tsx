import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { EMAIL_CANVAS, emailTailwindConfig } from "../theme";

export interface InviteEmailProps {
  preheader: string;
  eyebrow: string;
  /** The thing being shared: a workspace or team name. */
  subjectName: string;
  inviterName: string;
  inviterEmail: string;
  /** Workspace-only: shown as a role pill. */
  role?: string;
  /** Workspace-only: repo chip with the GitHub mark. */
  repositoryUrl?: string | null;
  /** Short supporting line under the heading. */
  blurb: string;
  ctaLabel: string;
  ctaUrl: string;
  expiresLabel: string;
  logoUrl: string;
  githubIconUrl: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Reduce a repo URL to `owner/name`, e.g. https://github.com/a/b.git -> a/b */
function repoDisplay(url: string): string {
  const path = url
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : path;
}

export function InviteEmail(props: InviteEmailProps) {
  const {
    preheader,
    eyebrow,
    subjectName,
    inviterName,
    inviterEmail,
    role,
    repositoryUrl,
    blurb,
    ctaLabel,
    ctaUrl,
    expiresLabel,
    logoUrl,
    githubIconUrl,
  } = props;

  return (
    <Html lang="en">
      <Head />
      <Preview>{preheader}</Preview>
      <Tailwind config={emailTailwindConfig}>
        <Body
          className="font-sans"
          style={{ backgroundColor: EMAIL_CANVAS, margin: 0, padding: 0 }}
        >
          <Container className="mx-auto w-full max-w-[560px] px-4 py-10">
            <Section className="overflow-hidden rounded-2xl border border-solid border-border bg-background">
              {/* Brand header */}
              <Section className="bg-popover px-8 py-5">
                <Row>
                  <Column className="w-[30px] align-middle">
                    <Img
                      src={logoUrl}
                      width="22"
                      height="22"
                      alt="GitTerm"
                      style={{ display: "block" }}
                    />
                  </Column>
                  <Column className="pl-2.5 align-middle">
                    <Text className="m-0 font-mono text-[14px] font-bold uppercase tracking-[0.18em] text-foreground">
                      Git<span className="text-primary">Term</span>
                    </Text>
                  </Column>
                </Row>
              </Section>

              <Hr className="m-0 border-border-soft" />

              {/* Content */}
              <Section className="px-8 py-8">
                <Text className="m-0 mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                  {eyebrow}
                </Text>
                <Heading className="m-0 font-serif text-[26px] font-semibold leading-[1.2] text-foreground">
                  {subjectName}
                </Heading>

                {/* Inviter */}
                <Row className="mt-5">
                  <Column className="w-[40px] align-middle">
                    <div
                      className="text-center font-bold text-primary-foreground"
                      style={{
                        width: 32,
                        height: 32,
                        lineHeight: "32px",
                        borderRadius: "50%",
                        backgroundColor: "#c8a44e",
                        fontSize: 12,
                      }}
                    >
                      {initials(inviterName)}
                    </div>
                  </Column>
                  <Column className="align-middle">
                    <Text className="m-0 text-[14px] text-muted-foreground">
                      Invited by{" "}
                      <span className="font-semibold text-foreground">
                        {inviterName}
                      </span>{" "}
                      <span className="text-faint">({inviterEmail})</span>
                    </Text>
                  </Column>
                </Row>

                <Text className="m-0 mt-5 text-[15px] leading-[1.6] text-muted-foreground">
                  {blurb}
                </Text>

                {/* Repo + role */}
                {repositoryUrl ? (
                  <Section className="mt-4 rounded-xl border border-solid border-border bg-surface-2 px-3.5 py-3">
                    <Row>
                      <Column className="w-[26px] align-middle">
                        <Img
                          src={githubIconUrl}
                          width="15"
                          height="15"
                          alt="GitHub"
                          style={{ display: "block" }}
                        />
                      </Column>
                      <Column className="align-middle">
                        <Link
                          href={repositoryUrl}
                          className="m-0 font-mono text-[12px] text-primary no-underline"
                        >
                          {repoDisplay(repositoryUrl)}
                        </Link>
                      </Column>
                    </Row>
                  </Section>
                ) : null}

                {role ? (
                  <Text className="m-0 mt-3 text-[13px] text-muted-foreground">
                    Role:{" "}
                    <span
                      className="font-semibold text-primary"
                      style={{
                        display: "inline-block",
                        padding: "1px 9px",
                        borderRadius: 999,
                        backgroundColor: "rgba(200,164,78,0.14)",
                        border: "1px solid #c8a44e",
                        fontSize: 12,
                      }}
                    >
                      {role}
                    </span>
                  </Text>
                ) : null}

                {/* CTA */}
                <Section className="mt-7">
                  <Button
                    href={ctaUrl}
                    className="rounded-[10px] bg-primary px-7 py-3.5 text-[14px] font-bold text-primary-foreground no-underline"
                  >
                    {ctaLabel}
                  </Button>
                </Section>

                <Hr className="my-7 border-border-soft" />

                <Text className="m-0 mb-1.5 text-[12px] leading-[1.6] text-faint">
                  This invite expires {expiresLabel}. If the button doesn't
                  work, copy and paste this link:
                </Text>
                <Link
                  href={ctaUrl}
                  className="break-all font-mono text-[12px] text-primary no-underline"
                >
                  {ctaUrl}
                </Link>
              </Section>
            </Section>

            {/* Footer */}
            <Section className="px-6 pt-5 text-center">
              <Text className="m-0 text-[12px] leading-[1.6] text-faint">
                Not expecting this? You can ignore this email and nothing will
                happen.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default InviteEmail;
