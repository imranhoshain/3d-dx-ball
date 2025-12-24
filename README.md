# Dex Ball

Dex Ball is a glassmorphism breakout-style game with a realtime scoreboard powered by Socket.IO.

## Features
- Glassy arena UI with responsive layout
- Realtime score board updates
- Player join flow with optional phone capture
- CSV logging with duplicate protection

## Requirements
- Node.js 18+ recommended

## Setup
1. Install dependencies:
   - `npm install`
2. Copy env template:
   - `cp .env.example .env`

## Run
- `npm run dev`
- Open `http://localhost:3000`

## Environment variables
- `PORT`: Server port (default 3000)
- `CLIENT_ORIGIN`: Comma-separated allowed origins for Socket.IO (optional)
- `CLIENT_ORIGIN_REGEX`: Regex for allowed origins (optional)
- `ALLOW_ALL_ORIGINS`: Set to `1` to accept any origin (use with care)
- `TRUST_PROXY`: Set to `1` when running behind a proxy/load balancer

## Data
- Player joins are stored in `data/players.csv`.
- Names are sanitized and capped to 18 chars; phone is optional and normalized.
- Existing names/phones are not duplicated in the CSV.
