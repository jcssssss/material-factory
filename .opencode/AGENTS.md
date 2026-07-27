# AGENTS.md — 小红书素材工厂 (xhs-pic)

## Stack
- React 18 + TypeScript 5 + Vite 5 + Tailwind CSS 3
- Zustand 5 (single store: `src/store/useTaskStore.ts`)
- React Router 6 via `HashRouter` (URLs: `#/`, `#/history`, `#/logs`)
- Tauri 2 (Rust backend) + `@tauri-apps/plugin-dialog`
- pdfjs-dist 3.11 (PDF parsing), Vitest + jsdom (testing)

## Commands
| Action | Command |
|--------|---------|
| Dev server | `npm run dev` (Vite on :5173) |
| Full build | `npm run build` (tsc -b && vite build) |
| All tests | `npm test` (vitest run) |
| Watch tests | `npm run test:watch` |
| Coverage | `npm run test:coverage` |
| Tauri dev | `npm run tauri:dev` |
| Tauri build | `npm run tauri:build` |

## Color tokens
Use `workspace-*` tokens from `tailwind.config.js` (`workspace-accent`, `workspace-bg`, `workspace-surface`, `workspace-border`, `workspace-muted`, `workspace-fg`, `workspace-fg-secondary`, `workspace-danger`, etc.). The old `desktop-*` prefix was migrated to `workspace-*` — never reintroduce `desktop-*`.

## Key architecture
- **3 pages**: WorkbenchPage (default), HistoryPage, LogViewerPage — defined in `src/routes/index.tsx`
- **1 store**: Zustand with queue (not persisted), history (localStorage), logs (Rust file), breakpoints (localStorage)
- **Execution**: Serial task runner in `src/lib/taskRunner.ts` with pause/resume/cancel via `TaskController`
- **3-tier error isolation**: page-level → PDF-level → task-level
- **Path alias**: `@/` → `src/` (configured in both tsconfig and vite)

## TypeScript quirks
- Strict mode with `noUnusedLocals` and `noUnusedParameters` — keep params prefixed with `_` if unused
- `noEmit: true` — use `tsc -b` (not `tsc`) for the build command
- Test files (`*.test.ts`, `*.spec.ts`) are **excluded** from `tsconfig.json` `include` — they're only compiled during `vitest`
- Separate `tsconfig.node.json` for Vite config files

## Testing
- Vitest with jsdom environment (no real Canvas — mock in `src/lib/mockPageProcessor.ts`)
- Test files: `src/**/*.{test,spec}.{ts,tsx}`
- Coverage focused on `src/lib/` except mocks

## Vite / Tauri specifics
- `base: "./"` for Tauri `file://` protocol serving
- `build.target: "es2022"` required for pdfjs-dist top-level await
- `server.strictPort: true` — always :5173
- HMR uses ws:// on :5174 when `TAURI_DEV_HOST` is set (mobile/remote debugging)
- Vite watch ignores `src-tauri/**`, `dist/**` to avoid unnecessary restarts

## Rust backend (src-tauri/)
- Commands in `src-tauri/src/lib.rs`: file I/O (read PDF bytes, write JPG), folder scanning, LibreOffice Word→PDF conversion, log persistence
- Tauri plugin: only `tauri-plugin-dialog` for native file picker
- Log file: `{app_data_dir}/logs/app.log` (JSONL format)
- macOS TCC protection: using ~/Downloads/~/Desktop/~/Documents may fail — the app shows a friendly error with remediation steps
- LibreOffice candidates: `/Applications/LibreOffice.app/Contents/MacOS/soffice` (macOS), `/usr/bin/soffice` (Linux), `C:\Program Files\LibreOffice\program\soffice.exe` (Windows)

## Special conventions
- Use `generateMaterialList` checkbox (folder mode only) for material list image generation
- Skills are in `.agents/skill/` directory (not `.opencode/skill/` or `.trae/skills/`)
- Design tokens use `workspace-` prefix; icons use inline SVGs from Heroicons
