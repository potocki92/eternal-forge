import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/auth/login-form';
import { GuestOnly } from '@/auth/route-guards';
import { AuthLayout, inlineLinkClass } from '@/components/auth-layout';

export const metadata: Metadata = { title: 'Sign in · Eternal Forge' };

export default function LoginPage() {
  return (
    <GuestOnly>
      <AuthLayout
        title="Sign in"
        description="Welcome back. Your hero is where you left them."
        footer={
          <>
            New to the forge?{' '}
            <Link href="/register" className={inlineLinkClass}>
              Create an account
            </Link>
          </>
        }
      >
        {/* Reading ?reason= requires a Suspense boundary for static rendering. */}
        <Suspense>
          <LoginForm />
        </Suspense>
      </AuthLayout>
    </GuestOnly>
  );
}
