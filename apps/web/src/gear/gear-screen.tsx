'use client';

import type { EquipmentSlotDto, ItemInstanceDto } from '@eternal-forge/contracts';
import { Alert, Button, Panel, Skeleton, cn } from '@eternal-forge/ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  EQUIPMENT_SLOTS,
  affixLabel,
  itemName,
  rarityPresentation,
  slotLabel,
  unequippedItems,
} from './gear-model';
import { CharacterSheet } from './stats/character-sheet';
import { ItemComparison } from './stats/item-comparison';
import { useCharacterStats, useGear, useStatsPreview, type StatsPreviewRequest } from './use-gear';

/** Where keyboard focus goes once a change has moved the item it was on. */
type FocusTarget = { readonly slot: EquipmentSlotDto } | { readonly itemId: string };

export function GearScreen({
  userId,
  characterId,
  heroName,
  signingOut,
  onSignOut,
}: {
  readonly userId: string;
  readonly characterId: string;
  readonly heroName: string;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
}) {
  const gear = useGear(userId, characterId);
  const stats = useCharacterStats(userId, characterId);
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const owned = gear.inventory.data?.ownedItems ?? [];
  const equipment = gear.equipment.data?.equipment;
  const inventory = equipment === undefined ? [] : unequippedItems(owned, equipment);
  const item = selected === null ? undefined : owned.find((candidate) => candidate.id === selected);
  const equippedSlot =
    item === undefined || equipment === undefined
      ? undefined
      : EQUIPMENT_SLOTS.find((slot) => equipment[slot]?.id === item.id);

  // The comparison the open item asks the server for: equip an inventory item,
  // or take off a worn one. Keyed by the version of the equipment on screen.
  const previewRequest: StatsPreviewRequest | null =
    item === undefined || gear.equipment.data === undefined
      ? null
      : {
          intent: equippedSlot === undefined ? { equip: item.id } : { unequip: equippedSlot },
          characterVersion: gear.equipment.data.characterVersion,
        };
  const preview = useStatsPreview(userId, characterId, previewRequest);

  useEffect(() => {
    if (item === undefined) dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [item]);

  useEffect(() => {
    if (focusTarget === null) return;
    const selector =
      'slot' in focusTarget
        ? `[data-equipment-slot="${focusTarget.slot}"]`
        : `[data-item-id="${focusTarget.itemId}"]`;
    const target = shell.current?.querySelector<HTMLElement>(selector);
    if (target !== null && target !== undefined) {
      target.focus();
      setFocusTarget(null);
    }
    // The target appears once the new equipment has rendered.
  }, [focusTarget, equipment]);

  // Opening an item starts a fresh decision: an earlier failure is not about it.
  const open = (id: string) => {
    gear.equip.reset();
    gear.unequip.reset();
    setSelected(id);
  };
  const pending = gear.equip.isPending || gear.unequip.isPending;
  const mutationError = gear.equip.error ?? gear.unequip.error;
  const loadError = gear.inventory.isError || gear.equipment.isError;

  const equipSelected = (candidate: ItemInstanceDto) => {
    gear.equip.mutate(candidate.id, {
      onSuccess: () => {
        setAnnouncement(`${itemName(candidate)} equipped. Your stats are updating.`);
        setFocusTarget({ slot: candidate.slot });
        dialog.current?.close();
      },
    });
  };
  const unequipSelected = (worn: ItemInstanceDto, slot: EquipmentSlotDto) => {
    gear.unequip.mutate(slot, {
      onSuccess: () => {
        setAnnouncement(`${itemName(worn)} unequipped. Your stats are updating.`);
        setFocusTarget({ itemId: worn.id });
        dialog.current?.close();
      },
    });
  };

  return (
    <div className="gear-shell" ref={shell}>
      <header className="gear-header">
        <div>
          <p className="gear-eyebrow">Eternal Forge · {heroName}</p>
          <h1>Gear</h1>
          <p>Build, equipment &amp; inventory</p>
        </div>
        <div className="flex gap-2">
          <Link className="gear-nav-link" href="/play">
            Combat
          </Link>
          <Button variant="ghost" disabled={signingOut} onClick={onSignOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <main className="gear-main">
        {loadError ? (
          <Panel className="gear-error">
            <Alert tone="danger">Your gear could not be loaded.</Alert>
            <Button variant="secondary" onClick={gear.retry}>
              Retry
            </Button>
          </Panel>
        ) : null}
        {mutationError && item === undefined ? (
          // The sheet closed under a failed change (its item moved elsewhere):
          // the outcome still needs saying.
          <Alert tone="danger" className="gear-error">
            {mutationMessage(mutationError)}
          </Alert>
        ) : null}
        <div className="gear-build">
          <CharacterSheet
            heroName={heroName}
            stats={stats.data}
            loading={stats.isPending}
            refreshing={stats.isFetching && !stats.isPending}
            failed={stats.isError}
            onRetry={() => void stats.refetch()}
          />
          {gear.equipment.isPending ? <Skeleton className="h-96 w-full" /> : null}
          {!loadError && equipment !== undefined ? (
            <Panel as="section" aria-labelledby="equipment-heading" className="gear-equipment">
              <SectionHeading
                id="equipment-heading"
                eyebrow="Loadout"
                title="Equipment"
                detail="Select a filled slot to inspect or remove it."
              />
              <div className="equipment-grid">
                {EQUIPMENT_SLOTS.map((slot) => (
                  <EquipmentSlot key={slot} slot={slot} item={equipment[slot]} onSelect={open} />
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
        {gear.inventory.isPending || gear.equipment.isPending ? (
          <div aria-busy="true">
            <span className="sr-only" role="status">
              Loading gear…
            </span>
            <Skeleton className="h-96 w-full" />
          </div>
        ) : null}
        {!loadError && equipment !== undefined && gear.inventory.data !== undefined ? (
          <Panel as="section" aria-labelledby="inventory-heading" className="gear-inventory">
            <SectionHeading
              id="inventory-heading"
              eyebrow={`${String(inventory.length)} available`}
              title="Inventory"
              detail="Choose an item to compare it with your loadout and equip it."
            />
            {inventory.length === 0 ? (
              <div className="inventory-empty">
                <span aria-hidden="true">◇</span>
                <strong>No items waiting</strong>
                <p>Defeat enemies to find equipment, or unequip an item from your loadout.</p>
              </div>
            ) : (
              <div className="inventory-grid">
                {inventory.map((entry) => (
                  <ItemCard key={entry.id} item={entry} onSelect={open} />
                ))}
              </div>
            )}
          </Panel>
        ) : null}
      </main>
      <dialog
        ref={dialog}
        className="item-dialog"
        onClose={() => {
          setSelected(null);
        }}
        aria-labelledby="item-detail-title"
      >
        {item === undefined ? null : (
          <ItemDetail
            item={item}
            equippedSlot={equippedSlot}
            occupant={equipment?.[item.slot] ?? null}
            pending={pending}
            error={mutationError}
            comparison={{
              preview: preview.data,
              loading: preview.isPending || (preview.isFetching && preview.data === undefined),
              failed: preview.isError,
              onRetry: () => void preview.refetch(),
            }}
            onClose={() => dialog.current?.close()}
            onEquip={() => {
              equipSelected(item);
            }}
            onUnequip={(slot) => {
              unequipSelected(item, slot);
            }}
          />
        )}
      </dialog>
    </div>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  detail,
}: {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <header className="section-heading">
      <div>
        <p>{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      <span>{detail}</span>
    </header>
  );
}
function EquipmentSlot({
  slot,
  item,
  onSelect,
}: {
  readonly slot: EquipmentSlotDto;
  readonly item: ItemInstanceDto | null;
  readonly onSelect: (id: string) => void;
}) {
  const content = (
    <>
      <span className="slot-icon" aria-hidden="true">
        {slotGlyph(slot)}
      </span>
      <span className="slot-copy">
        <small>{slotLabel(slot)}</small>
        {item === null ? (
          <>
            <strong>Empty</strong>
            <span>Awaiting {slotLabel(slot).toLowerCase()}</span>
          </>
        ) : (
          <>
            <strong>{itemName(item)}</strong>
            <RarityBadge rarity={item.rarity} />
          </>
        )}
      </span>
    </>
  );
  return item === null ? (
    <div className="equipment-slot equipment-slot--empty">{content}</div>
  ) : (
    <button
      type="button"
      className={cn('equipment-slot', rarityPresentation(item.rarity).className)}
      data-equipment-slot={slot}
      onClick={() => {
        onSelect(item.id);
      }}
      aria-label={`${item.rarity} ${itemName(item)}, ${slotLabel(slot)}, equipped`}
    >
      {content}
    </button>
  );
}
function ItemCard({
  item,
  onSelect,
}: {
  readonly item: ItemInstanceDto;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn('item-card', rarityPresentation(item.rarity).className)}
      data-item-id={item.id}
      onClick={() => {
        onSelect(item.id);
      }}
      aria-label={`${item.rarity} ${itemName(item)}, ${slotLabel(item.slot)}, unequipped`}
    >
      <span className="item-card__icon" aria-hidden="true">
        {slotGlyph(item.slot)}
      </span>
      <span className="item-card__copy">
        <strong>{itemName(item)}</strong>
        <RarityBadge rarity={item.rarity} />
        <small>{slotLabel(item.slot)}</small>
      </span>
      <span aria-hidden="true" className="item-card__chevron">
        ›
      </span>
    </button>
  );
}
function RarityBadge({ rarity }: { readonly rarity: ItemInstanceDto['rarity'] }) {
  return <span className={cn('rarity-badge', rarityPresentation(rarity).className)}>{rarity}</span>;
}
function ItemDetail({
  item,
  equippedSlot,
  occupant,
  pending,
  error,
  comparison,
  onClose,
  onEquip,
  onUnequip,
}: {
  readonly item: ItemInstanceDto;
  readonly equippedSlot: EquipmentSlotDto | undefined;
  /** What the page shows in this item's slot right now. */
  readonly occupant: ItemInstanceDto | null;
  readonly pending: boolean;
  readonly error: unknown;
  readonly comparison: Pick<
    Parameters<typeof ItemComparison>[0],
    'preview' | 'loading' | 'failed' | 'onRetry'
  >;
  readonly onClose: () => void;
  readonly onEquip: () => void;
  readonly onUnequip: (slot: EquipmentSlotDto) => void;
}) {
  const equipped = equippedSlot !== undefined;
  return (
    <div className={cn('item-detail', rarityPresentation(item.rarity).className)}>
      <div className="item-detail__handle" aria-hidden="true" />
      <button
        className="item-detail__close"
        type="button"
        onClick={onClose}
        aria-label="Close item details"
      >
        ×
      </button>
      <div className="item-detail__icon" aria-hidden="true">
        {slotGlyph(item.slot)}
      </div>
      <RarityBadge rarity={item.rarity} />
      <h2 id="item-detail-title">{itemName(item)}</h2>
      <p>
        {slotLabel(item.slot)} · {equipped ? 'Equipped' : 'In inventory'}
      </p>
      {item.affixes.length === 0 ? (
        <div className="item-detail__note">Baseline item · No rolled affixes</div>
      ) : (
        <ul className="item-detail__affixes" aria-label="Rolled affixes">
          {item.affixes.map((affix) => (
            <li key={affix.id}>{affixLabel(affix)}</li>
          ))}
        </ul>
      )}
      <ItemComparison
        mode={equipped ? 'unequip' : 'equip'}
        item={item}
        localReplaces={equipped ? null : occupant}
        {...comparison}
      />
      <div className="item-detail__actions">
        {error ? <Alert tone="danger">{mutationMessage(error)}</Alert> : null}
        <Button
          fullWidth
          disabled={pending}
          onClick={() => {
            if (equippedSlot === undefined) onEquip();
            else onUnequip(equippedSlot);
          }}
        >
          {pending ? 'Updating…' : equipped ? 'Unequip' : 'Equip'}
        </Button>
      </div>
    </div>
  );
}
function mutationMessage(error: unknown) {
  return error instanceof ApiError && error.status === 409
    ? 'Your gear changed elsewhere. We refreshed it—please try again.'
    : 'That gear change did not complete. Your current equipment has been refreshed.';
}
function slotGlyph(slot: EquipmentSlotDto) {
  return { HELMET: '⌁', WEAPON: '†', CHEST: '◇', GLOVES: '✦', BOOTS: '⌄', RING: '○', AMULET: '◈' }[
    slot
  ];
}
