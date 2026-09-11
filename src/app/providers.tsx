"use client";

import { Suspense } from "react";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { PwaProvider } from "@/components/pwa/PwaProvider";

function AuthFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#111827] text-slate-200">
      Loading Ask…
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthProvider>
        <PwaProvider />
        {children}
      </AuthProvider>
    </Suspense>
  );
}
