import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from '@/auth/register-form';
import { GuestOnly } from '@/auth/route-guards';
import { AuthLayout, inlineLinkClass } from '@/components/auth-layout';

export const metadata: Metadata = { title: 'Create account · Eternal Forge' };

export default function RegisterPage() {
  return (
    <GuestOnly>
      <AuthLayout
        title="Create account"
        description="One account, one hero — and effectively unlimited progression."
        footer={
          <>
            Already have an account?{' '}
            <Link href="/login" className={inlineLinkClass}>
              Sign in
            </Link>
          </>
        }
      >
        <RegisterForm />
      </AuthLayout>
    </GuestOnly>
  );
}
