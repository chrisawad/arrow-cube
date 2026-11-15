# Arrow Cube

A browser-local 3D arrow puzzle for desktop and touch screens. Rotate the cube, find a clear exit, and send each arrow flying off its face. Clearing the board advances to a new puzzle with a larger grid. No account or database is required.

The cube canvas fills the viewport, with progress and controls floating above it. Mobile controls respect safe-area insets and changing browser-bar heights. The stylesheet loads from the HTML head so the initial page is styled before the game JavaScript starts.

Each puzzle starts with five hearts. Each crash removes one; the fifth crash opens the loss screen. Successful releases and hints are unlimited. A reset token refills all five hearts while keeping puzzle progress; it can also be used early by tapping the reset icons. Players can hold four reset tokens and recover one every three hours, including time offline. With no hearts or reset tokens, choose Go back to wait on the same board, or restart the exact same puzzle for free. An arrow attempt at zero hearts reopens the refill choice. Go back does not change progress, hearts, or the recovery timer. Starting or restarting a puzzle restores hearts but never refills reset tokens. Saves retain the seed, cleared paths, hearts, reset balance, and recovery deadline. Older life balances migrate to reset tokens capped at four.

The compact HUD shows the level, completion percentage and bar, five heart icons, and four reset icons. Hint, Theme colors, Help, and Settings sit below the cube. Settings holds theme colors, difficulty, sound, animation, and installation controls. The Theme panel uses the bundled iro.js color wheel with brightness and hex controls. Select a game part to preview its color immediately; choices persist on this device. Reset this color restores only the selected part to its default; other colors and puzzle progress stay unchanged. The default slide-edge color is #b000a7.

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
- Ordinary paths have one arrowhead. Green-to-yellow paths have two: clicking the green half leads with the green end; clicking the yellow half leads with the yellow end. The split follows distance along the line, including bends and face crossings.
- **Magenta slide edges** wrap the entire shared edge in both directions. Moving lines continue onto the neighboring face instead of leaving the cube there. Thick magenta strokes have shallow rounded corner joins and rounded ends.
- **Light-blue double chevrons** are fixed cell markers. When a moving line's leading tip reaches one, it turns in the marked direction. Lines keep moving through any number of edges and redirectors until they hit an obstacle or leave an unmarked edge.
- **Purple chevrons with a dot** redirect the leading tip, then flip 180 degrees on each pass, including straight-through passes and repeat visits. Successful exits keep the flips; a collision unwinds them as the line rolls back. Their current directions are saved with the board.
- New boards mix ordinary paths with long winding arrows of **3–75 cells**. Random turns, mixed directions, and edge crossings create dependency chains, so most arrows need another path cleared first. Small gaps are allowed.
- Bold strokes and larger arrowheads improve visibility. The roomier grid and longer paths reduce the number of separate arrows to track.
- A chosen endpoint is removable only when its complete routed exit is clear, including other faces. Its tail follows the same bends, redirectors, and creases. Hints choose an available endpoint; keyboard Enter uses that same direction.
- The cube is translucent: near-face paths are black and far-face paths show through as pale silhouettes. Rotate to interact with a far face.
- A line's first blocked attempt keeps its original color until contact, turns red with only a short tick, and quickly slides back along its route. It stays red afterward, including after reloading. Successful exits play a swoosh. Hints temporarily highlight the selected endpoint in purple; restarting or choosing a new board clears red marks. A collision does not remove any arrows or increment the move count. There is no move limit or failure timer.
- Clear all arrows to unlock the next level. At dimension 64, completing a board offers another newly generated 64 × 64 puzzle.

## Controls

| Input | Action |
| --- | --- |
| Drag with mouse or one finger | Smoothly rotate the cube |
| Mouse wheel or two-finger pinch | Zoom |
| Click or tap a path | Release it if its exit is clear |
| Tap either half of a green/yellow path | Choose the corresponding endpoint as the leading head |
| Hint | Rotate to and highlight a removable arrow |
| Theme colors | Edit game colors; changes are saved |
| Sound | Toggle the swoosh and other synthesized sounds |
| Arrow motion | Follow device settings, use full animations, or reduce movement |
| Arrow keys while the cube is focused | Rotate |
| H, then Enter while the cube is focused | Highlight, then release, a legal arrow |

Arrow motion defaults to **Full animation**, with swoosh, collision, and rollback movement. Choose **Follow device** to use the device's reduced-motion preference, or choose **Reduced motion** directly. Explicit choices are saved with your progress. Opening `http://riva-laptop:5173/?motion=full` also selects and remembers full animation without replacing your board.

## Why generated boards are solvable

Version 11 builds the magenta slide edges and blue redirectors first. `src/feature-generator.js` then maintains a visibility frontier over the real flow field: a head can be selected only when its entire route through all redirects and creases is already empty and reaches an unmarked edge. Its tail grows only through still-occupied cells. The resulting carve order is a certified removal sequence. Closed flow loops are detected and never selected as exits.

A bounded search grows winding tails. Short pieces and later paths can join earlier tails up to the 75-cell limit; sub-three-cell leftovers become gaps. Heads that exercise a routing feature are retained. Version 12 removes every redirector that does not actually turn a line during the certified forward solution, preserving those escape routes. It then selects green/yellow paths against the final marker layout, from lines whose reverse endpoint can also eventually escape without hitting their own moving body. The generator reserves a useful approach to a redirector and has a deterministic routing layout for difficult seeds, ensuring every new puzzle contains and actually uses all three mechanics.

Version 13 adds one or two useful purple redirectors. `src/flipping-generator.js` certifies a common removal order across every combination of their orientations, accounting for flips during a move. At each step, every orientation must offer a usable endpoint once earlier lines are gone. Therefore the earliest remaining line in that order can always escape after arbitrary legal choices, regardless of which markers flipped. A concrete replay additionally proves that every marker turns a line and a magenta slide edge is used.

`src/routing.js` traces the same route for game rules, collision feedback, hints, and animation. Route previews simulate flips without changing the board; loop detection includes marker state, and cached routes are invalidated when directions change. The seed recreates the features and geometry exactly; `solutionMoves` records endpoint choices alongside the legacy `solution` ID list.

Tests cover chained redirects and magenta slide edges, either-end selection across faces, collision/rollback animation, full solution replays and arbitrary endpoint orders, useful placement of every redirector, geometry and density through dimension 64, deterministic seeds, and storage restoration. Existing generator versions 1–12 retain their exact seed mappings.

## Saved progress

The current dimension, puzzle seed, generator version, removed arrows, red crash marks, purple marker orientations, move count, sound preference, and highest dimension are saved in this browser's `localStorage` after moves, impacts, and setting changes. Reloading resumes that board. Older saved puzzles retain their original generator and exact progress; new puzzles use the random, minimum-three-cell generator. Choose a starting difficulty to get a fresh board at any size. Progress is specific to the browser profile and site origin; clearing site data removes it. If browser storage is unavailable, the game still runs and reports that saving is unavailable.

## Install and play offline

Run the installable local build with:

```sh
pnpm app
```

On the laptop hosting the game, open **http://localhost:4173/** in Chrome or Edge. This runs entirely on your machine. The existing development server at port 5173 can keep running separately. The production build includes the manifest, app icons, and offline worker. A single-line Get the app promotion is visible on the main screen from the first load. It uses text and an Install or Install help button, without an icon or visible subtitle; the details remain available as a tooltip and assistive description. Its Install button appears once the browser makes a prompt available; otherwise Install help opens the existing installation guide. It disappears after confirmed installation and in standalone app windows. Settings retains the same install controls.

Installation requires **HTTPS** or a loopback address such as `localhost`. The HTTP LAN address `http://riva-laptop:5173/` can play the game, but cannot offer the normal PWA installation flow. On another device, use a trusted HTTPS connection to this local server; `localhost` on a phone refers to the phone itself. An embedded preview may not support installation, so open the game in the device's full browser. Installation remains controlled by the browser.

For an Android phone connected over authorized USB debugging, forward the local app port:

```sh
adb reverse tcp:4173 tcp:4173
```

Then open **http://localhost:4173/** in Chrome on the phone. This routes only that phone port to the laptop over USB. Keep the cable connected for the initial load, installation, and updates. Once the offline setup is ready, cached gameplay can run without the connection. Reapply the forwarding command after reconnecting if needed.

The offline worker is enabled only in production builds. Saved progress is separate for each address and port, so opening the production address starts a separate save from the development address.

Open the production game online once and allow its service worker to install before going offline. It precaches the app shell and bundled assets, so gameplay and local saves can continue without a connection. Updates use the normal service-worker lifecycle and take over after the previous app is closed; they do not force a reload during a puzzle.

## Help and recharge indicators

Help pairs the game symbols with short instructions based on ASD-STE100 writing principles: one action per instruction, active voice, and consistent game terms. The guide covers two-ended arrows, blue fixed turn markers, purple reversing turn markers, magenta slide edges, crashes, resets, and far-side arrows. Game terms such as arrowhead, turn marker, reset, tap, and drag refer to the controls and objects shown in the game.

The next empty reset icon fills from bottom to top as its three-hour recharge interval passes. Other empty reset icons stay unfilled. Hover over the reset tokens for the remaining time, or open the refill screen to see its clock. The recharge value is also available through a native progress element for assistive technology.

On touch screens, twist two fingers to rotate the cube in the screen plane. This works together with pinch-to-zoom. Lifting or canceling a finger does not release an arrow or change the current zoom unexpectedly.

Two-ended arrows keep solid green and yellow across the outer 45% of each end, with a short color transition in the center 10%. The same color range applies to static arrows, movement animations, and the Help symbol. Slide edges currently use magenta, with the existing background fade and arrow-over-edge draw order.

The color wheel is provided by [iro.js](https://iro.js.org/), bundled locally under MPL-2.0. Its license is included in `public/licenses/iro.js-LICENSE.txt`; no library source modifications are made.

The app icon uses a close-up of the three-face cube corner with large arrow paths. The artwork is stored in `assets/app-icon/source-corner.png`; run `python scripts/build-icons.py` to export the PNG sizes, full-bleed maskable icon, and favicon. Icon filenames change with this artwork so browsers can fetch the new images.

Completing a level opens a You win! screen with the cleared level and arrow count, a trophy, full-screen confetti, and a short synthesized trumpet fanfare. Next level advances to the next puzzle; at level 64, Play again starts a fresh puzzle at the maximum size. Restoring a completed save does not replay the celebration. Sound follows the audio setting; confetti respects reduced motion and stops when the win screen closes.
