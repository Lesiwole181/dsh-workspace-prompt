# dsh-workspace-prompt (Workspace Prompt)

Keep one Markdown prompt per **workspace**. When enabled, the prompt is injected into the agent at the **start of every conversation** in that workspace — without adding a chat bubble.

- **Entry**: Settings → sidebar item **Workspace prompt**.
- **List**: only the workspaces **added to this page**; the **Manage workspaces** button sits at the top right of the list box (aligned with the settings panel's **Open configuration file** action) and adds/removes them in batches (removing also deletes the saved prompt).
- **Editing**: click any workspace row to open its prompt page:
  - **← Back** at the top left returns to the list;
  - the **enable switch** sits at the top right of the prompt box;
  - **Edit** mode writes Markdown and the **Save** button sits at the bottom right of the prompt box; **Browse** mode is read-only with Markdown rendering;
  - the UI is **bilingual (中文 / English)**.
- **Injection**: when the switch is on and the text is non-empty, every conversation in that workspace receives the prompt as runtime context. It never appears as a chat bubble; DSH's session log / inspection view still keeps the runtime-context snapshot (see below).

> **Plugin display name**: in the plugin interfaces (Settings → Plugins), this plugin is shown as **`dsh-workspace-prompt`** in both Chinese and English UI modes; the plugin's own settings-page title and sidebar entry remain “Workspace prompt / 工作区提示词”.

## Install

This is a standard DSH bundle (`dsh.bundle.patch` + `dsh.client` in `package.json`), with zero third-party dependencies and zero build step.

### A. Plugin manager (recommended)

1. Open DSH Settings → Plugins;
2. Add and install the local directory;
3. Refresh the page — **Workspace prompt** appears in Settings.

> Installation is performed by the DSH plugin manager against the current profile (install once per profile: web / desktop). It never modifies deepseek-harness source files.

### B. CLI (Web profile only)

```powershell
dsh plugin --profile web add <your path>
```

> **Desktop exception**: `profiles/desktop` is managed exclusively by the Electron application, so a
> CLI install is not enabled there. Install the same directory from the **Desktop app → Settings → Plugins**.

## Usage

1. Open **Settings** (gear at the sidebar foot) → **Workspace prompt**.
2. First time: click **Manage workspaces** at the top right of the list box (aligned with the settings panel's **Open configuration file** action), tick the workspaces to manage, then **Apply**.
3. Back in the list, click a workspace:
   - **Edit** to write the prompt, then **Save** at the bottom right;
   - **Browse** to read the rendered Markdown;
   - flip the switch at the top right of the prompt box to enable injection;
   - **← Back** at the top left returns to the list.
4. Send a message in that workspace — the prompt is injected when the conversation starts.

> Empty list? No workspace has been added yet: use **Manage workspaces**, or create/open a workspace in the sidebar first.

## Data and configuration

| Path | Purpose |
|---|---|
| `prompt/<workspace name>.md` | the prompt body per workspace (UTF-8 Markdown) |
| `state/workspaces.json` | added workspaces, file-name mapping, added time |
| `state/enabled.json` | enable switches (only enabled entries are stored) |

- Both directories live under the **plugin package root** by default (`...\dsh-workspace-prompt\prompt\`, `...\state\`) and are created automatically when missing.
- File names are sanitized from the workspace title; duplicates get `-2`, `-3`; renaming a workspace does not move its file (the mapping lives in the state file).
- Optional config (override the row config in the profile's `cordis.patch.yml`):
  ```yaml
  - id: dsh-workspace-prompt
    config:
      promptDirectory: 'D:\my-prompts'
      stateDirectory: 'D:\my-prompts-state'
  ```
- The environment variable `DSH_WORKSPACE_PROMPT_DIR` (absolute path) also overrides the prompt directory.

## Does the prompt show up in the conversation?

**Not as a chat bubble** and not as a chat message. To be precise: DSH materializes runtime-context snapshots into the session log (the log is the single source of truth). The Web Chat view **does not render ordinary context rows**; the snapshot is visible in the Trajectory / session-log inspection view. This is generic `systemPrompt.context` behavior (built-in runtime contexts such as the working directory behave the same way), not an extra conversation row added by this plugin.

## Compatibility

- Developed against DeepSeek Harness **0.2.1-rc.2**. Web and Desktop share the same Client module system and Host services, so one package works on both (install once per profile).
- Uses public extension points only: the `settings.section` slot, `ctx.systemPrompt.context()`, `ctx.connection.fetch`, `ctx.workspaceRegistry`. **No deepseek-harness source files are modified.**
- Zero third-party dependencies (Host: Node built-ins only; Client: platform `react` only), keeping the blast radius of future DSH upgrades small. State files and HTTP responses are versioned (`version: 1`) and read tolerantly.

## Troubleshooting

- **The settings sidebar has no “Workspace prompt” entry**: close and reopen the Settings panel; if it is still missing, refresh the page (the Client half is loaded through the browser module table and mounts only after the page reloads). If it remains missing, check that the plugin is installed and enabled under Settings → Plugins.
- **Behaviour did not change after updating plugin files**: Client chunks take effect only after the page reloads (the Host republishes via HMR and usually reloads the plugin automatically; otherwise refresh the page). The Host data plane needs no restart.

## Uninstall

Remove the bundle from the plugin manager: the Host context/routes and the Client settings page disappear with it. `prompt/` and `state/` data stay in place (back them up or delete them manually).

## Development

- Layout: `index.js` (Host assembly), `host/` (9 modules), `client.js` (Client entry), `client.*.js` (chunk modules), `docs/` (plan / contracts / architecture / API / verification).
- See `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/CONTRACTS.md`.
- No build step: the DSH Client module table loads the Client chunks directly.
- Tests live in the parent project directory (`CreateDSHplugins/temp&test/`) and are not shipped in the package.
- Verification records and rerun commands are in `docs/VERIFY.md` (live install, slot registration, real-session injection E2E, session-log evidence).

## License

MIT
