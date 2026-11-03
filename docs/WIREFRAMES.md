# Redline — wireframes (signed off 2026-11-03)

All shortcuts shown are defaults and are user-configurable (Settings → Shortcuts; the global
toggle via chrome://extensions/shortcuts).

### W1 — Dormant → enabled (toolbar icon or ⌘⇧.)
Until you turn it on, the page is untouched. Once on, a collapsed pill sits in the corner.
```
┌───────────────────────────────────────────────────────────────────┐
│ localhost:3000/pricing                                            │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│   │   Starter   │  │     Pro     │  │  Business   │               │
│   │    $9/mo    │  │   $29/mo    │  │   $99/mo    │               │
│   │  [ Choose ] │  │  [ Choose ] │  │  [ Choose ] │               │
│   └─────────────┘  └─────────────┘  └─────────────┘               │
│                                                     ╭──────────╮  │
│                                                     │ ✎ Redline│  │
│                                                     │    3   ▴ │  │
│                                                     ╰──────────╯  │
└───────────────────────────────────────────────────────────────────┘
  3 = comments on this page.  Drag the pill to move it to another corner (snaps; saved in settings).
```

### W2 — Pill expanded into the toolbar (one click)
```
   ╭──────────────────────────────────────────────╮
   │ 📍 Pin  ▭ Area │ 📷 off │ ☰ List 3 │ ⚙ │ ✕ │
   ╰──────────────────────────────────────────────╯
  P = pin mode   A = area mode   S = 📷 on/off   L = open list   Esc = collapse
  📷 shows "off" or "on" and is remembered. ⚙ opens Settings. ✕ turns Redline off for this tab.
```

### W3 — Pin mode: hovering an element (clicks don't reach the page)
```
│   ┌─────────────┐  ┏━━━━━━━━━━━━━┓  ┌─────────────┐               │
│   │   Starter   │  ┃     Pro     ┃  │  Business   │               │
│   │    $9/mo    │  ┃   $29/mo    ┃  │   $99/mo    │               │
│   │  [ Choose ] │  ┃  [ Choose ] ┃  │  [ Choose ] │               │
│   └─────────────┘  ┗━━━━━━━━━━━━━┛  └─────────────┘               │
│                    ┌──────────────────────────────┐               │
│                    │ div.card.card--pro  248×312  │ ← hover label │
│                    │ <PricingCard> · Pricing.tsx  │               │
│                    └──────────────────────────────┘               │
  ↑/↓ = select parent / child element    Click = drop pin    Esc = exit mode
```

### W4 — Comment box after a click
```
│                    ┏━━━━━━━━━━━━━┓                                │
│                    ┃   ④  Pro    ┃                                │
│                    ┗━━━━━━━━━━━━━┛                                │
│              ┌──────────────────────────────────────────┐         │
│              │ ④  div.card--pro  ·  <PricingCard>       │         │
│              ├──────────────────────────────────────────┤         │
│              │ The price should be bigger than the      │         │
│              │ plan name, and align the button with     │         │
│              │ the other cards▌                         │         │
│              ├──────────────────────────────────────────┤         │
│              │ 🎤   📷 ✓      ▸ DOM details   Cancel  Save │         │
│              └──────────────────────────────────────────┘         │
  ⌘↵ = save   Esc = cancel   🎤 = dictate (also ⌥ Space)
  📷 ✓ = screenshot will be attached (default from toolbar; can be changed per comment)
```

### W4b — "DOM details" expanded (read-only; this is what gets exported)
```
              │ ▾ DOM details                               │
              │   selector   main > section.pricing >       │
              │              div.card.card--pro             │
              │   component  PricingCard ← PricingGrid      │
              │   source     src/components/Pricing.tsx:42  │
              │   size       248 × 312 @ (512, 180)         │
              │   text       "Pro $29/mo Choose"            │
              │   styles     font 16/24 Inter · pad 24 · …  │
```

### W5 — Voice states (inside the W4 box)
```
 Idle        │ 🎤   📷 ✓                       Cancel  Save │
 Listening   │ ● 0:07  ▁▃▆▅▂▇▃▁  Listening…      ■ Stop   │   (🎤 again or ⌥ Space stops)
 Transcribing│ ⟳  Transcribing locally · whisper base.en  │
 Done        │ …the other cards. The hover state also    │
             │ ░flickers on Safari.░    ← new text, briefly highlighted
             Dictated text is inserted at the cursor, never replacing typed text; editable until saved.
 No engine   │ ⚠ Voice isn't set up.  [ Set up voice ]  [ Use Chrome speech ] │
 Mic denied  │ ⚠ Allow the microphone once.  [ Grant mic access ]  │  (opens Settings → Voice)
```

### W6 — Area mode
```
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│   │   Starter   │  │     Pro     │  │  Business   │               │
│   │  ┌┄┄┄┄┄┄┄┄┄┄┼┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┐│   $99/mo    │               │
│   │  ┆[ Choose ]│  │  [ Choose ] │ ┆│  [ Choose ] │               │
│   └──┆──────────┘  └─────────────┘ ┆┘─────────────┘               │
│      └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘  ⑤                           │
│                    anchored to: div.pricing-grid                  │
  Drag to draw a box → the same comment box as W4.
  The box is stored relative to the anchor element (named in the label).
```

### W7 — Saved pins on the page (survive refresh)
```
│   ┌─────────────①┐  ┌────────────④┐  ┌─────────────┐              │
│   │   Starter    │  │     Pro     │  │  Business ② │              │
│   └──────────────┘  └─────────────┘  └─────────────┘              │
│    ┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄⑤┐                               │
│    └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘                               │
  Hover a pin → preview card: "④ The price should be bigger… [Edit] [🗑]"
  Click a pin → opens the W4 box to edit.
  A pin whose element is gone shows ⚠ (detached) at its saved page position and in W8.
```

### W8 — List drawer (from ☰; slides in from the right, Esc or ✕ collapses)
```
                                    ┌───────────────────────────────┐
                                    │ Redline · /pricing         ✕  │
                                    │ localhost:3000 · 5 comments   │
                                    ├───────────────────────────────┤
                                    │ ☐ Select all      [Copy ▾]    │
                                    ├───────────────────────────────┤
                                    │ ☐ ④ div.card--pro      📷 🎤   │
                                    │   The price should be bigger  │
                                    │   than the plan name…         │
                                    │   2 min ago        ✎   ⧉   🗑  │
                                    ├───────────────────────────────┤
                                    │ ☐ ⑤ ▭ div.pricing-grid         │
                                    │   Buttons don't line up on…   │
                                    │   5 min ago        ✎   ⧉   🗑  │
                                    ├───────────────────────────────┤
                                    │ ☐ ② ⚠ detached                 │
                                    │   Badge overlaps price        │
                                    │   yesterday   ⌖ re-pin ✎ ⧉ 🗑  │
                                    ├───────────────────────────────┤
                                    │ All pages (12) →              │
                                    └───────────────────────────────┘
  Row click → scroll to the pin and flash it.  ✎ inline edit (textarea; ⌘↵ save, Esc cancel)
  ⧉ copy this one.  📷/🎤 = has screenshot / was dictated.  ⌖ re-pin = click an element to reattach.
```

### W8b — Multi-select + delete confirmation
```
                                    │ ☑ Select all  3 selected      │
                                    │ [Copy 3 ▾]       [🗑 Delete 3] │
                                    ├───────────────────────────────┤
                                    │  Delete 3 comments?           │
                                    │  This can't be undone.        │
                                    │           [Cancel] [Delete]   │
  Single delete: no confirm, "Deleted · Undo" toast for 5 s.
```

### W9 — Copy / export menu
```
                         [Copy ▾]
                         ┌──────────────────────────────────┐
                         │ ⧉ Copy as Markdown (for agents)  │ ← default
                         │ { } Copy as JSON                 │
                         │ ───────────────────────────────  │
                         │ Scope:  ◉ Selected  ○ This page  │
                         │         ○ All pages              │
                         │ ───────────────────────────────  │
                         │ ⬇ Download bundle (.zip)          │
                         │   review.md · annotations.json   │
                         │   · shots/*.png                  │
                         └──────────────────────────────────┘
  Toast: "Copied 3 comments as Markdown".  "Selected" is disabled when nothing is selected.
```

### W10 — All pages (extension tab `reviews.html`)
```
┌───────────────────────────────────────────────────────────────────┐
│ Redline — All reviews                     🔍 search…     [Copy ▾] │
├───────────────────────────────────────────────────────────────────┤
│ ☐ localhost:3000                                         9        │
│    ☐ /pricing            Pricing — Acme        5   2 min ago   ↗  │
│    ☐ /checkout           Checkout              4   1 hr ago    ↗  │
│ ☐ staging.acme.dev                                       3        │
│    ☐ /pricing            Pricing — Acme        3   yesterday   ↗  │
├───────────────────────────────────────────────────────────────────┤
│ Pick a page to see its comments (same list as W8)                 │
└───────────────────────────────────────────────────────────────────┘
  ↗ opens that page with its pins showing.  Search matches comment text, title, URL, selector.
```

### W11 — Settings → Voice
```
┌───────────────────────────────────────────────────────────────────┐
│ Settings › Voice                                                  │
├───────────────────────────────────────────────────────────────────┤
│ Engine    ◉ Local helper  ● connected                             │
│           ○ Chrome on-device speech                               │
│ Installed on this machine                         [↻ Rescan]      │
│  ◉ whisper.cpp  base.en       142 MB  desynex-poc/.data/models    │
│  ○ whisper.cpp  small         466 MB  superwhisper (read-only)    │
│  ○ parakeet     0.6b Q8       ~640 MB hex (read-only) ⚠ untested  │
│ Download a model                                                  │
│  whisper small.en          466 MB   fast · good          [⬇ Get]  │
│  whisper large-v3-turbo    1.6 GB   slower · best        [⬇ Get]  │
│  parakeet tdt 0.6b v3      ~640 MB  fast · great English [⬇ Get]  │
│     ▓▓▓▓▓▓▓▓░░░░░░  58%  · verifying checksum when done           │
│ Language [English ▾]    Shortcut [⌥ Space]    [▶ Test mic]        │
└───────────────────────────────────────────────────────────────────┘
```
Settings also has **General** (pill corner, 📷 default, copy format, enabled sites list with remove)
and **Shortcuts** (record-a-key inputs for pin/area/screenshot/list/dictate, reset to defaults, and a
link/explanation for the global toggle at chrome://extensions/shortcuts).

### W12 — Helper not installed (Settings → Voice, one-time setup)
```
┌───────────────────────────────────────────────────────────────────┐
│ Set up local voice                                                │
│ Redline transcribes on your machine. A small helper program       │
│ runs the speech model. Chrome starts it only while you dictate.   │
│ 1. Run once in Terminal:                                          │
│    ┌───────────────────────────────────────────────────┐          │
│    │ ~/Codes/personal-projects/redline/install-helper  │  [⧉]     │
│    └───────────────────────────────────────────────────┘          │
│ 2. Allow microphone access        [ Grant mic access ]            │
│ 3. ● Waiting for helper…  (polls every 2 s, updates on its own)   │
│ Not now? → [ Use Chrome on-device speech instead ]                │
└───────────────────────────────────────────────────────────────────┘
```

## Interaction decisions
1. Pill defaults to bottom-right; draggable to any corner.
2. After saving, you stay in the current mode for rapid multi-pinning; Esc exits.
3. Bulk delete confirms; single delete gives 5 s Undo.
4. Dictation inserts at the cursor; never overwrites typed text.
