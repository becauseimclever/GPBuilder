# Where we left off

## Goal

Add a board config for the Pimoroni Pico LiPo 2 XL W, build it with GPBuilder (locally and via
the GitHub Action), and test it on real hardware.

## Status

- Board config created and building. **Hardware test not yet done.**
- Nothing is merged to `main` anywhere yet. All work is on feature branches.

| Repo | Branch | Contents |
| --- | --- | --- |
| `becauseimclever/GPBuilder` | `rp2350-support` | RP2350 UF2 validation (family `0xe48bff59`, optional leading absolute block), `PICO_COMPILER` gate, docs, tests, regenerated `dist/` |
| `Fortinbra/Board-Config-Registry` | `add-pimoroni-pico-lipo2-xl-w` | `configs/PimoroniPicoLipo2XLW/` (mirrors PimoroniPicoPlus2 for RP2350, Pico pin definitions) and manifest updates |
| `Fortinbra/GP2040-CE` | `lipo2xlw-test` | `cmake.yml` test workflow; temporarily pinned to the two branches above |

## Build results

- Local UF2 (firmware `main` @ `3d1f32f7d02d418826b725b60208278d3be878c3`):
  `artifacts\PimoroniPicoLipo2XLW\main\3d1f32f7d02d418826b725b60208278d3be878c3\release\a788df5b-1250-4ddb-b0cb-47fe81ace78e\GP2040-CE_main_3d1f32f7d02d418826b725b60208278d3be878c3_PimoroniPicoLipo2XLW.uf2`
  (SHA-256 `0a5b65734a504f175cbd730ce37d7a38767c88a3a244ebc87072838a44d3bd5e`)
- Action run: https://github.com/Fortinbra/GP2040-CE/actions/runs/37152438510. OpenCore0, Pico, and
  PimoroniPicoLipo2XLW all succeeded. The UF2 is in the artifact `firmware-PimoroniPicoLipo2XLW`.

To rebuild locally (Node 24):

```powershell
node dist/cli.cjs --configs C:\ws\Board-Config-Registry\configs --release main --board PimoroniPicoLipo2XLW
```

## Next steps

1. Flash the UF2 on the LiPo 2 XL W (hold BOOTSEL while plugging in, then copy the UF2 to the drive)
   and verify that inputs work.
2. If it works, open PRs and merge:
   - GPBuilder `rp2350-support`. Then cut a new release (after v0.8.0).
   - Registry `add-pimoroni-pico-lipo2-xl-w`.
3. In the fork's `cmake.yml`, revert the pins: `becauseimclever/GPBuilder@rp2350-support` goes back to the
   released tag, and the registry checkout `ref` goes back to `main`. Keep the PimoroniPicoLipo2XLW matrix
   entry, merge to the fork's `main`, and delete `lipo2xlw-test`.

## Notes

- Do not touch `C:\ws\GP2040-CE`; it has unrelated uncommitted changes. Fork work happens in the
  `C:\ws\GP2040-CE.worktrees\gpbuilder-release` worktree.
- Do not commit the registry's `.vscode/`.
