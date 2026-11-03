"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import { isEmailAuthEnabled, isGitHubAuthEnabled } from "@gitterm/env/web";
import { clearAuthAttempt, trackAuthStarted } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const buttonBase =
  "inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg px-4 text-[14.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryButton = "bg-primary text-primary-foreground hover:bg-[#c09a45]";
const secondaryButton =
  "bg-white/[0.04] text-fg-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-white/[0.07] hover:text-fg";
const inputClass =
  "h-11 border-line bg-fill text-[15px] text-fg placeholder:text-fg-4 md:text-[15px] focus-visible:border-primary/50 focus-visible:ring-primary/20";

interface AuthFormProps {
  redirectUrl?: string;
  authError?: string | null;
}

const authErrorMessages: Record<string, string> = {
  unable_to_get_user_info:
    "We couldn't access your GitHub account details. Sign out of GitHub in this browser, then try again with the account you want to use.",
};

export function AuthForm({ redirectUrl, authError }: AuthFormProps) {
  const { isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayedError =
    error ||
    (authError ? authErrorMessages[authError] || "GitHub sign-in failed. Please try again." : null);

  const emailAuthEnabled = isEmailAuthEnabled();
  const githubAuthEnabled = isGitHubAuthEnabled();
  useEffect(() => {
    if (authError) clearAuthAttempt();
  }, [authError]);

  const getCallbackURL = () => {
    // Use the origin the user actually visited, not a potentially stale build-time domain.
    const webOrigin = window.location.origin;
    const requestedCallback = new URL(redirectUrl || "/dashboard", webOrigin);
    return requestedCallback.origin === webOrigin
      ? requestedCallback.toString()
      : new URL("/dashboard", webOrigin).toString();
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    trackAuthStarted("email");

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: getCallbackURL(),
      });
      if (result.error) {
        clearAuthAttempt();
        setError(result.error.message || "Failed to sign in");
        return;
      }
    } catch (err) {
      clearAuthAttempt();
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGitHubAuth = () => {
    trackAuthStarted("github");
    authClient.signIn.social({
      provider: "github",
      callbackURL: getCallbackURL(),
    });
  };

  if (!emailAuthEnabled && !githubAuthEnabled) {
    return (
      <p className="text-center text-[15px] text-[#fb923c]">
        No authentication methods are enabled. Contact the administrator.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {githubAuthEnabled && (
        <>
          <button
            type="button"
            onClick={handleGitHubAuth}
            disabled={isPending}
            className={cn(buttonBase, primaryButton)}
          >
            {isPending ? (
              <Loader2 className="size-[18px] animate-spin" />
            ) : (
              <svg viewBox="0 0 1024 1024" fill="none" className="size-[18px]">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
                  transform="scale(64)"
                  fill="currentColor"
                />
              </svg>
            )}
            {isPending ? "Loading..." : "Continue with GitHub"}
          </button>
          {emailAuthEnabled && (
            <div className="flex items-center gap-4 py-1">
              <div className="h-px flex-1 bg-line" />
              <span className="text-[13px] text-fg-4">or</span>
              <div className="h-px flex-1 bg-line" />
            </div>
          )}
        </>
      )}

      {emailAuthEnabled && (
        <>
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-2 block text-[14px] font-medium text-fg-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-2 block text-[14px] font-medium text-fg-2">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={isSubmitting}
                className={inputClass}
              />
            </div>

            {displayedError && <p className="text-[14.5px] text-[#fb923c]">{displayedError}</p>}

            <button
              type="submit"
              className={cn(buttonBase, githubAuthEnabled ? secondaryButton : primaryButton)}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="size-[18px] animate-spin" /> : null}
              Sign in
            </button>
          </form>

          <p className="text-center text-[13px] text-fg-4">
            Want to sign up? Contact the administrator.
          </p>
        </>
      )}

      {!emailAuthEnabled && displayedError && (
        <p className="rounded-lg bg-fill px-4 py-3 text-[14.5px] leading-relaxed text-[#fb923c]">
          {displayedError}
        </p>
      )}
    </div>
  );
}
