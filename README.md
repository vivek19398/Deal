# Dealz — around the table

A private, offline-capable Monopoly Deal game for 2–5 browsers on one Wi-Fi network. Original card designs, server-authoritative rules, private hands, QR invites and local game recovery. Vercel and Supabase are not required for this version.

## Host a game

With Node.js 22+ installed, open a terminal in this folder and run:

```sh
./start.sh
```

The first run installs dependencies and requires internet; subsequent play is fully local. The launcher builds and starts the app, prints your Wi-Fi address and a QR code. Open `http://localhost:3000` on the host. Other players scan the displayed QR code or open the printed Wi-Fi address (for example `http://192.168.1.10:3000`). Create a table and share its six-character code, or share the QR code inside the lobby to join that table directly. Every player selects **I'm ready**, then the host deals. The order in the lobby is the turn order; **Sit here** swaps seats.

Keep this terminal and laptop running. Prevent sleep while playing. Stop with Ctrl+C. `PORT=3001 ./start.sh` chooses another port. Use a modern Safari, Chrome, Edge or Firefox browser; no app installation or account is needed.

## Wi-Fi troubleshooting

- Allow Node's incoming connections if macOS/Windows Firewall asks. The server listens on `0.0.0.0`.
- Everyone must be on the same network. Guest Wi-Fi often blocks device-to-device traffic (AP/client isolation); use a normal private network or disable isolation on your router.
- VPNs can interfere or advertise another interface. If the first QR address does not work, use another printed Wi-Fi address. Stop the VPN if needed.
- `localhost` only works on the host laptop. Phones must use the laptop's network IP.
- If the network changes, restart the server and share its new IP. Existing room codes and games remain saved.
- This version uses local HTTP and is intended for a trusted private network. Do not port-forward it or expose it publicly.

## Reconnect and saves

Each browser stores a private seat token in local storage. Refreshing or reconnecting restores that seat automatically. Do not clear browser data during a game. Use separate browsers/profiles for multiple players on one device.

Accepted moves are saved atomically to `.data/ROOMCODE.json` with private cards and seat tokens. Keep that directory private; do not commit or share it. Restarting restores rooms with players disconnected and games paused. Rejoin using the same browsers, then the owner selects **Resume game**. A required player disconnecting pauses play; there is no automatic turn timer. The owner can end a stalled game. After a game, **Play again** returns to the lobby for readiness and seating.

## Development and checks

```sh
npm install
npm run dev       # one Node server + Vite, http://localhost:3000
npm run check     # strict TypeScript
npm test          # rules, privacy, persistence and multiplayer tests
npm run build
npm start         # production build must exist
```

pnpm also works. `./start.sh` automatically locates the Node runtime bundled with Codex desktop when available.

`shared/` contains deck definitions, command/state types, and pure rules transitions. `server/` owns sockets, identity, cryptographic shuffling and disk storage. `src/` renders personalized game state. Commands carry IDs and state versions; repeated IDs are ignored and stale state versions rejected. Socket.IO transports personalized state, never the raw stored game. The host process handles commands sequentially and persists before publishing a state update.

See [RULES.md](RULES.md) for full behavior and explicit rule interpretations. No commercial card scans, fonts, remote scripts or online services are loaded during play.

## Manual acceptance

1. Start the host, open two different browsers, create/join a room, choose seats and mark ready.
2. Deal; confirm only your own hand is visible. Play banking/property/action cards and finish a full game.
3. Join from an actual phone on the same Wi-Fi, scan the room QR code and verify touch layouts.
4. Disconnect the current player, reconnect, then have the owner resume.
5. Stop/restart the host and restore both browser seats. Confirm the same cards, turn, pending prompts and bank values return.
6. Finish a game and use **Play again** for a fresh deal.

The automated suite cannot confirm your router's isolation/firewall settings; actual second-device Wi-Fi testing is required on your network.

## Bihar edition and dragging

Property cards use Bihar place names, including Manopali, Mahaura, Bhagalpur and Jagdeo Path. Utilities are PWC Department and Bijli Department; railroads are local junctions. All game values are INR crore units: the smallest money card is **₹1 cr**. No real-money transactions are involved.

Starting a game shows a shuffle-and-deal animation on every connected screen. At each seat, the hand is in front/left and the public property groups and bank are on the right. You see your own card faces; opponents see only card backs and a count.

Drag with a mouse or finger: money/actions into your bank; property cards onto a matching group or **New property set**; rent/buildings onto an eligible own group; targeted actions onto an opponent or a specific property. Actions that need extra choices open their normal prompt. You can still tap/click cards for every action. Dragging never bypasses the server's colour, ownership, capacity, turn, payment or action rules. Red-on-yellow and adding cards to someone else's table are rejected without spending the card or a play.

Saved rooms retain their card IDs, seats, tokens and amounts when upgrading; old card labels are converted to the Bihar theme on server restart. Reconnect and resume an existing game, or use a rematch to see the shuffle animation.

## Table chat and atmosphere

Use **Table chat** at the bottom right in the lobby or during play. Chat is shared only with seated members of that room. Press Enter to send (Shift+Enter for a new line), or use the Bihar-style quick messages. A badge counts unread messages while the panel is closed. Messages allow up to 280 characters; the host keeps the latest 100 in the room save, including across reconnects and rematches. Sender names come from the authenticated seat. Five messages per five seconds per player are allowed, and retrying after a timeout does not duplicate a delivered message. Chat uses a separate stream so it never spends a play or makes game state versions stale.

The table now has a felt surface, layered card edges, a face-up discard pile and clearer active-player markers. Use **Sound off / Sound on** in the header for short, locally generated card sounds. Sound starts off and requires your click to enable; there are no audio downloads, microphone access or voice calls.

## Online deployment

For Vercel + Supabase without chat, follow [the deployment guide](docs/ONLINE_DEPLOYMENT.md). Run migration 002 after the initial SQL setup, enable anonymous sign-ins and configure the four environment variables. Online and local builds are separate.
