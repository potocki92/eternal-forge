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
import { useGear } from './use-gear';

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
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const owned = gear.inventory.data?.ownedItems ?? [];
  const equipment = gear.equipment.data?.equipment;
  const inventory = equipment === undefined ? [] : unequippedItems(owned, equipment);
  const item = selected === null ? undefined : owned.find((candidate) => candidate.id === selected);
  const equippedSlot =
    item === undefined || equipment === undefined
      ? undefined
      : EQUIPMENT_SLOTS.find((slot) => equipment[slot]?.id === item.id);

  useEffect(() => {
    if (item === undefined) dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [item]);

  const pending = gear.equip.isPending || gear.unequip.isPending;
  const mutationError = gear.equip.error ?? gear.unequip.error;
  const loadError = gear.inventory.isError || gear.equipment.isError;

  return (
    <div className="gear-shell">
      <header className="gear-header">
        <div>
          <p className="gear-eyebrow">Eternal Forge · {heroName}</p>
          <h1>Gear</h1>
          <p>Equipment &amp; inventory</p>
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
      <main className="gear-main">
        {loadError ? (
          <Panel className="gear-error">
            <Alert tone="danger">Your gear could not be loaded.</Alert>
            <Button variant="secondary" onClick={gear.retry}>
              Retry
            </Button>
          </Panel>
        ) : null}
        {mutationError ? <Alert tone="danger">{mutationMessage(mutationError)}</Alert> : null}
        {gear.inventory.isPending || gear.equipment.isPending ? <GearSkeleton /> : null}
        {!loadError && equipment !== undefined && gear.inventory.data !== undefined ? (
          <>
            <Panel as="section" aria-labelledby="equipment-heading" className="gear-equipment">
              <SectionHeading
                id="equipment-heading"
                eyebrow="Loadout"
                title="Equipment"
                detail="Select a filled slot to inspect or remove it."
              />
              <div className="equipment-grid">
                {EQUIPMENT_SLOTS.map((slot) => (
                  <EquipmentSlot
                    key={slot}
                    slot={slot}
                    item={equipment[slot]}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </Panel>
            <Panel as="section" aria-labelledby="inventory-heading" className="gear-inventory">
              <SectionHeading
                id="inventory-heading"
                eyebrow={`${String(inventory.length)} available`}
                title="Inventory"
                detail="Choose an item to equip it. Replacements happen in one step."
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
                    <ItemCard key={entry.id} item={entry} equipped={false} onSelect={setSelected} />
                  ))}
                </div>
              )}
            </Panel>
          </>
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
            pending={pending}
            onClose={() => dialog.current?.close()}
            onEquip={(id) => {
              gear.equip.mutate(id);
            }}
            onUnequip={(slot) => {
              gear.unequip.mutate(slot);
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
  equipped,
  onSelect,
}: {
  readonly item: ItemInstanceDto;
  readonly equipped: boolean;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn('item-card', rarityPresentation(item.rarity).className)}
      onClick={() => {
        onSelect(item.id);
      }}
      aria-label={`${item.rarity} ${itemName(item)}, ${slotLabel(item.slot)}, ${equipped ? 'equipped' : 'unequipped'}`}
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
  pending,
  onClose,
  onEquip,
  onUnequip,
}: {
  readonly item: ItemInstanceDto;
  readonly equippedSlot: EquipmentSlotDto | undefined;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onEquip: (id: string) => void;
  readonly onUnequip: (slot: EquipmentSlotDto) => void;
}) {
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
        {slotLabel(item.slot)} · {equippedSlot === undefined ? 'In inventory' : 'Equipped'}
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
      <div className="item-detail__note">Equipment power is not applied to combat yet.</div>
      <Button
        fullWidth
        disabled={pending}
        onClick={() => {
          if (equippedSlot === undefined) onEquip(item.id);
          else onUnequip(equippedSlot);
        }}
      >
        {pending ? 'Updating…' : equippedSlot === undefined ? 'Equip' : 'Unequip'}
      </Button>
    </div>
  );
}
function GearSkeleton() {
  return (
    <div className="gear-main" aria-busy="true">
      <span className="sr-only" role="status">
        Loading gear…
      </span>
      <Skeleton className="h-96 w-full" />
      <Skeleton className="h-96 w-full" />
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
