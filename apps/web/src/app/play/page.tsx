import type { Metadata } from 'next';
import { RequireAuth } from '@/auth/route-guards';
import { PlayerShell } from '@/player/player-shell';

export const metadata: Metadata = { title: 'Play · Eternal Forge' };

export default function PlayPage() {
  return (
    <RequireAuth>
      <PlayerShell />
    </RequireAuth>
  );
}
