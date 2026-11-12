# Arrow Cube

A browser-local 3D arrow puzzle for desktop and touch screens. Rotate the cube, find a clear exit, and send each arrow flying off its face. Clearing the board advances to a new puzzle with a larger grid. No account or database is required.

## Run

Use a current Node.js LTS release and pnpm.

```sh
pnpm install
pnpm dev
```

Vite prints the local development URL. For the production version:

```sh
pnpm test
pnpm build
pnpm preview
```

Deploy the complete `dist/` directory to an HTTPS static host. The build bundles Three.js and generates a versioned service worker; the game has no runtime CDN dependency.

## Rules and levels

- Each of the six faces has its own square grid. **Level equals grid dimension**: level 5 is a 5 × 5 grid on each face.
- Supported dimensions are **2–64**. Choose a starting size using the difficulty picker, including a custom dimension.
- Each path is an arrow with a tail, optional bends, and a head. It can move only in the direction indicated by its head.
- An arrow is removable only when the straight corridor ahead of its head is clear. It leaves at that face's edge; paths do not wrap onto neighboring faces.
- A blocked selection leaves the board unchanged. There is no move limit or failure timer.
- Clear all arrows to unlock the next dimension. At dimension 64, completing a board offers another newly generated 64 × 64 puzzle.

## Controls

| Input | Action |
| --- | --- |
| Drag with mouse or one finger | Smoothly rotate the cube |
| Mouse wheel or two-finger pinch | Zoom |
| Click or tap a path | Release it if its exit is clear |
| Hint | Rotate to and highlight a removable arrow |
| Reset view | Restore the starting view |
| Restart | Restore the same puzzle and seed |
| Sound | Toggle the swoosh and other synthesized sounds |
| Arrow keys while the cube is focused | Rotate |
| H, then Enter while the cube is focused | Highlight, then release, a legal arrow |

## Why generated boards are solvable

`src/engine.js` constructs each face in **removal order**. It begins with an occupied grid and selects a head with an unobstructed ray to an edge. The tail grows through adjacent, still-occupied cells, producing a non-overlapping path with varied length and bends. Those cells are then carved out before the next arrow is selected.

Assembling the carved paths produces the starting board. Removing arrows in the recorded carve order recreates the clear corridors used during construction, so that order is a valid solution. Any isolated unused cells remain empty. Removing another legal arrow early cannot create a deadlock: removing paths only removes obstacles. The seed determines the board, and the engine exposes the solution for testing rather than requiring a runtime search solver.

Tests check cell bounds, adjacency, direction, non-overlap, determinism, generation diversity, and successful removal sequences across multiple seeds and dimensions. Storage tests cover saved-state restoration, corrupt input, and unavailable storage.

## Saved progress

The current dimension, puzzle seed, removed arrows, move count, sound preference, and highest dimension are saved in this browser's `localStorage` after moves and setting changes. Reloading resumes that board. Progress is specific to the browser profile and site origin; clearing site data removes it. If browser storage is unavailable, the game still runs and reports that saving is unavailable.

## Install and play offline

The production build includes a manifest and app icons. On browsers that expose an install prompt, an Install control becomes available when the browser confirms eligibility. Installation remains controlled by the browser. Browsers without that prompt can still play the regular website and may offer their own installation action.

Serve over **HTTPS**, or use `localhost` for development testing. A normal HTTP LAN address does not enable service workers. The worker is enabled only in production builds: use `pnpm build` and `pnpm preview` to test offline behavior.

Open the production game online once and allow its service worker to install before going offline. It precaches the app shell and bundled assets, so gameplay and local saves can continue without a connection. Updates use the normal service-worker lifecycle and take over after the previous app is closed; they do not force a reload during a puzzle.
