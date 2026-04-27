# Volta's Workflow Playbook — AI Context

This repo is a Mintlify documentation site that serves as a private, local-only playbook for Volta (also known as Youssef). It documents the AI-driven workflow Volta uses to build software projects with Claude (Opus + Sonnet).

## Scope

**Scope: backend AND frontend, project-agnostic.** This playbook is the operating manual for using Claude across all projects. It documents two distinct mindsets — backend (RIPER + SpecKit + waves) and frontend (design-first + component thinking + polish). Specific projects (MiniRue, future ones) NEVER appear in the playbook; they apply the playbook independently.

## Audience

- **Writer:** Volta only. No team edits.
- **Readers:** Volta's small dev team. They clone this repo and run `mint dev` locally to read it. The site is never deployed publicly.

## What this playbook is

A reference describing:
- The two-stage workflow (Stage 1 = Obsidian + Opus + RIPER for thinking; Stage 2 = SpecKit + Sonnet for building)
- The wave system (W1 MVP → W2 Early Growth → W3 Scale → W4 Hyper-scale)
- Prompt patterns (one page per slash command)
- End-to-end workflows (new module, fit-check, wave bump)
- Decision trees ("after Claude responds, do X")
- Glossary of terms

## What this playbook is NOT

- Not the actual workflow files (those live in Volta's Obsidian vault separately)
- Not project-internal data (no real specs, no real ADRs, no customer info)
- Not exhaustive — it's a reference for the common cases

## Target structure

docs/
├── docs.json
├── CLAUDE.md
├── README.md
├── index.mdx                       ← welcome (shared between tabs)
├── glossary.mdx                    ← reference (shared between tabs)
├── backend/
│   ├── workflow/                   ← mental-model, riper, speckit, waves, module-manifest
│   ├── prompts/                    ← one page per slash command
│   ├── workflows/                  ← end-to-end flows
│   └── decisions/                  ← decision trees
└── frontend/
    ├── mindset/                    ← design-first, components, polish, accessibility
    ├── prompts/                    ← (placeholder for future)
    ├── workflows/                  ← new-component, design-review, accessibility-audit
    └── decisions/                  ← (placeholder for future)

## Conventions when editing this repo

1. **Project-agnostic.** Never mention specific project names (MiniRue, etc.) in playbook content. The playbook is the manual; projects apply the manual. Project-specific decisions live in that project's Obsidian vault and codebase.
2. Files are MDX. Use Mintlify components: `<Note>`, `<Warning>`, `<Tip>`, `<Steps>`, `<Step>`, `<Card>`, `<CardGroup>`, `<Accordion>`, `<Tabs>`.
3. Every page has frontmatter: `--- title, description ---`.
4. Prompt pages follow this exact structure:
   - `## When to use`
   - `## The prompt` (in a code block, copy-paste-ready, no smart quotes)
   - `## What you get back`
   - `## What to do next`
5. Decision-tree pages use `<Steps>` components, not prose.
6. No smart quotes inside prompt code blocks (breaks copy-paste).
7. Keep pages short — if a page exceeds ~300 lines, split it.
8. Don't introduce new top-level navigation without updating docs.json AND asking Volta first.

## Don't touch without asking

- docs.json navigation structure
- Any starter-kit example pages until they're explicitly being replaced
- Any file outside this repo
