---
name: GridWise
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#bbcabf'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#86948a'
  outline-variant: '#3c4a42'
  surface-tint: '#4edea3'
  primary: '#4edea3'
  on-primary: '#003824'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#006c49'
  secondary: '#ffb95f'
  on-secondary: '#472a00'
  secondary-container: '#ee9800'
  on-secondary-container: '#5b3800'
  tertiary: '#7bd0ff'
  on-tertiary: '#00354a'
  tertiary-container: '#19aee8'
  on-tertiary-container: '#003e55'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  metric-hero:
    fontFamily: JetBrains Mono
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.03em
  metric-hero-mobile:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.02em
  metric-lg:
    fontFamily: JetBrains Mono
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.02em
  metric-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  code-badge:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.06em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.25rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style
The design system embodies precision-grade telemetry, combining the rigor of institutional fintech with next-generation smart energy management. It speaks directly to campus facility directors, grid analysts, and sustainability engineers who require immediate, low-latency situational awareness and dense operational intelligence.

The visual style blends **Technical Minimalism** with **Instrumental Precision**:
- **Utilitarian Elegance:** High-density telemetry balanced by razor-sharp structural boundaries and quiet, dark surfaces.
- **Instrument HUD Feel:** Data is treated as physical signal flow. State changes, load variations, and automated directive activations emit luminous, semantically bounded accents against deep, non-distracting charcoal grounds.
- **Operational Trust:** No arbitrary gradients or decorative fuzz. Every micro-interaction, pill badge, and sparkline serves instant diagnostic legibility.

## Colors
The default color mode is strictly dark to reduce visual fatigue across prolonged monitoring shifts and to establish maximum dynamic range for luminous telemetry signals.

### Surface System
- **Canvas Base:** `#0B0F17` (Deep Obsidian Navy)
- **Container / Layer 1 (Cards):** `#111827` (Charcoal Slate)
- **Container Raised / Layer 2 (Modals/Popovers):** `#161F30` (Muted Steel Slate)
- **Container Interactive / Active:** `#1E293B` (Elevated Midnight Slate)
- **Structural Lines / Outlines:** Default at `#1F2937`, hover/focus at `#374151`, high-contrast borders at `#475569`.

### Domain Telemetry Tokens
- **Solar Energy Stream:** Primary `#F59E0B` (Amber 500), highlight `#FBBF24`, baseline `#D97706`.
- **Battery Storage Stream:** Primary `#10B981` (Emerald 500), active discharge `#14B8A6`, base `#059669`.
- **Grid Exchange Stream:** Primary `#38BDF8` (Sky 400), neutral draw `#64748B`, inactive/idle `#94A3B8`.
- **Critical Error / Breaker Fault:** Primary `#EF4444` (Crimson Red), muted container fill `#7F1D1D33`.

### Directive Status Badges
- `solar_reduction`: Amber (`#F59E0B` text/border on `#F59E0B1A` bg)
- `minimum_battery_reserve`: Emerald (`#10B981` text/border on `#10B9811A` bg)
- `no_charge_window`: Indigo/Purple (`#8B5CF6` text/border on `#8B5CF61A` bg)
- `no_discharge_window`: Rose (`#F43F5E` text/border on `#F43F5E1A` bg)
- `max_grid_window`: Cyan (`#06B6D4` text/border on `#06B6D41A` bg)
- `no_op`: Slate (`#64748B` text/border on `#33415533` bg)
- `applied_directive`: Solid status pip in `#10B981` with container backing `#065F4640`.

## Typography
The system enforces a dual-type architecture:
1. **Interface & Headings:** `Plus Jakarta Sans` delivers a clean, high-legibility structure for architectural summaries and screen titles, while `Inter` powers contextual prose, descriptions, and settings forms.
2. **Dense Telemetry & Numerical Streams:** `JetBrains Mono` handles all numerical telemetry, kilowatt-hour (kWh) values, phase angles, currency metrics, and status pills. All numerical outputs must enable tabular figures (`font-variant-numeric: tabular-nums`) to prevent optical jitter during real-time polling.

All sub-section titles and metric card captions utilize `label-caps` in uppercase mode with subtle tracking to maximize scan efficiency across multi-panel control rooms.

## Layout & Spacing
The layout follows an information-dense, 12-column fluid grid system engineered for multi-monitor operation rooms and adaptive mobile viewports.

- **Desktop (1280px+):** Full 12-column layout with fixed outer gutters of `margin-desktop` (2rem) and `gutter-desktop` (1.25rem). Grid modules dock into 3-column (telemetry gauges), 4-column (directive queues), or 8-column (temporal energy curve) structures.
- **Tablet (768px - 1279px):** 6-column reflow where telemetry cards collapse to 2 columns and graphs take full width.
- **Mobile (<768px):** Single-column stacked stream. Dense tabular matrix components enable horizontal scroll with sticky primary identifier columns.

Component spacing relies strictly on compact, consistent multipliers: `space-xs` (4px) for badge internals, `space-sm` (8px) for metric-to-label gaps, and `space-md` (16px) for interior card padding.

## Elevation & Depth
Elevation is constructed through chromatic luminance and micro-borders rather than cast shadows, ensuring razor-sharp rendering on hardware displays:

1. **Ground Tier (Canvas):** Base level `#0B0F17` sits at zero elevation.
2. **Structural Tier (Card Surfaces):** `#111827` framed with a crisp, low-contrast `1px solid #1F2937` perimeter. No drop shadows.
3. **Floating Tier (Hover Cards, Dropdowns, Context Menus):** `#161F30` framed with `1px solid #374151`, supported by an ambient low-spread shadow: `0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)`.
4. **Active/Alert Focus:** Elevated critical modules receive a translucent border glow matched to their telemetry role: Solar (`box-shadow: 0 0 0 1px #F59E0B, 0 0 12px #F59E0B26`), Battery (`box-shadow: 0 0 0 1px #10B981, 0 0 12px #10B98126`), and Breaker Trip (`box-shadow: 0 0 0 1px #EF4444, 0 0 16px #EF444433`).

## Shapes
A unified curvature level of `2` (Rounded) defines the system:
- **Card Containers & Modal Shells:** `rounded-xl` (1.5rem) to soften large dashboard panes without wasting visual area.
- **Inner Controls, Toolbars, and Metric Tiles:** `rounded-lg` (1.0rem) for crisp nesting inside parents.
- **Pills, Directive Badges, and Status Dots:** Full capsule radius (`9999px`) to maintain semantic separation between structural data blocks and dynamic status tags.

## Components

### Buttons & Action Triggers
- **Primary Telemetry Button:** Background `#10B981`, text `#0B0F17`, font weight 600. On hover, background shifts to `#14B8A6`. Focus ring is `2px solid #38BDF8` with 2px offset.
- **Secondary / Action Button:** Background `#1E293B`, border `1px solid #374151`, text `#F8FAFC`. On hover, background transitions to `#334155`.
- **Destructive (Emergency Grid Disconnect):** Background `#7F1D1D33`, border `1px solid #EF4444`, text `#FCA5A5`.

### Directive Status Pills & Micro-Badges
- Height: Fixed 24px with horizontal padding of `space-sm` (8px).
- Typography: `code-badge` in uppercase monospace.
- Construction: `1px solid` border containing a 6px circular status dot on the left, followed by the snake_case directive name. Colors match the Directive Badges palette strictly.

### Metric Tiles & Telemetry Cards
- Surface: `#111827`, border `1px solid #1F2937`, padding `space-md` (16px).
- Header: Upper-case `label-caps` in `#94A3B8` aligned with an optional real-time stream status dot.
- Body: `metric-hero` tabular numerical value with inline unit indicator (`kW`, `kWh`, `V`, `Hz`) rendered in `#64748B` at 60% font size.
- Footer: Sparkline visualization or delta percentage tag with directional caret.

### Data Grid & Energy Matrix Table
- Headers: `#161F30` background, border-bottom `1px solid #374151`, text in `label-caps` `#94A3B8`.
- Rows: Alternating zebra background (`#111827` and `#0E1420`), border-bottom `1px solid #1F2937`. Hover state highlights row to `#1E293B`.
- Cells: Text in `body-sm` for labels; all quantities, rates, and timestamps formatted in `metric-md` monospace.

### Inputs & Time-Range Sliders
- Input Field: Background `#0B0F17`, border `1px solid #374151`, text `#F8FAFC`, placeholder `#64748B`. Focused state applies `border-color: #38BDF8` with zero outer fuzzy glow.
- Sliders (Load Dispatch / Reserve Override): Track height 4px in `#1E293B`, active fill in `#10B981`, thumb sized at 16px solid `#F8FAFC` with `#10B981` border.