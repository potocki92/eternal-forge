'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CombatScene, CombatSceneFactory } from './combat-scene';

export type SceneStatus = 'loading' | 'ready' | 'unavailable';

export interface CombatSceneHandle {
  readonly status: SceneStatus;
  /** The live scene, or `null` while loading, after unmount, or when unavailable. */
  readonly scene: RefObject<CombatScene | null>;
}

/**
 * Owns the combat scene's lifecycle: exactly one scene per mounted host.
 *
 * Creation is asynchronous (PixiJS initialises its renderer with `await`), so
 * an unmount can happen before it finishes — React's StrictMode does this on
 * every development mount. A scene that finishes after its host unmounted is
 * destroyed immediately instead of leaking a renderer, a WebGL context and an
 * animation loop. Re-renders never create a second scene: the factory runs in
 * an effect keyed only on the host, the factory and the motion preference.
 *
 * If creation fails the status becomes `unavailable`; the game screen stays
 * fully playable through its DOM (ADR-007).
 */
export function useCombatScene(
  host: RefObject<HTMLElement | null>,
  factory: CombatSceneFactory,
  reducedMotion: boolean,
): CombatSceneHandle {
  const scene = useRef<CombatScene | null>(null);
  // Which inputs the last settled attempt belonged to: a result for other
  // inputs (the preference changed, a new scene is loading) reads as loading.
  const [settled, setSettled] = useState<
    | {
        readonly factory: CombatSceneFactory;
        readonly reducedMotion: boolean;
        readonly status: 'ready' | 'unavailable';
      }
    | undefined
  >();

  useEffect(() => {
    const element = host.current;
    if (element === null) {
      return;
    }
    let disposed = false;

    factory(element, { reducedMotion }).then(
      (created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        scene.current = created;
        setSettled({ factory, reducedMotion, status: 'ready' });
      },
      () => {
        if (!disposed) {
          setSettled({ factory, reducedMotion, status: 'unavailable' });
        }
      },
    );

    return () => {
      disposed = true;
      scene.current?.destroy();
      scene.current = null;
    };
  }, [host, factory, reducedMotion]);

  const status: SceneStatus =
    settled?.factory === factory && settled.reducedMotion === reducedMotion
      ? settled.status
      : 'loading';
  return { status, scene };
}
