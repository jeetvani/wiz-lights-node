# wiz-lights-node

Minimal Node.js app to **discover Philips Wiz lights** over UDP and **set their color** from a simple hex picker UI.

## Requirements

- Node.js 18+
- Same Wi‑Fi as your Wiz lights

## Setup

```bash
cd wiz-lights-node
npm install
npm start
```

Open **http://localhost:3000**

## CLI

```bash
# Find lights on your network
npm run discover

# Set color directly
node src/cli.js color 192.168.1.111 #ff0044
```

## API

| Method | Path | Body |
|--------|------|------|
| GET | `/api/discover` | — |
| POST | `/api/color` | `{ "ip": "192.168.1.111", "hex": "#ff0044", "brightness": 100 }` |

## How it works

Wiz bulbs listen on **UDP port 38899**. Discovery sends `getPilot` to each subnet broadcast address (important on macOS). Color changes use `setPilot` with `r`, `g`, `b`, and `dimming`.

## Push to GitHub

```bash
git init
git add .
git commit -m "Initial Wiz lights Node.js controller"
gh repo create wiz-lights-node --public --source=. --push
```
