# CODE WITH SONU

A real-time collaborative code workspace that brings a familiar editor, shared rooms, and lightweight team review into the browser. Built with React, TypeScript, Monaco Editor, Yjs, and a WebSocket sync server.

## Features

- **Live collaborative editing:** Multiple people can edit the same room at once. Yjs merges concurrent changes, while live presence shows who is in the room.
- **Shareable rooms:** Each room has a URL you can share. Open it in another browser or device to collaborate.
- **Monaco editor:** Syntax highlighting, line numbers, bracket pair coloring, indentation guides, word wrap, and document-formatting action.
- **File workspace:** Browse files, create files, switch between editor tabs, and download the current file.
- **Comments:** Add room-shared notes tied to the current file and editor line, then jump back to the referenced location.
- **Version snapshots:** Save shared snapshots of the current file and restore a saved version when needed.
- **Automatic local saving:** Room updates are cached in the browser and room documents are persisted by the sync server.
- **Connection feedback:** See sync status, local save state, active collaborators, and reconnect behavior.
- **Personal workspace settings:** Choose a display name and switch between dark and light themes.
- **Responsive layout:** Explorer, editor, activity rail, and discussion/history panels adapt to smaller screens.

## Tech Stack

- React 19 and TypeScript
- Vite 8
- Monaco Editor
- Yjs and y-protocols for shared documents and presence
- Node.js and `ws` for the WebSocket relay and room persistence
- Lucide icons

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run Locally

```bash
npm install
npm run dev
```

Open     https://sonuk7254062054-lgtm.github.io/code-with-sonu/?room=A43324C7        The `dev` script starts both Vite and the collaboration server. Vite serves the interface on port `5173`; the WebSocket sync server listens on port `1234`.

To try collaboration, open the same room URL in another browser window or device. Room IDs are carried in the `room` query parameter; visiting without one creates a room automatically.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the web app and collaboration server together |
| `npm run build` | Type-check the app and create a production frontend build in `dist/` |
| `npm run preview` | Preview the built frontend locally |
| `npm run lint` | Run Oxlint |

## Live Demo

The GitHub Pages demo is published at <https://sonuk7254062054-lgtm.github.io/code-with-sonu/>. It runs in browser-only mode with starter files and local browser saving. GitHub Pages cannot run the Node.js WebSocket service, so edits, presence, comments, and snapshots are not shared between visitors in this demo.

The Pages site is built and deployed from `main` by `.github/workflows/deploy-pages.yml`. To enable it in the repository, open **Settings > Pages** and select **GitHub Actions** as the build and deployment source.

For full real-time collaboration, deploy the frontend and `server.mjs` to a WebSocket-capable host, then set the frontend build variable `VITE_SYNC_URL` to the secure WebSocket URL (`wss://...`) of that server.

## Data and Room Storage

- The sync server stores room documents as binary Yjs updates in `.workspaces/` at the project root. This directory is intentionally ignored by Git.
- The browser keeps a local room cache and stores the display name and theme preference in `localStorage`.
- Room IDs and document data are not managed by a hosted database in this project.
- In the GitHub Pages demo, room data is local to each browser and does not sync to the collaboration server.

## Security Notes

This is a prototype, not a hardened public collaboration service. Room access is based on a shareable room ID; there is no sign-in, authorization, or room-level access control. The development servers bind to `0.0.0.0`, so they may be reachable by other devices on your network. Do not expose the sync server to the public internet or use it for sensitive code without adding authentication, authorization, transport security, input/resource limits, and operational monitoring.

## Project Structure

```text
src/
	main.tsx          React application entry point
	Workspace.tsx     Editor, collaboration, comments, and history
	Workspace.css     Workspace layout and themes
server.mjs          WebSocket collaboration and room persistence
```
