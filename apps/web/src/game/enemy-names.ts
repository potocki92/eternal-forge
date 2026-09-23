/**
 * Display names for enemy archetypes: presentation data, keyed by the content
 * id the server sends. An archetype without an entry still gets a readable
 * name, so new content never breaks the screen.
 */
const NAMES: Readonly<Record<string, string>> = {
  husk: 'Husk',
  warden: 'Warden',
};

export function enemyName(archetypeId: string): string {
  return (
    NAMES[archetypeId] ??
    archetypeId
      .split(/[-_\s]+/u)
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}
