# ADR-007 — PixiJS for combat visualisation only

## Status

Accepted

## Date

2026-09-22

## Context

Combat is the primary screen and should feel like a game: animated characters,
hit effects, damage numbers, boss entrances. The DOM is a poor fit for dozens of
simultaneously animating sprites on a mid-range phone.

Everything else in the product — inventory, forge, passives, rankings, settings,
forms, modals, navigation — is ordinary application UI, where the DOM provides
accessibility, text selection, keyboard navigation and layout for free.

The risk is that a canvas renderer gradually acquires UI responsibilities and
eventually state, at which point the application has two competing view layers
and an inaccessible one wins.

## Decision

PixiJS renders combat visuals. React owns all application UI.

- PixiJS draws characters, enemies, effects, damage numbers and environment
  animation.
- React owns navigation, inventory, items, skills UI, rankings, settings,
  modals, forms, tooltips and menus. Forms and lists are never built inside
  PixiJS.
- PixiJS never holds gameplay truth. It renders a result the server produced and
  the client received; it does not compute it.
- Information that matters to the player is never available _only_ on the
  canvas. Canvas content is always mirrored in accessible DOM.

## Consequences

- Combat can be visually rich without sacrificing accessibility elsewhere.
- The canvas can be replaced, downgraded on weak devices, or disabled entirely
  without losing gameplay information.
- The boundary needs active maintenance: a convenient in-canvas button is
  exactly how this decision erodes.
- Two rendering technologies means two performance profiles to watch.

## Alternatives Considered

**DOM/CSS for combat too.** Rejected: acceptable for a handful of elements,
unacceptable for particle-level effects on mobile.

**Canvas for the whole application.** Rejected: throws away accessibility,
input handling and text rendering, and makes every form a bespoke widget.

**A full game engine.** Rejected: the product is a web application with a game
view, not a game with a web shell; a heavier engine adds bundle size and build
complexity for capabilities the design does not call for.
