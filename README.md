# SCTMG Data Disc

> *"We've got the disc. Let's get out of here."*

A mobile-friendly field kit for **StarCraft: Tabletop Miniatures Game** — build crews, run setup, track games, and look up cards, all from a single page that works on your phone at the table.

**Live site:** https://sctmgdatadisc.com/ (mirror: https://zariaskobold.github.io/sctmg-data-disc/)

---

## Features

- **Crew builder** — track minerals, vespene, and supply across Core, Elite, Support, Air, and Hero slots.
- **Game setup** — priority, plus mission and deployment drafting.
- **Live play tracker** — rounds, phases, Supply Pool, victory points, and card exhaust/ready states.
- **Card reference** — searchable unit and faction cards for Terran, Zerg, and Protoss.
- **Glossary** — a searchable list of game terms in plain English, and every keyword on a card is tappable to show what it means.
- **Current costs** — includes the October 9, 2026 cost-table update.

## Data notes

Card data comes from the official rulebooks and card sheets, including Wave 2 (Siege Tank, Ravager, Immortal, Zeratul, Nerazim and friends) and Wave 3 (Nova Covert Ops, Zagara's Swarm and the Templar Caste). Thanks to the community [Co-op Command / Command Center](https://github.com/phyersherman/sc-tmg-coop-tabletop) dataset, which filled the gap before the official Wave 2 sheets were out.

If a future cost table lists units whose cards aren't out yet, they show a **No card text** tag and stay cost-only stubs until the full cards are available.

## API

The card data is also available as a free, read-only JSON API at
`https://sctmgdatadisc.com/api/v1/`. It covers units,
faction and tactical cards, missions, deployments and scales, needs no key,
and works cross-origin. See [API.md](API.md) for endpoints and record shapes.
Please keep it non-commercial and keep the `meta.legal` notice visible.

If you spot an error, please [open an issue](../../issues).

## Usage

No install, no build step. Open the site in any modern browser. To run it offline, download `index.html` and open it locally.

Saved crews are stored in your browser's local storage, so they stay on the device and browser where you made them. Clearing your site data will erase them.

## Disclaimer

This is an **unofficial, free, fan-made tool**. It is not affiliated with, endorsed by, or sponsored by Blizzard Entertainment or Archon Studio.

StarCraft® is a trademark or registered trademark of Blizzard Entertainment, Inc. in the U.S. and/or other countries. StarCraft: Tabletop Miniatures Game is produced by Archon Studio (Archon Sp. z o.o.) under license from Blizzard. All game names, card text, and related content belong to their respective owners and are used here for non-commercial reference purposes only.

Please support the official game.

---

Built by [Draconic Designs](https://draconicdesigns.com).
