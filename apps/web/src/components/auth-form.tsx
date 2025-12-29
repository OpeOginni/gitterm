"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import env, { isEmailAuthEnabled, isGitHubAuthEnabled } from "@gitterm/env/web";

interface AuthFormProps {
  redirectUrl?: string;
}

export function AuthForm({ redirectUrl }: AuthFormProps) {
  const { isPending } = authClient.useSession();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailAuthEnabled = isEmailAuthEnabled();
  const githubAuthEnabled = isGitHubAuthEnabled();

  const webOrigin = `https://${env.NEXT_PUBLIC_BASE_DOMAIN}`;
  const callbackURL = new URL(
    redirectUrl && redirectUrl.startsWith("/") ? redirectUrl : "/dashboard",
    webOrigin
  ).toString();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (isSignUp) {
        const result = await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0],
          callbackURL,
        });
        if (result.error) {
          setError(result.error.message || "Failed to sign up");
          return;
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
          callbackURL,
        });
        if (result.error) {
          setError(result.error.message || "Failed to sign in");
          return;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  // If no auth methods are enabled, show error
  if (!emailAuthEnabled && !githubAuthEnabled) {
    return (
      <div className="flex flex-col items-center space-y-4 w-full max-w-sm">
        <p className="text-center text-sm text-destructive">
          No authentication methods are enabled. Please contact the administrator.
        </p>
      </div>
    );
  }

  // Email-only mode (no GitHub)
  if (emailAuthEnabled && !githubAuthEnabled) {
    return (
      <div className="flex flex-col items-center space-y-4 w-full max-w-sm">
        <form onSubmit={handleEmailAuth} className="w-full space-y-4">
          {isSignUp && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : null}
            {isSignUp ? "Sign Up" : "Sign In"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setIsSignUp(!isSignUp)}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
        </button>

        {/* Divider */}
        <div className="flex w-full items-center gap-4 py-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">Secure authentication</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Sign in with your email and password to access your account.
        </p>
      </div>
    );
  }

  // GitHub-only mode (no email)
  if (githubAuthEnabled && !emailAuthEnabled) {
    return (
      <div className="flex flex-col items-center space-y-4">
        <Button
          type="button"
          onClick={() => authClient.signIn.social({ 
            provider: "github", 
            callbackURL
          })}
          disabled={isPending}
          size="lg"
          className="w-full max-w-sm bg-foreground text-background hover:bg-foreground/90 border border-border"
        >
          {isPending ? (
            <Loader2 className="w-5 h-5 mr-3 animate-spin" />
          ) : (
            <svg viewBox="0 0 1024 1024" fill="none" className="w-5 h-5 mr-3">
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
        </Button>

        {/* Divider */}
        <div className="flex w-full max-w-sm items-center gap-4 py-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">Secure authentication</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <p className="text-center text-sm text-muted-foreground max-w-sm">
          We use GitHub for authentication. We'll access your public profile and email to create your account.
        </p>
      </div>
    );
  }

  // Both GitHub and Email enabled
  return (
    <div className="flex flex-col items-center space-y-4">
      {/* GitHub Login */}
      <Button
        type="button"
        onClick={() => authClient.signIn.social({ 
          provider: "github", 
          callbackURL
        })}
        disabled={isPending}
        size="lg"
        className="w-full max-w-sm bg-foreground text-background hover:bg-foreground/90 border border-border"
      >
        {isPending ? (
          <Loader2 className="w-5 h-5 mr-3 animate-spin" />
        ) : (
          <svg viewBox="0 0 1024 1024" fill="none" className="w-5 h-5 mr-3">
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
      </Button>

      {/* Divider */}
      <div className="flex w-full max-w-sm items-center gap-4 py-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Email Form */}
      <form onSubmit={handleEmailAuth} className="w-full max-w-sm space-y-4">
        {isSignUp && (
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            disabled={isSubmitting}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : null}
          {isSignUp ? "Sign Up" : "Sign In"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => setIsSignUp(!isSignUp)}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
      </button>

      {/* Divider */}
      <div className="flex w-full max-w-sm items-center gap-4 py-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">Secure authentication</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <p className="text-center text-sm text-muted-foreground max-w-sm">
        Sign in with GitHub or email to access your account.
      </p>
    </div>
  );
}
