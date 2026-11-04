# OMO Astra Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all active OMO SOL model overrides with the confirmed QGenie GPT-6 Astra model while preserving all non-SOL routing.

**Architecture:** Update the OMO category/agent override file so new OMO tasks resolve to Astra instead of SOL. Add Astra to OpenCode's local `qgenieopenai` model catalog because the live QGenie API exposes `azure::gpt-6-astra` but the current catalog does not. Existing sessions remain unchanged because their model is stored at session creation.

**Tech Stack:** JSON configuration, QGenie `/v1/models` API, OpenCode/OMO session database.

## Global Constraints

- Do not modify existing session records or historical usage data.
- Preserve every non-SOL model entry exactly as configured.
- Use the active model key `qgenieopenai/gpt-6-astra`, whose provider model id is `azure::gpt-6-astra`.
- Do not commit changes unless explicitly requested.

---

### Task 1: Add Astra to the active OpenCode model catalog

**Files:**
- Modify: `/usr2/haow/.config/opencode/opencode.json` in the `qgenieopenai.models` object after `gpt-5.6-sol`.

**Interfaces:**
- Consumes: Live QGenie model `azure::gpt-6-astra`, confirmed chat/tool-capable.
- Produces: `qgenieopenai/gpt-6-astra` resolvable by OpenCode and OMO.

- [ ] Add a `gpt-6-astra` entry with provider id `azure::gpt-6-astra`, active status, chat/tool support, text input/output modalities, 128000 context, and 32768 output limits matching the existing GPT reasoning model entries.
- [ ] Parse the file with `python -m json.tool /usr2/haow/.config/opencode/opencode.json` and expect exit code 0.

### Task 2: Replace OMO SOL overrides

**Files:**
- Modify: `/usr2/haow/.config/opencode/oh-my-openagent.json`.

**Interfaces:**
- Consumes: Existing category and agent model overrides.
- Produces: No active `gpt-5.6-sol` value in OMO configuration; every former SOL override resolves to Astra.

- [ ] Replace the three category values for `ultrabrain`, `deep`, and `unspecified-high` with `qgenieopenai/gpt-6-astra`.
- [ ] Replace the five agent values for `plan`, `oracle`, `metis`, `momus`, and `prometheus` with `qgenieopenai/gpt-6-astra`.
- [ ] Preserve `artistry`, `visual-engineering`, `unspecified-low`, `writing`, `quick`, `explore`, `librarian`, `multimodal-looker`, `hephaestus`, and `sisyphus-junior` unchanged.
- [ ] Parse the file with `python -m json.tool /usr2/haow/.config/opencode/oh-my-openagent.json` and expect exit code 0.

### Task 3: Verify effective routing and regression boundaries

**Files:**
- Read-only verification of both configuration files and `/usr2/haow/.local/share/opencode/opencode.db`.

**Interfaces:**
- Consumes: Updated model catalog and OMO overrides.
- Produces: Evidence that new routing targets Astra and existing session models are unchanged.

- [ ] Search both active config files for `gpt-5.6-sol` and expect no matches in model assignments.
- [ ] Confirm `azure::gpt-6-astra` is present in the live QGenie model list and in the local catalog.
- [ ] Confirm existing session `ses_ed0b46219ffeFFIz92f3VEEg3n` retains its original model record.
- [ ] Restart OpenCode or start a fresh session, run one categorized task, and verify the new session records `qgenieopenai/gpt-6-astra` rather than SOL.
