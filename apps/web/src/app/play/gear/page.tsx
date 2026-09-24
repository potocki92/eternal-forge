import type { Metadata } from 'next';
import { RequireAuth } from '@/auth/route-guards';
import { PlayerShell } from '@/player/player-shell';

export const metadata: Metadata = { title: 'Gear · Eternal Forge' };
export default function GearPage() {
  return (
    <RequireAuth>
      <PlayerShell view="gear" />
    </RequireAuth>
  );
}
