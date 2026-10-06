import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { EMAIL_CANVAS, emailTailwindConfig } from "../theme";

/** A billing usage alert with a link to the billing settings. */
export function BillingNoticeEmail({
  subject,
  message,
  billingUrl,
}: {
  subject: string;
  message: string;
  billingUrl: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{subject}</Preview>
      <Tailwind config={emailTailwindConfig}>
        <Body style={{ backgroundColor: EMAIL_CANVAS }} className="m-0 py-10 font-sans">
          <Container className="mx-auto max-w-[480px] rounded-2xl bg-card p-8">
            <Text className="m-0 font-mono text-xs uppercase tracking-widest text-primary">
              GitTerm billing
            </Text>
            <Text className="mt-4 text-lg font-semibold text-foreground">{subject}</Text>
            <Text className="text-sm leading-6 text-muted-foreground">{message}</Text>
            <Section className="mt-6">
              <Button
                href={billingUrl}
                className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                Open billing settings
              </Button>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
