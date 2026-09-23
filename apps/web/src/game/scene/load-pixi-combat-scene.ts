import type { CombatSceneFactory } from './combat-scene';

/**
 * The production scene. PixiJS is loaded on demand, so it never ships in the
 * bundle of any page but the game, and never runs during server rendering.
 */
export const loadPixiCombatScene: CombatSceneFactory = async (host, options) => {
  const { createPixiCombatScene } = await import('./pixi/pixi-combat-scene');
  return createPixiCombatScene(host, options);
};
