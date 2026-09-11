"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { forgotPassword } from "@/lib/api/auth";
import { getDeviceAddress } from "@/lib/api/client";

const EMAIL_RE = /^[\w-.]+@([\w-]+\.)+[\w-]{2,}$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const emailValid = EMAIL_RE.test(email);
  const canSubmit = emailValid && !submitting;

  const emailHint = useMemo(() => {
    if (!email) return "Email address is required";
    if (!emailValid) return "Please enter a valid email address";
    return "";
  }, [email, emailValid]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const ip = await getDeviceAddress();
      await forgotPassword(email.trim(), window.location.origin, ip);
    } catch {
      // Live app always shows a generic success message.
    } finally {
      setDone(true);
      setSubmitting(false);
    }
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
            <h1 className="text-2xl font-extrabold tracking-tight">Forgot password</h1>
            <p className="text-center text-sm text-slate-500">
              Enter your email and we will send a reset link if the account exists.
            </p>
          </div>

          {done ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              If the username exists, a reset link has been sent to your email.
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#086fb8]"
                  placeholder="Enter your email"
                />
                {emailHint && email.length > 0 ? <span className="text-xs text-red-600">{emailHint}</span> : null}
              </label>
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-full bg-[#086fb8] py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}

          <Link href="/sign-in" className="mt-8 inline-block text-sm font-medium text-[#086fb8] hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
      <div className="hidden bg-[#086fb8] md:block md:w-7/12" />
    </div>
  );
}
