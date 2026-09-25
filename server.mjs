import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'

const port = Number(process.env.SYNC_PORT ?? 1234)
const dataDirectory = join(process.cwd(), '.workspaces')
const rooms = new Map()
const roomLoads = new Map()

const starterFiles = {
  'src/App.tsx': `import { useState } from 'react'\n\nexport default function App() {\n  const [count, setCount] = useState(0)\n\n  return (\n    <main className="app-shell">\n      <h1>Build something together.</h1>\n      <p>Changes appear for everyone in this workspace.</p>\n      <button onClick={() => setCount((value) => value + 1)}>\n        Clicked {count} times\n      </button>\n    </main>\n  )\n}\n`,
  'src/styles.css': `:root {\n  font-family: 'Space Grotesk', sans-serif;\n  color: #e5eee9;\n  background: #111815;\n}\n\n.app-shell {\n  max-width: 48rem;\n  margin: 12vh auto;\n  padding: 2rem;\n}\n\nbutton {\n  padding: 0.7rem 1rem;\n  border: 0;\n  border-radius: 6px;\n  background: #96e0b5;\n  color: #14251a;\n  cursor: pointer;\n}\n`,
  'README.md': `# Orbit storefront\n\nA shared code workspace. Open this room link in another browser to collaborate.\n\n- Edits synchronize in real time.\n- Room documents are stored in the local \\.workspaces folder.\n- Comments and revision snapshots are shared with the room.\n`,
  'package.json': `{"name":"orbit-storefront","private":true,"scripts":{"dev":"vite","build":"vite build"}}\n`,
}

await mkdir(dataDirectory, { recursive: true })

async function getRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId)
  if (roomLoads.has(roomId)) return roomLoads.get(roomId)

  const loading = loadRoom(roomId)
  roomLoads.set(roomId, loading)
  try {
    return await loading
  } finally {
    roomLoads.delete(roomId)
  }
}

async function loadRoom(roomId) {
  const doc = new Y.Doc()
  const filePath = join(dataDirectory, `${roomId}.bin`)
  try {
    Y.applyUpdate(doc, new Uint8Array(await readFile(filePath)))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const files = doc.getMap('files')
    for (const [name, content] of Object.entries(starterFiles)) {
      const text = new Y.Text()
      text.insert(0, content)
      files.set(name, text)
    }
  }

  const room = { doc, awareness: new Awareness(doc), clients: new Set(), filePath, persist: Promise.resolve() }
  doc.on('update', (update, origin) => {
    room.persist = room.persist
      .then(() => writeFile(filePath, Y.encodeStateAsUpdate(doc)))
      .catch((error) => console.error(`Could not persist room ${roomId}:`, error))
    const message = JSON.stringify({ type: 'update', update: Array.from(update) })
    for (const client of room.clients) {
      if (client !== origin && client.readyState === WebSocket.OPEN) client.send(message)
    }
  })
  room.awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = [...added, ...updated, ...removed]
    if (!changed.length) return
    const message = JSON.stringify({ type: 'awareness', update: Array.from(encodeAwarenessUpdate(room.awareness, changed)) })
    for (const client of room.clients) {
      if (client !== origin && client.readyState === WebSocket.OPEN) client.send(message)
    }
  })
  rooms.set(roomId, room)
  if (!await fileExists(filePath)) await writeFile(filePath, Y.encodeStateAsUpdate(doc))
  return room
}

async function fileExists(filePath) {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ service: 'fieldnote-sync', rooms: rooms.size }))
})
const webSocketServer = new WebSocketServer({ server })

webSocketServer.on('connection', (socket) => {
  let room
  const awarenessClients = new Set()
  socket.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString())
      if (message.type === 'join') {
        const roomId = String(message.room ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
        if (!roomId) return socket.close(1008, 'Invalid room id')
        room = await getRoom(roomId)
        room.clients.add(socket)
        socket.send(JSON.stringify({ type: 'update', update: Array.from(Y.encodeStateAsUpdate(room.doc)) }))
        const clients = Array.from(room.awareness.getStates().keys())
        if (clients.length) socket.send(JSON.stringify({ type: 'awareness', update: Array.from(encodeAwarenessUpdate(room.awareness, clients)) }))
        return
      }
      if (!room || !Array.isArray(message.update)) return
      const update = new Uint8Array(message.update)
      if (message.type === 'update') Y.applyUpdate(room.doc, update, socket)
      if (message.type === 'awareness') {
        if (Number.isInteger(message.clientId)) awarenessClients.add(message.clientId)
        applyAwarenessUpdate(room.awareness, update, socket)
      }
    } catch (error) {
      console.error('Invalid collaboration message:', error)
    }
  })
  socket.on('close', () => {
    if (!room) return
    room.clients.delete(socket)
    removeAwarenessStates(room.awareness, Array.from(awarenessClients), socket)
  })
})

server.listen(port, '0.0.0.0', () => console.log(`Fieldnote sync listening on :${port}`))