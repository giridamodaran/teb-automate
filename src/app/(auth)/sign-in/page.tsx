"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { TebApiError } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";

const EMAIL_RE = /^[\w-.]+@([\w-]+\.)+[\w-]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[!@#$%^&*]).{7,}$/;

export default function SignInPage() {
  const router = useRouter();
  const { signIn, rememberedEmail, ready, user } = useAuth();
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const email = emailDraft ?? rememberedEmail;
  const rememberEmail = emailDraft === null ? Boolean(rememberedEmail) : rememberMe;

  const emailValid = EMAIL_RE.test(email);
  const passwordValid = PASSWORD_RE.test(password);
  const canSubmit = emailValid && passwordValid && !submitting;

  const emailHint = useMemo(() => {
    if (!email) return "Email address is required";
    if (!emailValid) return "Please enter a valid email address";
    return "";
  }, [email, emailValid]);

  const passwordHint = useMemo(() => {
    if (!password) return "Password is required";
    if (!passwordValid) {
      return "Password must be 7+ characters with upper, lower, number, and special (!@#$%^&*)";
    }
    return "";
  }, [password, passwordValid]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const next = await signIn(email.trim(), password, rememberEmail);
      router.replace(next);
    } catch (err) {
      const message =
        err instanceof TebApiError
          ? err.message
          : err instanceof Error && err.message
            ? err.message
            : "Unable to sign in. Try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready || user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#111827] text-slate-200">
        {user ? "Opening Ask…" : "Loading…"}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-white">
      <div className="flex w-full items-center justify-center px-6 md:w-5/12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-4">
            <img
              src="https://d13lb5v8nsslch.cloudfront.net/login/logo.png"
              alt="TEB"
              className="h-16 w-16 object-contain"
            />
            <h1 className="text-2xl font-extrabold tracking-tight">Login to TEB Ask</h1>
          </div>

          {error ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Email address</span>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmailDraft(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#086fb8]"
                placeholder="Enter your email"
              />
              {emailHint && email.length > 0 ? <span className="text-xs text-red-600">{emailHint}</span> : null}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Password</span>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 pr-16 outline-none focus:border-[#086fb8]"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 text-xs font-medium text-[#086fb8]"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {passwordHint && password.length > 0 ? (
                <span className="text-xs text-red-600">{passwordHint}</span>
              ) : null}
            </label>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberEmail}
                  onChange={(event) => {
                    setRememberMe(event.target.checked);
                    if (emailDraft === null) setEmailDraft(email);
                  }}
                />
                Remember me
              </label>
              <Link href="/forgot-password" className="font-medium text-[#086fb8] hover:underline">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-2 rounded-full bg-[#086fb8] py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-10 flex items-center justify-center gap-3 text-sm text-[#086fb8]">
            <a href="https://tebillion.com/privacy-policy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
            <span className="text-slate-400">|</span>
            <a
              href="https://tebillion.atlassian.net/servicedesk/customer/portal/3"
              target="_blank"
              rel="noreferrer"
            >
              Help Center
            </a>
          </div>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-[#086fb8] md:flex md:w-7/12">
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full text-white/15"
          viewBox="0 0 960 540"
          preserveAspectRatio="xMidYMax slice"
        >
          <g fill="none" stroke="currentColor" strokeWidth="100">
            <circle r="234" cx="196" cy="23" />
            <circle r="234" cx="790" cy="491" />
          </g>
        </svg>
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <p className="text-sm uppercase tracking-[0.2em] text-white/70">TEBillion</p>
          <h2 className="mt-4 max-w-lg text-4xl font-semibold leading-tight">
            Technology enabling businesses to make smarter decisions.
          </h2>
          <p className="mt-4 max-w-md text-white/80">
            Sign in with your live TEB Cloud account. Ask about quotes, the team, tickets, and more.
          </p>
        </div>
      </div>
    </div>
  );
}
