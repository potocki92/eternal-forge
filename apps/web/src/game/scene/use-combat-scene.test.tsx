import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CombatScene, CombatSceneFactory } from './combat-scene';
import { useCombatScene } from './use-combat-scene';

/** A scene whose `destroy` is observable as a standalone mock. */
function fakeScene(): { readonly scene: CombatScene; readonly destroy: () => void } {
  const destroy = vi.fn();
  return {
    scene: { showEncounter: vi.fn(), playHit: vi.fn(), showOutcome: vi.fn(), destroy },
    destroy,
  };
}

function Host({ factory }: { readonly factory: CombatSceneFactory }) {
  const host = useRef<HTMLDivElement>(null);
  const { status } = useCombatScene(host, factory, false);
  return (
    <div ref={host}>
      <span>{status}</span>
    </div>
  );
}

describe('useCombatScene', () => {
  it('creates one scene and destroys it on unmount', async () => {
    const { scene, destroy } = fakeScene();
    const factory = vi.fn<CombatSceneFactory>(() => Promise.resolve(scene));

    const { unmount, rerender } = render(<Host factory={factory} />);
    await screen.findByText('ready');
    rerender(<Host factory={factory} />);

    expect(factory).toHaveBeenCalledTimes(1);
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('under StrictMode, destroys the scene of the discarded first mount', async () => {
    const scenes: ReturnType<typeof fakeScene>[] = [];
    const factory: CombatSceneFactory = () => {
      const fake = fakeScene();
      scenes.push(fake);
      return Promise.resolve(fake.scene);
    };

    const { unmount } = render(
      <StrictMode>
        <Host factory={factory} />
      </StrictMode>,
    );
    await screen.findByText('ready');

    expect(scenes).toHaveLength(2);
    expect(scenes[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(scenes[1]?.destroy).not.toHaveBeenCalled();
    unmount();
    expect(scenes[1]?.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys a scene that finishes loading after its host unmounted', async () => {
    const { scene, destroy } = fakeScene();
    let finish: (value: CombatScene) => void = () => undefined;
    const factory: CombatSceneFactory = () =>
      new Promise((resolve) => {
        finish = resolve;
      });

    const { unmount } = render(<Host factory={factory} />);
    unmount();
    finish(scene);

    await waitFor(() => {
      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });

  it('reports the scene as unavailable when the renderer cannot start', async () => {
    render(<Host factory={() => Promise.reject(new Error('no WebGL'))} />);

    expect(await screen.findByText('unavailable')).toBeInTheDocument();
  });
});
