# Handoff: Resume Builder

## Overview
Resume Builder is a web app for importing a resume, keeping several **template resumes** (e.g. `Platform_Resume`, `AI_Resume`), attaching **jobs** (imported from LinkedIn job links or company career pages), and analyzing **keyword match** between a resume and a job. Each job uses a template; a job can also get its own **tailored copy** derived from that template. Users can connect **LinkedIn** (profile import), **Google Drive** (resume import), and an **AI provider** (OpenAI / Anthropic) to draft resume lines and apply free‑form **Notes**.

## About the Design Files
`Resume Builder.dc.html` is a **design reference built in HTML** — a clickable prototype showing intended look and behavior, not production code. All integrations (Drive, LinkedIn, job fetch, AI) are simulated with timeouts and sample data. Recreate it in the target codebase's environment; if none exists, recommended stack: **Next.js (App Router) + TypeScript + Tailwind**, Postgres (Supabase/Neon), object storage (S3/Supabase Storage).

To view: open `Resume Builder.dc.html` in a browser (keep `support.js` alongside it). Template markup is inside `<x-dc>`; all logic, sample data, and state live in the `<script data-dc-script>` class at the bottom — read it for exact behavior.

## Fidelity
**High-fidelity.** Final colors, type, spacing, copy, and interactions. Recreate pixel-accurately.

---

## Layout (app shell)
- Full viewport: `height: 100vh`, column flex, no page scroll.
- **Top bar**: 52px, white, bottom border `#e4e4e7`, padding `0 12px`, gap 14px.
- **Body**: CSS grid, 3 columns:
  - Left: `clamp(200px, 22vw, 272px)` → `40px` when collapsed
  - Center: `minmax(0, 1fr)`
  - Right: `clamp(240px, 27vw, 320px)` → `40px` when collapsed
- Each panel scrolls independently.

### Top bar (left → right)
1. Left-panel toggle (30×30, icon = 16×13 rounded box, 1.5px border `#52525b`, left border 5px).
2. Logo: 22×22 square, radius 6, bg `#2f6bd8`, white "R" 12/600; wordmark "Resume Builder" 14/600, letter-spacing −0.01em.
3. 1×20 divider `#e4e4e7`.
4. Current source file name (13/500, ellipsis) + source label in mono 11px `#61616b` (e.g. "Google Drive · synced") + ghost button **Import resume**. Empty state shows "No resume imported".
5. Spacer.
6. LinkedIn button: "Connect LinkedIn" or, when connected, green dot (7px `#1f8a4c`) + "LinkedIn".
7. AI button: "Connect AI" or green dot + "{Provider} · {Model}" (e.g. "Claude · Claude Sonnet").
8. Primary **Export PDF**.
9. Right-panel toggle (same icon, right border 5px).

### Left panel — Templates & Jobs
- **Templates block** (padding 14/8/10, bottom border `#efeff1`): header "Templates" 13/600 + text button "+ New" (accent, opens Import modal). List (max-height 150, scroll): rows padding 7×8, radius 7; doc glyph 9×11 bordered box (`#a1a1aa`, accent when selected); name in Geist Mono 12/500; right "N jobs" 11.5 `#61616b`. Selected bg `#eef3fd`.
- **Jobs header**: "Jobs" 13/600, "{n} saved" 12 muted; primary small "+ Add job".
- **Job card** (padding 10×12, radius 8, 1px border transparent; selected bg `#eef3fd` border `#c9d8f6`):
  - Row 1: company 12/500 `#61616b` + score pill (mono 11/500, padding 2×6, radius 5).
  - Title 13.5/500, line-height 1.3.
  - Meta mono 11 muted: "{Source} · {Location}".
  - Template tag (mono 10.5, padding 2×6, radius 4): `{TemplateName}` on `#f4f4f5`/`#52525b`, or `Tailored · {TemplateName}` on `#eaf0fc`/`#1e4a99`.
- Footer hint (12px muted): "Paste a LinkedIn job link or a company careers page to add a job."
- **Collapsed rail** (40px): full-height button, "«" + vertical text "Templates & jobs" (writing-mode vertical-rl, 12/500, tracking .06em).

Score pill colors: ≥75 bg `#dde7fb` fg `#2659b8`; 55–74 bg `#f1f1f3` fg `#3f3f46`; <55 bg `#fbefe6` fg `#9a4413`; none "—" on `#f4f4f5`.

### Center — Document
Background `#f4f4f5`, scroll area padding `20px 24px 40px`.

**Document bar** (max-width 800, centered, margin-bottom 14):
- Tag chip mono 10.5/500: `TEMPLATE` (bg `#e4e4e7`, fg `#27272a`) or `TAILORED` (bg `#2f6bd8`, white).
- Name 14/600: template name, or "{Company} version".
- Subtext 12.5 muted: "used by N jobs" or "from {TemplateName}".
- Actions (right):
  - Job using template: "Template" `<select>` (reassign template) + primary **Tailor for {Company}**.
  - Tailored job: ghost **View template**, ghost **Discard tailoring**.
  - Template view: ghost **Duplicate**.
- Hint line 12.5 muted:
  - Tailored: "Edits only affect this job. Keywords from {Company} are highlighted."
  - Template in job context: "Edits here change the template for all N jobs using it. Tailor it to make changes just for {Company}."
  - Template view: "Changes apply to every job using this template. Select a job to see keyword matches."

**Resume page** (max-width 800, white, 1px `#e4e4e7`, radius 4, shadow `0 1px 2px rgba(0,0,0,.04), 0 10px 30px rgba(0,0,0,.05)`, padding `clamp(24px,4vw,52px) clamp(20px,4.5vw,60px)`):
- Body: Source Serif 4, 14.5px / 1.55, `#27272a`.
- Name: 30/600, line-height 1.15, `#18181b`.
- Headline: Geist 13/500, uppercase, tracking .08em, `#3f3f46`.
- Contact: Geist 12.5 `#52525b`.
- Section headings (Summary, Experience, Skills, Education): Geist 11/600, uppercase, tracking .12em, `#3f3f46`, bottom border 1px `#e4e4e7`, padding-bottom 5, margin `26px 0 10px`.
- Role header: title 600 `#18181b` · company `#3f3f46` · dates right (Geist 12 muted). Roles gap 18px.
- Bullets: grid `16px 1fr`, "•" in `#a1a1aa`, gap 3px. "+ Add bullet" Geist 12 muted (hover accent), indented 16px.

**Inline editing**: every line (name, headline, contact, summary, bullets, skills) is click-to-edit. Hover: bg `#f3f6fc`, radius 4. Editing swaps to an auto-growing textarea with identical typography, outline 1.5px `#2f6bd8`, bg `#f7f9fe`. Enter (except Summary) or Esc commits; blur commits; empty bullets are deleted on blur.

**Keyword highlights** (job context only) — three variants (prototype prop `highlightStyle`):
- `marker`: bg `#dde7fb`, radius 3, padding 0 2px.
- `underline`: 2px `#2f6bd8` underline, offset 3px.
- `bold`: 600, color `#2659b8`.
- Focused keyword (clicked in right panel): bg `#2f6bd8`, white text.

**Notes drawer** (bottom of center column, white, top border):
- Collapsed by default: 44px bar — "Notes" 13/600, hint "{n} quick notes · private, used when tailoring with AI", "Show"/"Hide" mono 11.
- Expanded: list of one-line notes (max-height 96, scroll; rows bg `#f6f6f7`, radius 6, 13px, × remove) + single-line input ("Add a quick note… then press Enter") + primary **Apply notes with AI** (or "Connect AI to apply notes").

**Empty state** (no resume): centered, max-width 560: title "Start with your current resume" 22/600; body 14 muted; dashed dropzone 168px (1.5px dashed `#c9c9d0`, radius 12; hover accent border + `#f7f9fe`) "Drop a .docx or .pdf here / or click to browse · up to 10 MB"; two tiles: Google Drive, LinkedIn profile.

### Right panel — Keyword match
**Job context:**
- Header: "KEYWORD MATCH" mono 11 uppercase; job title 14/600; "{Company} · View posting ↗".
- Score block — three variants (prop `scoreStyle`):
  - `ring`: 96px SVG ring, r=40, stroke 8, track `#efeff1`, progress `#2f6bd8` round caps; % 24/600 centered; tier + "X of Y keywords found" + "Required A/B".
  - `bar`: 36/600 % + tier; 8px bar; summary + required line.
  - `breakdown`: % + tier + required; per-category rows (Hard skills, Tools, Domain, Soft skills): label 92px, 6px bar, "g/n" mono.
  - Tiers: ≥75 "Strong match", ≥55 "Partial match", else "Weak match".
- **Missing** list (required first): keyword 13/500, "REQUIRED" tag (mono 10, `#9a4413` on `#fbefe6`), text button "+ Skills".
- **Matched** chips (26px pill, 12.5px, bg `#eef3fd` fg `#1e4a99`, count "×n" mono 10.5). Click toggles focus highlight in the resume.
- **Tailor with AI** card (1px border, radius 10, padding 14): badge "{Provider} · {Model}" or "Not connected"; idle copy + primary button ("Connect ChatGPT or Claude" / "Suggest lines for N gaps"); loading spinner "Drafting with Claude…"; ready: suggestion cards (bg `#fafafa`) with "+ {keyword} → {Company}", proposed bullet, **Add to resume** / **Dismiss**.

**Template context:** header "TEMPLATE", name (mono 14), "Used by N jobs"; list "Jobs using this template" and "Other jobs — How this template would score against them", each row clickable → opens that job.

**Collapsed rail:** "»" + vertical "Keyword match".

---

## Modals
Overlay `rgba(24,24,27,.36)`, dialog max-width 520, radius 12, padding 22, shadow `0 20px 60px rgba(0,0,0,.18)`. Click outside closes (disabled while loading).

1. **Import resume** → choose: Google Drive / Upload a file (.docx/.pdf) / LinkedIn profile. → **Drive picker**: radio list of files, Cancel/Import. → **Loading**: file name, indeterminate 6px bar, "Reading sections, roles and skills…". Result: saved as a **new template** named from the file (e.g. `Resume_PM_v3`), opened in template view. First import in empty state assigns all jobs to it.
2. **Connect LinkedIn** → intro (3 permission lines) → "Waiting for LinkedIn sign-in…" → connected profile card (avatar initials, name, headline, "3 positions · 14 skills · 1 school") with "Add missing skills to resume" or "Build resume from profile".
3. **Add a job** → tabs "Job link" / "Paste description"; URL field with live detection ("Detected: LinkedIn job" / "Company website") → loading → preview: source, title, company · location, "N keywords found" chips, **Base template** select (each option shows % match; best match preselected + "Recommended: …") → **Add job and analyze**.
4. **Connect an AI assistant** → provider cards (ChatGPT/OpenAI, Claude/Anthropic; selected = 1.5px accent border + `#f3f6fc`), sign-in method segmented ("Sign in with {Provider}" / "API key" → password input), Model select, Connect / Save / Disconnect.

Toast: fixed bottom-center, `#18181b`, white 13px, radius 8, auto-dismiss 2.6s.

---

## Interactions & Behavior
- **Template vs tailored resolution**: job's displayed doc = tailored copy if it exists, else its template.
- **Auto-tailor**: in a job without a tailored copy, job-specific actions ("+ Skills", accepting AI suggestion, applying notes) first clone the template into a tailored copy, then apply the change. Direct text edits in that state edit the template (warned by hint text).
- **Discard tailoring** deletes the copy; job reverts to template.
- **Changing a job's template** (select) only available when not tailored.
- **Live scoring**: score recalculates on every keystroke. Matching = case-insensitive, word-start boundary (`\bkeyword`), so "Roadmap" matches "Roadmapping".
- **Score** = Σ weights of matched / Σ all weights; required = 2, preferred = 1.
- Switching job/template clears edit state, focused keyword, and AI suggestions.
- Panel toggles in top bar and on collapsed rails.
- Loading durations in prototype: import 1.6s, LinkedIn 1.4s, job fetch 1.4s, AI 1.2–1.5s (replace with real requests).

## State / Data Model
```ts
Template   { id, name, sourceFile, source: 'drive'|'upload'|'linkedin', docId }
ResumeDoc  { name, headline, contact, summary, roles: Role[], skills: string, education: Edu[] }
Role       { title, company, dates, bullets: string[] }
Job        { id, title, company, location, source: 'linkedin'|'company'|'pasted', url?, rawDescription,
             keywords: Keyword[], templateId, tailoredDocId? }
Keyword    { term, category: 'Hard skills'|'Tools'|'Domain'|'Soft skills', required: boolean, aliases?: string[] }
Note       { id, text, createdAt }
AIConnection { provider: 'openai'|'anthropic', model, method: 'oauth'|'apiKey', encryptedKey? }
UI         { selectedJobId, viewTemplateId | null, editingFieldId, focusKeyword, leftOpen, rightOpen, notesOpen, modal }
```

## Implementation notes (integrations)
- **Google Drive**: Google OAuth (`drive.readonly` or `drive.file`) + Google Picker; export Google Docs as .docx.
- **Parsing**: `mammoth` (.docx), `pdf-parse`/`pdfjs-dist` (.pdf) → LLM call with a JSON schema to structure into `ResumeDoc`.
- **LinkedIn profile**: official Sign In with LinkedIn (OIDC) returns only name/email/photo; full positions/skills need partner API access. Practical fallback: accept the LinkedIn "Save to PDF" profile export.
- **Job import**: server-side fetch; prefer `schema.org/JobPosting` JSON-LD, else Readability text; LinkedIn often blocks scraping → keep "Paste description". LLM extracts keywords with category + required flag.
- **AI**: consumer ChatGPT/Claude subscriptions cannot be used by third-party apps; implement bring-your-own API key (encrypted at rest) and/or a platform key with metered billing. Abstract providers behind one interface; send resume + job + notes; return structured suggestions `{ keyword, roleIndex, bullet }`.
- **Export**: render the resume component to PDF (Playwright `page.pdf()` or `@react-pdf/renderer`).

## Design Tokens
- Ink `#18181b`, ink-2 `#27272a`, ink-3 `#3f3f46`, ink-4 `#52525b`, muted `#61616b`, faint `#a1a1aa`
- Lines `#e4e4e7`, `#efeff1`, `#f1f1f3`; app bg `#f4f4f5`; surface `#ffffff`; subtle `#fafafa`, `#f6f6f7`
- Accent `#2f6bd8`, hover `#2659b8`, tints `#eaf0fc`, `#eef3fd`, `#f3f6fc`, `#f7f9fe`, `#dde7fb`, `#d6e2f8`, border `#c9d8f6`, deep `#1e4a99`
- Warning text `#9a4413` on `#fbefe6`; success dot `#1f8a4c`
- Fonts: **Geist** (UI), **Geist Mono** (labels/meta), **Source Serif 4** (resume body) — Google Fonts
- Type scale: 10.5, 11, 12, 12.5, 13, 13.5, 14, 14.5, 16, 22, 24, 28, 30, 36
- Radii: 3–4 (highlights/tags), 5–7 (buttons, pills), 8 (cards, inputs), 10 (tiles), 12 (modals/dropzone), 13 (chips)
- Buttons: height 30 (32 in modals), padding 0 11–14, 12.5/500; primary accent bg/white; ghost white + 1px `#e4e4e7`, hover `#f4f4f5`
- Shadows: page `0 1px 2px rgba(0,0,0,.04), 0 10px 30px rgba(0,0,0,.05)`; modal `0 20px 60px rgba(0,0,0,.18)`; toast `0 8px 24px rgba(0,0,0,.2)`

## Assets
No images or icon files. Glyphs are text (→, ←, ×, «, », ✓, •) and CSS boxes. Provider/LinkedIn/Drive are text labels — use official brand marks per each brand's guidelines if desired.

## Files
- `Resume Builder.dc.html` — full prototype (markup + logic + sample data: `RESUME`, `TEMPLATES`, `DOCS`, `JOBS`, `NEW_JOB`, `SUGG`)
- `support.js` — runtime needed to open the prototype locally
