import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

// ─────────────────────────────────────────────────────────────────────────────
//  DESIGN SYSTEM — Chinese-web-inspired information-dense layout
//
//  SPACING (5 px base unit — replaces Tailwind's 4 px defaults)
//    p-1  →   5 px   button / badge minimal padding
//    p-2  →  10 px   standard div / field padding
//    p-3  →  20 px   card / panel padding
//    p-4  →  32 px   section padding (tight)
//    p-6  →  48 px   section padding (standard)
//    p-8  →  64 px   section padding (comfortable)
//
//  FONT SIZES (13 px body — replaces Tailwind's 16 px defaults)
//    text-2xs →  9 px   micro labels, legal copy
//    text-xs  → 10 px   badges, captions, timestamps
//    text-sm  → 12 px   secondary text, hints
//    text-base→ 13 px   body default ← Chinese-site standard
//    text-md  → 14 px   comfortable reading
//    text-lg  → 16 px   emphasis, primary actions
//    text-xl+ →         headings / display
//
//  ⚠  BREAKING CHANGES vs. vanilla Tailwind
//  ─────────────────────────────────────────
//  • p-1 is now 5 px (was 4 px). p-4 is now 32 px (was 16 px).
//    Search for common spacing classes and verify visual intent.
//  • text-base is now 13 px (was 16 px). Explicit heading sizes are needed
//    everywhere — h1–h6 have no default size/weight after the reset.
//  • w-64 is now 1152 px. Use max-w-content / max-w-narrow for layout widths.
//  • All heading/paragraph/list browser defaults are stripped in the reset.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  darkMode: ["class"],
  content: [
    "./client/index.html",
    "./client/src/**/*.{js,jsx,ts,tsx}",
    "./shared/**/*.{ts,tsx,js,jsx}",
  ],

  theme: {
    // ─────────────────────────────────────────────────────────────────────
    //  SPACING — 5 px base, intentional step scale
    //  Fully replaces Tailwind defaults. Every spacing utility (p, m, gap,
    //  w, h, inset …) derives from this single source of truth.
    // ─────────────────────────────────────────────────────────────────────
    spacing: {
      px:   "1px",
      0:    "0px",
      0.5:  "0.125rem",   //   2 px  hair gap / divider nudge
      1:    "0.3125rem",  //   5 px  button / badge minimal
      1.5:  "0.5rem",     //   8 px  compact input / icon button
      2:    "0.625rem",   //  10 px  standard field / cell
      2.5:  "0.875rem",   //  14 px  relaxed small element
      3:    "1.25rem",    //  20 px  card / panel
      3.5:  "1.5rem",     //  24 px  card comfortable
      4:    "2rem",       //  32 px  section tight
      5:    "2.5rem",     //  40 px
      6:    "3rem",       //  48 px  section standard
      7:    "3.5rem",     //  56 px
      8:    "4rem",       //  64 px  section comfortable
      9:    "5rem",       //  80 px
      10:   "6rem",       //  96 px
      11:   "7.5rem",     // 120 px
      12:   "10rem",      // 160 px
      14:   "12.5rem",    // 200 px
      16:   "15rem",      // 240 px
      20:   "20rem",      // 320 px
      24:   "25rem",      // 400 px
      28:   "30rem",      // 480 px
      32:   "35rem",      // 560 px
      36:   "40rem",      // 640 px
      40:   "45rem",      // 720 px
      48:   "56rem",      // 896 px
      56:   "64rem",      // 1024 px
      64:   "72rem",      // 1152 px
      72:   "80rem",      // 1280 px
      80:   "90rem",      // 1440 px
      96:   "100rem",     // 1600 px
    },

    // ─────────────────────────────────────────────────────────────────────
    //  FONT SIZES — information-dense, Chinese-web optimised
    //  Replaces Tailwind defaults. All values assume 16 px root (browser
    //  default); the body is set to 13 px via the reset plugin below.
    // ─────────────────────────────────────────────────────────────────────
    fontSize: {
      "2xs": ["0.5625rem",  { lineHeight: "0.875rem" }],  //  9 px
      xs:    ["0.625rem",   { lineHeight: "1rem" }],      // 10 px
      sm:    ["0.75rem",    { lineHeight: "1.125rem" }],  // 12 px
      base:  ["0.8125rem",  { lineHeight: "1.25rem" }],   // 13 px  ← body
      md:    ["0.875rem",   { lineHeight: "1.375rem" }],  // 14 px
      lg:    ["1rem",       { lineHeight: "1.5rem" }],    // 16 px
      xl:    ["1.125rem",   { lineHeight: "1.625rem" }],  // 18 px
      "2xl": ["1.25rem",    { lineHeight: "1.75rem" }],   // 20 px
      "3xl": ["1.5rem",     { lineHeight: "2rem" }],      // 24 px
      "4xl": ["1.75rem",    { lineHeight: "2.25rem" }],   // 28 px
      "5xl": ["2rem",       { lineHeight: "2.5rem" }],    // 32 px
      "6xl": ["2.5rem",     { lineHeight: "3rem" }],      // 40 px
      "7xl": ["3rem",       { lineHeight: "3.5rem" }],    // 48 px
    },

    // Named line-height scale only — numeric aliases removed for clarity
    lineHeight: {
      none:    "1",
      tight:   "1.2",
      snug:    "1.375",
      normal:  "1.5",
      relaxed: "1.625",
      loose:   "2",
    },

    // Container — 1200 px max (Chinese-web standard), auto-centered
    container: {
      center: true,
      padding: {
        DEFAULT: "0.625rem",  //  10 px
        md:      "1.25rem",   //  20 px
        xl:      "2rem",      //  32 px
      },
      screens: {
        sm:    "640px",
        md:    "768px",
        lg:    "1024px",
        xl:    "1200px",   // ← 1200 px is the Chinese-web desktop standard
        "2xl": "1440px",
      },
    },

    extend: {
      // ── Screens ──────────────────────────────────────────────────────────
      screens: {
        xs: "375px",  // Small mobile — common in China (Redmi, iPhone SE)
      },

      // ── Border radius — refined pixel-precise steps ───────────────────────
      borderRadius: {
        none:    "0",
        sm:      "0.1875rem",  //  3 px
        DEFAULT: "0.25rem",    //  4 px
        md:      "0.375rem",   //  6 px
        lg:      "0.5625rem",  //  9 px  (original value preserved)
        xl:      "0.75rem",    // 12 px
        "2xl":   "1rem",       // 16 px
        "3xl":   "1.5rem",     // 24 px
        full:    "9999px",
      },

      // ── Z-index — semantic named scale ───────────────────────────────────
      //  Use z-dropdown, z-modal, etc. instead of arbitrary numbers.
      //  Add to [theme.extend.zIndex] if you need more layers.
      zIndex: {
        base:     "0",
        raised:   "10",
        dropdown: "100",
        sticky:   "200",
        overlay:  "300",
        modal:    "400",
        popover:  "500",
        toast:    "600",
        tooltip:  "700",
        max:      "9999",
      },

      // ── Shadows — subtle, layered (Chinese SaaS / dashboard aesthetic) ────
      //  Lighter opacity and wider blur than Tailwind defaults.
      //  Use shadow-primary for tinted CTA/action element elevation.
      boxShadow: {
        xs:      "0 1px 2px rgb(0 0 0 / 0.05)",
        sm:      "0 1px 3px rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        DEFAULT: "0 2px 8px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.04)",
        md:      "0 4px 12px rgb(0 0 0 / 0.10), 0 2px 4px rgb(0 0 0 / 0.05)",
        lg:      "0 8px 24px rgb(0 0 0 / 0.10), 0 4px 8px rgb(0 0 0 / 0.06)",
        xl:      "0 16px 40px rgb(0 0 0 / 0.12), 0 8px 16px rgb(0 0 0 / 0.06)",
        "2xl":   "0 24px 64px rgb(0 0 0 / 0.14)",
        inner:   "inset 0 2px 4px rgb(0 0 0 / 0.06)",
        none:    "none",
        primary: "0 4px 12px hsl(var(--primary) / 0.30)",
      },

      // ── Easing — crisp micro-interaction curves ───────────────────────────
      transitionTimingFunction: {
        sharp:  "cubic-bezier(0.4, 0, 0.6, 1)",     // snappy dismiss / collapse
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)", // gentle overshoot / reveal
      },

      // ── Layout width tokens ───────────────────────────────────────────────
      maxWidth: {
        narrow:  "56.25rem",  //  900 px — reading column
        content: "75rem",     // 1200 px — Chinese-web standard desktop
        wide:    "90rem",     // 1440 px
        ultra:   "100rem",    // 1600 px — very wide layouts
        full:    "100%",
      },

      // ── Grid templates — common Chinese-web dense layouts ─────────────────
      //  Product grids: grid grid-cols-auto-fill-md gap-2
      //  Sidebar layout: grid grid-cols-sidebar
      //  CSS vars --sidebar-width / --aside-width control sidebar sizes.
      gridTemplateColumns: {
        "auto-fill-xs":  "repeat(auto-fill, minmax(7.5rem,  1fr))",  // 120 px
        "auto-fill-sm":  "repeat(auto-fill, minmax(10rem,   1fr))",  // 160 px
        "auto-fill-md":  "repeat(auto-fill, minmax(12.5rem, 1fr))",  // 200 px
        "auto-fill-lg":  "repeat(auto-fill, minmax(17.5rem, 1fr))",  // 280 px
        "sidebar":       "var(--sidebar-width, 12.5rem) 1fr",
        "sidebar-right": "1fr var(--sidebar-width, 12.5rem)",
        "sidebar-both":  "var(--sidebar-width, 12.5rem) 1fr var(--aside-width, 12.5rem)",
      },

      // ── Colors ───────────────────────────────────────────────────────────
      colors: {
        // Flat / base colors
        background:  "hsl(var(--background) / <alpha-value>)",
        foreground:  "hsl(var(--foreground) / <alpha-value>)",
        border:      "hsl(var(--border) / <alpha-value>)",
        input:       "hsl(var(--input) / <alpha-value>)",
        ring:        "hsl(var(--ring) / <alpha-value>)",

        card: {
          DEFAULT:    "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border:     "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border:     "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border:     "var(--primary-border)",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border:     "var(--secondary-border)",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border:     "var(--muted-border)",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border:     "var(--accent-border)",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border:     "var(--destructive-border)",
        },

        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },

        sidebar: {
          ring:       "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT:    "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border:     "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT:    "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border:     "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT:    "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border:     "var(--sidebar-accent-border)",
        },

        // Status indicator dots — use as bg-status-online etc.
        status: {
          online:  "rgb(34 197 94)",
          away:    "rgb(245 158 11)",
          busy:    "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
      },

      // ── Font families ─────────────────────────────────────────────────────
      fontFamily: {
        sans:  ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono:  ["var(--font-mono)"],
      },

      // ── Keyframes & animations ────────────────────────────────────────────
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        "collapsible-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-collapsible-content-height)" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)" },
          to:   { height: "0" },
        },
      },
      animation: {
        "accordion-down":   "accordion-down 0.2s ease-out",
        "accordion-up":     "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.2s ease-out",
        "collapsible-up":   "collapsible-up 0.2s ease-out",
      },
    },
  },

  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),

    // ─────────────────────────────────────────────────────────────────────────
    //  UNIVERSAL RESET — strips all browser defaults for a clean slate.
    //  Runs on top of (not instead of) Tailwind's built-in preflight, which
    //  handles less-common elements. Disable preflight via:
    //    corePlugins: { preflight: false }
    //  if you need a fully custom baseline.
    // ─────────────────────────────────────────────────────────────────────────
    plugin(({ addBase }) => {
      addBase({
        // Box model
        "*, *::before, *::after": {
          boxSizing: "border-box",
        },

        // HTML root — keep 16 px rem base so all rem values are predictable
        html: {
          lineHeight:                  "1.5",
          "-webkit-text-size-adjust":  "100%",
          tabSize:                     "4",
        },

        // Body — 13 px default, tabular numerals for data-dense UIs
        body: {
          margin:                    "0",
          padding:                   "0",
          fontFamily:                "var(--font-sans, system-ui, sans-serif)",
          fontSize:                  "0.8125rem",  // 13 px
          lineHeight:                "1.5",
          color:                     "hsl(var(--foreground, 0 0% 9%))",
          backgroundColor:           "hsl(var(--background, 0 0% 100%))",
          "-webkit-font-smoothing":  "antialiased",
          "-moz-osx-font-smoothing": "grayscale",
          fontVariantNumeric:        "tabular-nums",
        },

        // Headings → completely blank slate.
        // Apply size + weight via utilities: className="text-3xl font-semibold"
        "h1, h2, h3, h4, h5, h6": {
          margin:     "0",
          padding:    "0",
          fontSize:   "inherit",
          fontWeight: "inherit",
          lineHeight: "inherit",
        },

        // Block elements
        p:                                  { margin: "0" },
        "ul, ol, dl":                       { margin: "0", padding: "0", listStyle: "none" },
        "figure, blockquote, address, pre": { margin: "0", padding: "0" },

        // Media — block-level by default, no overflow spill
        "img, svg, video, canvas, audio, iframe, embed, object": {
          display:       "block",
          verticalAlign: "middle",
          maxWidth:      "100%",
        },

        // Form elements — fully inherit typography from parent
        "input, button, select, optgroup, textarea": {
          fontFamily: "inherit",
          fontSize:   "inherit",
          lineHeight: "inherit",
          color:      "inherit",
          margin:     "0",
          padding:    "0",
        },

        // Button — strip browser chrome; all styling via utilities
        "button, [type='button'], [type='reset'], [type='submit']": {
          cursor:               "pointer",
          background:           "transparent",
          border:               "0",
          "-webkit-appearance": "button",
        },

        // Textarea — vertical-resize only by default
        textarea: {
          resize: "vertical",
        },

        // Links — inherit color; apply hover styles via utilities
        a: {
          color:          "inherit",
          textDecoration: "none",
        },

        // Table
        table: {
          borderCollapse: "collapse",
          borderSpacing:  "0",
        },
        hr: {
          height:         "0",
          color:          "inherit",
          borderTopWidth: "1px",
          margin:         "0",
        },

        // Code
        "code, kbd, samp": {
          fontFamily: "var(--font-mono, ui-monospace, 'Cascadia Code', monospace)",
          fontSize:   "inherit",
        },
        pre: {
          margin:   "0",
          overflow: "auto",
          fontFamily: "var(--font-mono, ui-monospace, 'Cascadia Code', monospace)",
          fontSize:   "inherit",
        },
      });
    }),
  ],
} satisfies Config;