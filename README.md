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

To play from another computer on this laptop's Tailscale network, keep `pnpm dev` running and configure the private port forwarder:

```sh
tailscale serve --bg --tcp=5173 tcp://127.0.0.1:5173
```

Then open **http://riva-laptop:5173/** on the other computer. `localhost` refers to the computer running the browser. The Tailscale forwarder stays configured in the background and forwards to the local development server, which must also be running. This setup allows the game to be reached through Tailscale when Windows blocks direct inbound connections to the Node executable.

To remove only this forwarder:

```sh
tailscale serve --tcp=5173 off
```

## GitHub publishing

The two workflows in `.github/workflows/` publish the app in different forms:

- **Publish GitHub Pages** runs when a `v*.*.*` tag is pushed, such as `v1.0.0`. It tests the tagged code, builds with the Pages subpath, and deploys the generated site. It can also be started manually from the Actions tab. The repository's Pages publishing source must be **GitHub Actions**.
- **Publish Docker image** runs on every push to `main` and every pushed tag. The Docker build runs the tests and publishes images for `linux/amd64` and `linux/arm64` to `ghcr.io/chrisawad/arrow-cube`. It uses the built-in `GITHUB_TOKEN`; no Docker Hub credentials are needed.

Docker tags `main` and `latest` follow `main`. A Git tag such as `v1.0.0` creates image tags `v1.0.0` and `1.0.0`. Every build also has a `sha-…` tag tied to its commit. The GitHub Actions are pinned to exact commits.

To publish a release from the current committed revision:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The Pages address is **https://chrisawad.github.io/arrow-cube/**. Because it uses HTTPS, a compatible browser can install it as a PWA.

To run a published Docker image:

```sh
docker run --rm -p 8080:8080 ghcr.io/chrisawad/arrow-cube:main
```

Open **http://localhost:8080/**. The container serves the packaged app with an unprivileged Nginx process. To build it locally instead:

```sh
docker build -t arrow-cube:local .
docker run --rm -p 8080:8080 arrow-cube:local
```

## Rules and levels

- **Level equals cube dimension**. New cubes use about 1.6 surface lanes per dimension unit, rounded to a whole number with a minimum of four lanes: level 5 has an 8 × 8 lane grid on each face. Earlier saved boards retain their original grid.
- New games start at **5 × 5**. Supported dimensions are **2–64**. Choose a starting size using the difficulty picker, including a custom dimension. Saved games resume at their current dimension.
- Each path is an arrow with a tail, bends, and a head. Paths can continue around cube edges onto other faces. They can move only in the direction indicated by their head.
- New boards mix ordinary paths with long winding arrows of **3–75 cells**. Random turns, mixed directions, and edge crossings create dependency chains, so most arrows need another path cleared first. Small gaps are allowed.
- Bold strokes and larger arrowheads improve visibility. The roomier grid and longer paths reduce the number of separate arrows to track.
- An arrow is removable only when the straight corridor ahead of its head is clear. Its tail follows the wrapped path as its head leaves the edge of its current face.
- The cube is translucent: near-face paths are black and far-face paths show through as pale silhouettes. Rotate to interact with a far face.
- An arrow's first blocked attempt moves forward in black, turns red with a short tick on contact, and quickly slides back. It stays red afterward, including after reloading. Hints temporarily highlight it in purple; restarting or choosing a new board clears the red marks. A collision does not remove any arrows or increment the move count. There is no move limit or failure timer.
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
| Arrow motion | Follow device settings, use full animations, or reduce movement |
| Arrow keys while the cube is focused | Rotate |
| H, then Enter while the cube is focused | Highlight, then release, a legal arrow |

Arrow motion defaults to **Full animation**, with swoosh, collision, and rollback movement. Choose **Follow device** to use the device's reduced-motion preference, or choose **Reduced motion** directly. Explicit choices are saved with your progress. Opening `http://riva-laptop:5173/?motion=full` also selects and remembers full animation without replacing your board.

## Why generated boards are solvable

`src/engine.js` carves random paths over all six faces in removal order. Each chosen head has a clear ray to its face edge, and its tail grows through adjacent, still-occupied cells, favoring turns and crossings over cube edges. This produces mixed directions throughout each face without a fixed row-by-row pattern.

A bounded search helps tails reach longer target lengths without getting stuck at the first dead end. Short pieces and some complete later paths are absorbed into adjacent earlier tails, mixing ordinary lengths with much longer arrows. Any pieces below three cells that cannot be joined become gaps. Joining pieces only moves cells earlier in the removal order, and leaving gaps only removes obstacles, preserving the solution. Removing another legal arrow early cannot create a deadlock: removing paths only removes obstacles. The seed determines the board, and the engine exposes the solution for testing rather than requiring a runtime search solver.

Tests check cell bounds, adjacency, direction, non-overlap, determinism, generation diversity, and successful removal sequences across multiple seeds and dimensions. Storage tests cover saved-state restoration, corrupt input, and unavailable storage.

## Saved progress

The current dimension, puzzle seed, generator version, removed arrows, red crash marks, move count, sound preference, and highest dimension are saved in this browser's `localStorage` after moves, impacts, and setting changes. Reloading resumes that board. Older saved puzzles retain their original generator and exact progress; new puzzles use the random, minimum-three-cell generator. Choose a starting difficulty to get a fresh board at any size. Progress is specific to the browser profile and site origin; clearing site data removes it. If browser storage is unavailable, the game still runs and reports that saving is unavailable.

## Install and play offline

Run the installable local build with:

```sh
pnpm app
```

On the laptop hosting the game, open **http://localhost:4173/** in Chrome or Edge. This runs entirely on your machine. The existing development server at port 5173 can keep running separately. The production build includes the manifest, app icons, and offline worker. The Install control appears once the browser makes an install prompt available; Install help explains unavailable states.

Installation requires **HTTPS** or a loopback address such as `localhost`. The HTTP LAN address `http://riva-laptop:5173/` can play the game, but cannot offer the normal PWA installation flow. On another device, use a trusted HTTPS connection to this local server; `localhost` on a phone refers to the phone itself. An embedded preview may not support installation, so open the game in the device's full browser. Installation remains controlled by the browser.

For an Android phone connected over authorized USB debugging, forward the local app port:

```sh
adb reverse tcp:4173 tcp:4173
```

Then open **http://localhost:4173/** in Chrome on the phone. This routes only that phone port to the laptop over USB. Keep the cable connected for the initial load, installation, and updates. Once the offline setup is ready, cached gameplay can run without the connection. Reapply the forwarding command after reconnecting if needed.

The offline worker is enabled only in production builds. Saved progress is separate for each address and port, so opening the production address starts a separate save from the development address.

Open the production game online once and allow its service worker to install before going offline. It precaches the app shell and bundled assets, so gameplay and local saves can continue without a connection. Updates use the normal service-worker lifecycle and take over after the previous app is closed; they do not force a reload during a puzzle.
