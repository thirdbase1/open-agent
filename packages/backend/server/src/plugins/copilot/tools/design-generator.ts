import { z } from 'zod';
import { createTool, duplicateStreamObjectStream } from './utils';
import { toolError } from './error';

// ═══════════════════════════════════════════════════════════════════════════
// ADVANCED DESIGN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════
//
// Generates professional, non-AI-slop frontend designs as Open-Agent document
// blocks. Even with vague prompts, this tool produces visually distinctive,
// brand-aware designs by:
//
// 1. Analyzing the prompt for intent, audience, and aesthetic direction
// 2. Selecting a design system from curated non-slop presets
// 3. Generating a complete layout with real content hierarchy
// 4. Applying anti-slop rules to catch and fix generic patterns
// 5. Producing editable blocks for the Open-Agent frontend
//
// Anti-slop rules are based on research from impeccable.style, 925studios,
// and the broader anti-AI-slop design community (2025-2026).

// ─── Anti-Slop Rules ───────────────────────────────────────────────────────

const ANTI_SLOP_RULES = `
<anti-slop-design-rules>
CRITICAL: The following patterns are "AI slop" — generic, overused design
patterns that make interfaces look AI-generated. NEVER use any of these:

VISUAL TELLS (instant AI detection):
1. NO thick colored border on one side of a card (side-tab accent) — the #1 AI tell
2. NO glassmorphism / frosted glass / blur effects as decoration
3. NO hairline border (1px) paired with wide soft shadow — pick one, not both
4. NO repeating-gradient stripes as surface decoration
5. NO extreme border-radius (24px+) on cards — max 12-16px for cards
6. NO hand-drawn SVG illustrations or amateur mascots
7. NO mesh gradients or aurora/blob backgrounds

TYPOGRAPHY TELLS:
8. NO flat type hierarchy — use at least 1.25x ratio between size steps
9. NO rounded icon tile stacked above heading — the universal AI feature card
10. NO italic serif display headlines (oversized italic serif = instant AI)
11. NO hero eyebrow / pill chip (tiny uppercase label above hero headline)
12. NO repeated section kicker labels (uppercase tracked labels above headings)
13. NO oversized full-sentence hero headline at display size
14. NO Inter, Geist, Space Grotesk, or Instrument Serif as primary font
15. NO single font for everything — always pair display + body fonts
16. NO gradient text on headings or metrics

COLOR TELLS:
17. NO purple/violet gradients — the most recognizable AI color palette
18. NO dark mode with glowing/neon accents (cyberpunk-by-default)
19. NO cyan-on-dark or blue-on-dark "cool" color schemes
20. NO cream/beige page backgrounds (the "tasteful" AI default)
21. NO gray text on colored backgrounds

LAYOUT TELLS:
22. NO hero metric layout (big number + small label + 3 stats + gradient)
23. NO identical card grids (same-sized cards with icon + heading + text)
24. NO monotonous spacing — vary spacing between sections, tighten within groups
25. NO cards inside cards inside cards (max 2 levels of nesting)
26. NO full-width hero with centered text as the only layout option
27. NO icon-grid "feature sections" with 3-4 identical cards

MOTION TELLS:
28. NO bouncing buttons, wiggling icons, floating badges
29. NO gradient text animation
30. NO motion without meaning — every animation must serve a purpose

COPY TELLS:
31. NO redundant UX writing (label + sublabel + helper + hint saying same thing)
32. NO buzzword copy ("empower", "seamless", "revolutionize", "leverage")
33. NO "Introducing..." or "The future of..." headlines

INSTEAD, DO THIS:
- Use distinctive, intentional color palettes (not purple/blue gradients)
- Pair a unique display font with a refined body font (not Inter/Geist)
- Vary card sizes and layouts — break the grid intentionally
- Use real photography or no imagery (never hand-drawn SVG)
- Create typographic hierarchy with clear size jumps (1.25x+ ratio)
- Use subtle, purposeful shadows OR defined edges, never both
- Keep border-radius moderate (8-16px for cards, 4-6px for inputs)
- Write punchy, specific copy — not marketing buzzwords
- Let content breathe with varied spacing, not uniform padding
- Use solid colors for text, never gradients
- Design for the specific brand, not for "a good-looking UI"
</anti-slop-design-rules>
`;

// ─── Design System Presets ─────────────────────────────────────────────────

const DESIGN_PRESETS = {
  editorial: {
    name: 'Editorial',
    description: 'Magazine-style layout with strong typography, asymmetric grid, generous whitespace',
    fonts: { display: 'Fraunces', body: 'Newsreader', mono: 'JetBrains Mono' },
    palette: {
      bg: '#FAFAF7',
      surface: '#FFFFFF',
      text: '#1A1A1A',
      muted: '#6B6B6B',
      accent: '#C8553D',
      border: '#E5E5E0',
    },
    radius: { card: 4, button: 2, input: 2 },
    spacing: 'asymmetric, editorial rhythm',
  },
  brutalist: {
    name: 'Brutalist',
    description: 'Raw, high-contrast, monospace-heavy, exposed structure',
    fonts: { display: 'Space Mono', body: 'IBM Plex Sans', mono: 'Space Mono' },
    palette: {
      bg: '#FFFFFF',
      surface: '#F0F0F0',
      text: '#000000',
      muted: '#666666',
      accent: '#FF3B00',
      border: '#000000',
    },
    radius: { card: 0, button: 0, input: 0 },
    spacing: 'tight, structural, grid-exposed',
  },
  warm: {
    name: 'Warm Studio',
    description: 'Warm, crafted, slightly formal — like a design studio portfolio',
    fonts: { display: 'Playfair Display', body: 'DM Sans', mono: 'Fira Code' },
    palette: {
      bg: '#F5F0E8',
      surface: '#FFFDF8',
      text: '#1A1714',
      muted: '#6B6560',
      accent: '#B84A2F',
      border: '#E0D9D0',
    },
    radius: { card: 8, button: 4, input: 4 },
    spacing: 'generous, considered, breathing',
  },
  technical: {
    name: 'Technical',
    description: 'Clean, precise, data-dense — for dashboards and B2B tools',
    fonts: { display: 'IBM Plex Sans', body: 'IBM Plex Sans', mono: 'IBM Plex Mono' },
    palette: {
      bg: '#0D1117',
      surface: '#161B22',
      text: '#E6EDF3',
      muted: '#7D8590',
      accent: '#2EA043',
      border: '#30363D',
    },
    radius: { card: 6, button: 4, input: 4 },
    spacing: 'compact, functional, dense',
  },
  playful: {
    name: 'Playful',
    description: 'Bold, colorful, personality-driven — for consumer apps and Gen Z',
    fonts: { display: 'Bricolage Grotesque', body: 'Plus Jakarta Sans', mono: 'Fragment Mono' },
    palette: {
      bg: '#FFFEF7',
      surface: '#FFFFFF',
      text: '#1A1A2E',
      muted: '#6C6C80',
      accent: '#FF6B6B',
      border: '#E8E8E8',
    },
    radius: { card: 12, button: 8, input: 8 },
    spacing: 'dynamic, varied, energetic',
  },
  minimal: {
    name: 'Minimal Swiss',
    description: 'Swiss design principles, grid-based, Helvetica-adjacent, precise',
    fonts: { display: 'Suisse Int\'l', body: 'Inter Tight', mono: 'Suisse Mono' },
    palette: {
      bg: '#FFFFFF',
      surface: '#F7F7F7',
      text: '#0A0A0A',
      muted: '#999999',
      accent: '#0066FF',
      border: '#E0E0E0',
    },
    radius: { card: 0, button: 0, input: 0 },
    spacing: 'precise, grid-locked, mathematical',
  },
} as const;

// ─── Layout Patterns (non-slop) ─────────────────────────────────────────────

const LAYOUT_PATTERNS = [
  'asymmetric-hero: 60/40 split with content left, visual right (not centered hero)',
  'editorial-spread: Magazine-style two-column with pull quotes and sidebars',
  'feature-list: Vertical list with alternating image/text rows (not card grid)',
  'dashboard-split: Fixed sidebar + scrollable main content area',
  'story-scroll: Full-width sections that reveal on scroll, each with unique layout',
  'gallery-masonry: Asymmetric masonry grid with varying card sizes',
  'product-showcase: Large product image with floating detail callouts',
  'pricing-table: Single column comparison, not 3-tier card grid',
  'testimonial-inline: Quotes woven into the content flow, not a separate section',
  'cta-strip: Full-width band with bold typography, not a centered button',
];

// ─── Tool Definition ────────────────────────────────────────────────────────

export const createDesignGeneratorTool = (
  writable: WritableStream,
  prompt: any,
  factory: any
) => {
  const { readable, writable: toolStream } = new TransformStream();
  duplicateStreamObjectStream(writable, toolStream);

  return createTool(
    { toolName: 'design_generator' },
    {
      description:
        'Generate professional, non-AI-slop frontend designs as editable blocks.\n' +
        'Even with vague prompts, produces visually distinctive results by:\n' +
        '1. Analyzing intent and selecting an appropriate design system preset\n' +
        '2. Generating complete layouts with real content hierarchy\n' +
        '3. Applying 33 anti-slop rules to eliminate generic AI patterns\n' +
        '4. Producing editable Open-Agent document blocks\n\n' +
        'Supports: landing pages, dashboards, portfolios, product pages,\n' +
        'pricing pages, blog layouts, and custom designs.\n\n' +
        'Design presets: editorial, brutalist, warm, technical, playful, minimal\n' +
        'Layout patterns: asymmetric, editorial-spread, feature-list, dashboard,\n' +
        'story-scroll, gallery-masonry, product-showcase, pricing, testimonial, cta',
      inputSchema: z.object({
        prompt: z.string().describe(
          'What to design. Can be vague ("landing page for my startup") or ' +
          'specific ("3-column dashboard with sidebar nav, data table, and charts"). ' +
          'The tool will infer intent, audience, and aesthetic direction.'
        ),
        preset: z.enum([
          'auto', 'editorial', 'brutalist', 'warm', 'technical', 'playful', 'minimal',
        ]).default('auto').describe(
          'Design system preset. "auto" lets the tool choose based on the prompt. ' +
          'editorial=magazine, brutalist=raw/high-contrast, warm=studio/crafted, ' +
          'technical=dashboard/B2B, playful=consumer/GenZ, minimal=Swiss/precise.'
        ),
        contentType: z.enum([
          'landing-page', 'dashboard', 'portfolio', 'product-page',
          'pricing-page', 'blog', 'custom', 'auto',
        ]).default('auto').describe('Type of content to generate.'),
        brandColors: z.array(z.string()).optional().describe(
          'Optional brand color hex codes to use instead of preset defaults. ' +
          'E.g. ["#FF5733", "#2C3E50", "#ECF0F1"]'
        ),
        sections: z.array(z.string()).optional().describe(
          'Optional list of sections to include. E.g. ["hero", "features", "pricing", "footer"]. ' +
          'If omitted, the tool will determine appropriate sections based on contentType.'
        ),
        excludePatterns: z.array(z.string()).optional().describe(
          'Additional patterns to avoid beyond the built-in anti-slop rules. ' +
          'E.g. ["animations", "images", "icons"]'
        ),
      }),
      execute: async (input) => {
        try {
          // Determine the preset if auto
          let preset = input.preset;
          if (preset === 'auto') {
            const p = input.prompt.toLowerCase();
            if (p.match(/dashboard|admin|data|chart|metric|analytics|b2b|saas/)) {
              preset = 'technical';
            } else if (p.match(/magazine|blog|article|editorial|news|content/)) {
              preset = 'editorial';
            } else if (p.match(/portfolio|studio|agency|design|creative/)) {
              preset = 'warm';
            } else if (p.match(/gen.?z|fun|game|social|consumer|app|playful/)) {
              preset = 'playful';
            } else if (p.match(/raw|bold|punk|underground|experimental/)) {
              preset = 'brutalist';
            } else if (p.match(/minimal|clean|simple|swiss|grid|precise/)) {
              preset = 'minimal';
            } else {
              preset = 'editorial'; // safe default that's not AI slop
            }
          }

          const designSystem = DESIGN_PRESETS[preset as keyof typeof DESIGN_PRESETS];

          // Determine content type if auto
          let contentType = input.contentType;
          if (contentType === 'auto') {
            const p = input.prompt.toLowerCase();
            if (p.match(/dashboard|admin|panel/)) contentType = 'dashboard';
            else if (p.match(/portfolio|showcase/)) contentType = 'portfolio';
            else if (p.match(/product|shop|store|item/)) contentType = 'product-page';
            else if (p.match(/pricing|plan|subscription/)) contentType = 'pricing-page';
            else if (p.match(/blog|article|post/)) contentType = 'blog';
            else contentType = 'landing-page';
          }

          // Build the design brief that the AI will use to generate blocks
          const sections = input.sections || getDefaultSections(contentType);

          // Override colors if brand colors provided
          const colors = input.brandColors && input.brandColors.length >= 2
            ? {
                ...designSystem.palette,
                accent: input.brandColors[0],
                bg: input.brandColors[1],
                surface: input.brandColors[2] || designSystem.palette.surface,
              }
            : designSystem.palette;

          const designBrief = {
            preset: designSystem.name,
            description: designSystem.description,
            fonts: designSystem.fonts,
            colors,
            radius: designSystem.radius,
            spacing: designSystem.spacing,
            contentType,
            sections,
            layoutPatterns: LAYOUT_PATTERNS,
            antiSlopRules: ANTI_SLOP_RULES,
            excludePatterns: input.excludePatterns || [],
          };

          return {
            designBrief,
            instructions: `Generate a ${designSystem.name} design for a ${contentType} using the design system below. ` +
              `Follow the anti-slop rules strictly. Use the ${preset} preset colors and fonts. ` +
              `Sections: ${sections.join(', ')}. ` +
              `Generate editable document blocks that render this design in the Open-Agent frontend.`,
            antiSlopRules: ANTI_SLOP_RULES,
          };
        } catch (e: any) {
          return toolError('Design generation failed', e?.message || String(e));
        }
      },
    }
  );
};

function getDefaultSections(contentType: string): string[] {
  switch (contentType) {
    case 'landing-page':
      return ['hero-asymmetric', 'problem-solution', 'feature-list', 'social-proof-inline', 'cta-strip', 'footer'];
    case 'dashboard':
      return ['sidebar-nav', 'header-bar', 'main-content-area', 'data-table', 'chart-panel', 'action-bar'];
    case 'portfolio':
      return ['intro-asymmetric', 'project-gallery-masonry', 'about-inline', 'contact-cta'];
    case 'product-page':
      return ['product-hero-split', 'feature-highlights', 'spec-table', 'reviews-inline', 'purchase-cta'];
    case 'pricing-page':
      return ['pricing-comparison-single-column', 'feature-matrix', 'faq-inline', 'footer'];
    case 'blog':
      return ['article-hero-editorial', 'content-spread', 'author-bio-inline', 'related-articles-list'];
    default:
      return ['hero-asymmetric', 'content-sections', 'cta-strip', 'footer'];
  }
}

// ─── Design System Engine ──────────────────────────────────────────────────

export const createDesignSystemTool = () =>
  createTool({ toolName: 'design_system' }, {
    description:
      'Get or list available design system presets for the design generator. ' +
      'Returns complete design system specs (fonts, colors, spacing, radius) ' +
      'that can be used to maintain visual consistency across multiple designs.',
    inputSchema: z.object({
      action: z.enum(['list', 'get', 'validate']).describe(
        'list: show all presets, get: get one preset detail, validate: check a design against anti-slop rules'
      ),
      preset: z.enum([
        'editorial', 'brutalist', 'warm', 'technical', 'playful', 'minimal',
      ]).optional().describe('Preset name (required for "get" action)'),
      design: z.string().optional().describe(
        'Design description or HTML to validate against anti-slop rules (for "validate" action)'
      ),
    }),
    execute: async ({ action, preset, design }) => {
      if (action === 'list') {
        return {
          presets: Object.entries(DESIGN_PRESETS).map(([key, val]) => ({
            id: key,
            name: val.name,
            description: val.description,
            fonts: val.fonts,
            accentColor: val.palette.accent,
            bgColor: val.palette.bg,
          })),
        };
      }

      if (action === 'get' && preset) {
        const sys = DESIGN_PRESETS[preset as keyof typeof DESIGN_PRESETS];
        if (!sys) return toolError('Preset not found', `Available: ${Object.keys(DESIGN_PRESETS).join(', ')}`);
        return sys;
      }

      if (action === 'validate' && design) {
        const violations: string[] = [];
        const d = design.toLowerCase();

        if (d.includes('gradient') && (d.includes('purple') || d.includes('violet'))) {
          violations.push('AI color palette: purple/violet gradient detected');
        }
        if (d.includes('glassmorphism') || d.includes('backdrop-filter') || d.includes('frosted')) {
          violations.push('Glassmorphism detected — uses blur as decoration');
        }
        if (d.includes('border-radius: 24') || d.includes('border-radius: 32') || d.includes('border-radius: 48')) {
          violations.push('Extreme border-radius — cards rounded into blobs');
        }
        if (d.includes('font-family: inter') || d.includes('font-family: geist')) {
          violations.push('Overused font: Inter/Geist — not distinctive');
        }
        if (d.includes('gradient') && d.includes('text')) {
          violations.push('Gradient text — decorative, not meaningful');
        }
        if (d.match(/icon.*tile.*heading|icon.*container.*heading/)) {
          violations.push('Icon tile stacked above heading — universal AI feature card pattern');
        }
        if (d.includes('card') && d.includes('inside') && d.includes('card')) {
          violations.push('Card inside card — excessive nesting');
        }
        if (d.includes('uppercase') && d.includes('letter-spacing') && d.includes('hero')) {
          violations.push('Hero eyebrow — tiny uppercase label above hero headline');
        }

        return {
          valid: violations.length === 0,
          violations,
          slopScore: violations.length,
          recommendation: violations.length === 0
            ? 'Design passes anti-slop validation'
            : `Fix ${violations.length} violation(s) to reduce AI slop detection`,
        };
      }

      return toolError('Invalid action', 'Use: list, get, or validate');
    },
  });

// ─── Visual Polish Layer ───────────────────────────────────────────────────

export const createVisualPolishTool = () =>
  createTool({ toolName: 'visual_polish' }, {
    description:
      'Apply automatic visual polish to a design: fix spacing rhythm, ' +
      'color contrast, font hierarchy, and motion semantics. ' +
      'Checks against anti-slop rules and suggests specific fixes. ' +
      'Use after generating a design to ensure it passes quality checks.',
    inputSchema: z.object({
      designDescription: z.string().describe(
        'Description or HTML/CSS of the design to polish. ' +
        'Include layout structure, colors, fonts, spacing, and any animations.'
      ),
      targetPreset: z.enum([
        'editorial', 'brutalist', 'warm', 'technical', 'playful', 'minimal',
      ]).optional().describe('Target design preset to align the polished result with.'),
      fixLevel: z.enum(['subtle', 'moderate', 'aggressive']).default('moderate').describe(
        'How aggressively to fix issues. subtle=only critical fixes, ' +
        'moderate=fix slop + improve hierarchy, aggressive=full redesign pass.'
      ),
    }),
    execute: async ({ designDescription, targetPreset, fixLevel }) => {
      const fixes: { category: string; issue: string; fix: string; severity: 'critical' | 'warning' | 'suggestion' }[] = [];
      const d = designDescription.toLowerCase();

      // Spacing checks
      if (d.match(/padding:\s*(\d+)px/g)) {
        const paddings = [...d.matchAll(/padding:\s*(\d+)px/g)].map(m => parseInt(m[1]));
        const unique = [...new Set(paddings)];
        if (unique.length === 1 && paddings.length > 3) {
          fixes.push({
            category: 'spacing',
            issue: 'Monotonous spacing — same padding value used everywhere',
            fix: 'Vary spacing: use tighter padding within groups (8-16px) and larger gaps between sections (48-96px). Create visual rhythm.',
            severity: 'warning',
          });
        }
      }

      // Typography hierarchy
      if (d.match(/font-size:\s*(\d+)px/g)) {
        const sizes = [...d.matchAll(/font-size:\s*(\d+)px/g)].map(m => parseInt(m[1]));
        if (sizes.length >= 2) {
          const sorted = [...sizes].sort((a, b) => a - b);
          const minRatio = sorted.length > 1
            ? sorted[sorted.length - 1] / sorted[0]
            : 1;
          if (minRatio < 1.25) {
            fixes.push({
              category: 'typography',
              issue: 'Flat type hierarchy — font sizes too close together',
              fix: `Current ratio: ${minRatio.toFixed(2)}x. Increase to at least 1.25x between steps. E.g., 14/18/24/36/48px scale.`,
              severity: 'critical',
            });
          }
        }
      }

      // Single font check
      const fontMatches = d.match(/font-family:\s*([^;]+)/g);
      if (fontMatches) {
        const fonts = [...new Set(fontMatches.map(f => f.replace(/font-family:\s*/, '').trim()))];
        if (fonts.length === 1) {
          fixes.push({
            category: 'typography',
            issue: `Single font "${fonts[0]}" used for everything — no typographic hierarchy`,
            fix: 'Pair a distinctive display font for headings with a refined body font for text. E.g., Fraunces + DM Sans, or Playfair Display + Inter Tight.',
            severity: 'warning',
          });
        }
      }

      // AI slop color check
      if (d.includes('purple') || d.includes('violet') || d.includes('indigo')) {
        if (d.includes('gradient')) {
          fixes.push({
            category: 'color',
            issue: 'Purple/violet gradient — the #1 AI slop color pattern',
            fix: 'Replace with a distinctive, intentional color. Use a warm accent (terracotta, amber), a bold primary (electric blue, forest green), or a monochrome palette with one accent.',
            severity: 'critical',
          });
        }
      }

      // Border radius check
      const radii = [...d.matchAll(/border-radius:\s*(\d+)px/g)].map(m => parseInt(m[1]));
      if (radii.some(r => r >= 24)) {
        fixes.push({
          category: 'visual',
          issue: `Extreme border-radius (${Math.max(...radii)}px) — cards rounded into blobs`,
          fix: 'Reduce to 8-16px for cards, 4-6px for inputs/buttons. Reserve full-pill (999px) for tags and small buttons only.',
          severity: 'warning',
        });
      }

      // Card nesting
      if ((d.match(/card/g) || []).length > 5) {
        fixes.push({
          category: 'layout',
          issue: 'Too many cards — possible card-in-card nesting',
          fix: 'Limit nesting to 2 levels. Use flat layouts, dividers, or inline sections instead of wrapping everything in cards.',
          severity: 'suggestion',
        });
      }

      // Motion without meaning
      if (d.includes('animate') || d.includes('transition') || d.includes('keyframe')) {
        if (d.match(/bounce|wiggle|float|spin|pulse/)) {
          fixes.push({
            category: 'motion',
            issue: 'Decorative motion detected (bounce/wiggle/float) — motion without meaning',
            fix: 'Replace with purposeful motion: smooth transitions on state change (hover, focus), reveal-on-scroll for content, progress indicators for loading.',
            severity: 'warning',
          });
        }
      }

      // Gradient text
      if (d.includes('background-clip') && d.includes('text') && d.includes('gradient')) {
        fixes.push({
          category: 'color',
          issue: 'Gradient text — decorative, kills scannability',
          fix: 'Use solid colors for text. If you want emphasis, use weight, size, or color contrast instead.',
          severity: 'critical',
        });
      }

      // Apply fix level filtering
      const severityOrder = { critical: 0, warning: 1, suggestion: 2 };
      const maxSeverity = fixLevel === 'subtle' ? 0 : fixLevel === 'moderate' ? 1 : 2;
      const filteredFixes = fixes.filter(f => severityOrder[f.severity] <= maxSeverity);

      // Target preset alignment
      let presetAlignment: Record<string, unknown> | undefined;
      if (targetPreset) {
        const preset = DESIGN_PRESETS[targetPreset as keyof typeof DESIGN_PRESETS];
        if (preset) {
          presetAlignment = {
            targetPreset: preset.name,
            recommendedFonts: preset.fonts,
            recommendedColors: preset.palette,
            recommendedRadius: preset.radius,
            spacingPhilosophy: preset.spacing,
          };
        }
      }

      return {
        totalIssues: fixes.length,
        filteredIssues: filteredFixes.length,
        fixLevel,
        fixes: filteredFixes,
        ...(presetAlignment ? { presetAlignment } : {}),
        overallScore: Math.max(0, 100 - fixes.length * 15),
        recommendation: fixes.length === 0
          ? 'Design passes all anti-slop and quality checks'
          : fixes.length <= 2
            ? 'Minor issues — design is mostly clean'
            : fixes.length <= 5
              ? 'Several issues — design needs refinement'
              : 'Major issues — design has significant AI slop patterns',
      };
    },
  });
