import { lazy, startTransition, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { OnMount } from '@monaco-editor/react'
import type { MonacoBinding as MonacoBindingType } from 'y-monaco'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  FileCode2,
  FilePlus2,
  Folder,
  GitBranch,
  History,
  Link2,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Send,
  Sun,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import './Workspace.css'

const Editor = lazy(() => import('@monaco-editor/react'))

type EditorApi = Parameters<OnMount>[0]
type CommentItem = { id: string; text: string; author: string; time: string; fileName: string; line: number }
type Revision = { id: string; label: string; author: string; time: string; fileName: string; content: string }
type Person = { name: string; color: string; activeFile?: string }

const starterFiles: Record<string, string> = {
  'src/App.tsx': `import { useState } from 'react'\n\nexport default function App() {\n  const [count, setCount] = useState(0)\n\n  return (\n    <main className="app-shell">\n      <h1>Build something together.</h1>\n      <p>Changes appear for everyone in this workspace.</p>\n      <button onClick={() => setCount((value) => value + 1)}>\n        Clicked {count} times\n      </button>\n    </main>\n  )\n}\n`,
  'src/styles.css': `:root {\n  font-family: 'Space Grotesk', sans-serif;\n  color: #e5eee9;\n  background: #111815;\n}\n\n.app-shell {\n  max-width: 48rem;\n  margin: 12vh auto;\n  padding: 2rem;\n}\n\nbutton {\n  padding: 0.7rem 1rem;\n  border: 0;\n  border-radius: 6px;\n  background: #96e0b5;\n  color: #14251a;\n  cursor: pointer;\n}\n`,
  'README.md': `# Orbit storefront\n\nA shared code workspace. Open this room link in another browser to collaborate.\n\n- Edits synchronize in real time.\n- Room documents are stored in the local \\.workspaces folder.\n- Comments and revision snapshots are shared with the room.\n`,
  'package.json': `{"name":"orbit-storefront","private":true,"scripts":{"dev":"vite","build":"vite build"}}\n`,
}

function languageFor(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  const languages: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    css: 'css', scss: 'scss', html: 'html', json: 'json', md: 'markdown',
    py: 'python', go: 'go', rs: 'rust', yml: 'yaml', yaml: 'yaml',
  }
  return languages[extension ?? ''] ?? 'plaintext'
}

function fileIcon(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  const tone = extension === 'css' ? 'file-icon--violet' : extension === 'md' ? 'file-icon--gold' : 'file-icon--blue'
  return <FileCode2 size={14} className={tone} />
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function App() {
  const [roomId] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedRoom = params.get('room')?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
    const room = requestedRoom || crypto.randomUUID().slice(0, 8).toUpperCase()
    if (params.get('room') !== room) {
      params.set('room', room)
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
    }
    return room
  })
  const [doc, setDoc] = useState<Y.Doc | null>(null)
  const [awareness, setAwareness] = useState<Awareness | null>(null)
  const [presenceVersion, setPresenceVersion] = useState(0)
  const [files, setFiles] = useState<string[]>(Object.keys(starterFiles))
  const [activeFile, setActiveFile] = useState('src/App.tsx')
  const [openTabs, setOpenTabs] = useState(['src/App.tsx', 'src/styles.css', 'README.md'])
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [saved, setSaved] = useState(true)
  const [darkTheme, setDarkTheme] = useState(() => localStorage.getItem('fieldnote:theme') !== 'light')
  const [panel, setPanel] = useState<'comments' | 'history'>('comments')
  const [commentText, setCommentText] = useState('')
  const [comments, setComments] = useState<CommentItem[]>([])
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [inspectorVisible, setInspectorVisible] = useState(true)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const [currentLine, setCurrentLine] = useState(1)
  const editorRef = useRef<EditorApi | null>(null)
  const bindingRef = useRef<MonacoBindingType | null>(null)
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const roomStorageKey = `fieldnote:${roomId}`
  const codeText = doc?.getMap<Y.Text>('files').get(activeFile) ?? null
  const presence = awareness ? Array.from(awareness.getStates().values()).map((state) => state.user as Person | undefined).filter((user): user is Person => Boolean(user?.name)) : []
  const memberCount = presence.length
  const [localName, setLocalName] = useState(() => {
    const storedName = localStorage.getItem('fieldnote:name')
    if (storedName) return storedName
    const nameOptions = ['Avery Chen', 'Mina Park', 'Jonah Reed', 'Kai Morgan']
    const generatedName = nameOptions[Math.floor(Math.random() * nameOptions.length)]
    localStorage.setItem('fieldnote:name', generatedName)
    return generatedName
  })

  useEffect(() => {
    const sharedDoc = new Y.Doc()
    const sharedAwareness = new Awareness(sharedDoc)
    const fileMap = sharedDoc.getMap<Y.Text>('files')
    const commentArray = sharedDoc.getArray<CommentItem>('comments')
    const revisionArray = sharedDoc.getArray<Revision>('revisions')
    try {
      const localUpdate = localStorage.getItem(roomStorageKey)
      if (localUpdate) Y.applyUpdate(sharedDoc, new Uint8Array(JSON.parse(localUpdate) as number[]))
    } catch {
      try { localStorage.removeItem(roomStorageKey) } catch {}
    }
    startTransition(() => {
      setDoc(sharedDoc)
      setAwareness(sharedAwareness)
      setComments(commentArray.toArray())
      setRevisions(revisionArray.toArray())
    })
    const refreshComments = () => setComments(commentArray.toArray())
    const refreshRevisions = () => setRevisions(revisionArray.toArray())
    commentArray.observe(refreshComments)
    revisionArray.observe(refreshRevisions)

    const peerName = localStorage.getItem('fieldnote:name') || 'Avery Chen'
    sharedAwareness.setLocalStateField('user', { name: peerName, color: '#e99b75', activeFile: 'src/App.tsx' })
    const onAwarenessUpdate = () => setPresenceVersion((version) => version + 1)
    sharedAwareness.on('update', onAwarenessUpdate)
    sharedDoc.on('update', (update, origin) => {
      try {
        localStorage.setItem(roomStorageKey, JSON.stringify(Array.from(Y.encodeStateAsUpdate(sharedDoc))))
        setSaved(false)
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => setSaved(true), 650)
      } catch {
        setSaved(true)
      }
      if (socketRef.current?.readyState === WebSocket.OPEN && origin !== socketRef.current) {
        socketRef.current.send(JSON.stringify({ type: 'update', update: Array.from(update) }))
      }
      setFiles(Array.from(fileMap.keys()))
    })
    sharedAwareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed]
      if (origin !== socketRef.current && socketRef.current?.readyState === WebSocket.OPEN && changed.length) {
        socketRef.current.send(JSON.stringify({ type: 'awareness', clientId: sharedDoc.clientID, update: Array.from(encodeAwarenessUpdate(sharedAwareness, changed)) }))
      }
    })

    let disposed = false
    let retryTimer: number | undefined
    function connect() {
      let synchronized = false
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${window.location.hostname}:1234`)
      socketRef.current = socket
      socket.onopen = () => {
        if (disposed) return socket.close()
        setConnection('online')
        socket.send(JSON.stringify({ type: 'join', room: roomId }))
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; update?: number[] }
        if (message.type === 'update' && message.update) {
          Y.applyUpdate(sharedDoc, new Uint8Array(message.update), socket)
          if (!synchronized) {
            synchronized = true
            socket.send(JSON.stringify({ type: 'update', update: Array.from(Y.encodeStateAsUpdate(sharedDoc)) }))
            const clients = Array.from(sharedAwareness.getStates().keys())
            if (clients.length) socket.send(JSON.stringify({ type: 'awareness', clientId: sharedDoc.clientID, update: Array.from(encodeAwarenessUpdate(sharedAwareness, clients)) }))
          }
        }
        if (message.type === 'awareness' && message.update) applyAwarenessUpdate(sharedAwareness, new Uint8Array(message.update), socket)
      }
      socket.onclose = () => {
        if (socketRef.current !== socket) return
        socketRef.current = null
        setConnection('offline')
        if (!disposed) retryTimer = window.setTimeout(connect, 1800)
      }
      socket.onerror = () => socket.close()
    }
    connect()

    return () => {
      window.clearTimeout(saveTimer.current)
      disposed = true
      window.clearTimeout(retryTimer)
      socketRef.current?.close()
      socketRef.current = null
      bindingRef.current?.destroy()
      commentArray.unobserve(refreshComments)
      revisionArray.unobserve(refreshRevisions)
      sharedAwareness.off('update', onAwarenessUpdate)
      sharedAwareness.destroy()
      sharedDoc.destroy()
    }
  }, [roomId, roomStorageKey])

  useEffect(() => {
    if (!awareness) return
    awareness.setLocalStateField('user', { name: localName, color: '#e99b75', activeFile })
  }, [awareness, activeFile, localName])

  useEffect(() => {
    if (!editorReady || !editorRef.current || !doc || !awareness || !codeText) return
    let cancelled = false
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return
    void import('y-monaco').then(({ MonacoBinding }) => {
      if (cancelled) return
      bindingRef.current?.destroy()
      bindingRef.current = new MonacoBinding(codeText, model, new Set([editor]), awareness)
    })
    return () => {
      cancelled = true
      bindingRef.current?.destroy()
      bindingRef.current = null
    }
  }, [editorReady, doc, awareness, codeText])

  useEffect(() => () => cursorListenerRef.current?.dispose(), [])

  function onEditorMount(editor: EditorApi, monaco: Parameters<OnMount>[1]) {
    editorRef.current = editor
    cursorListenerRef.current?.dispose()
    cursorListenerRef.current = editor.onDidChangeCursorPosition((event) => setCurrentLine(event.position.lineNumber))
    setEditorReady(true)
    editor.updateOptions({ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, lineHeight: 23 })
    monaco.editor.defineTheme('fieldnote-dark', {
      base: 'vs-dark', inherit: true, rules: [],
      colors: { 'editor.background': '#141b18', 'editorLineNumber.foreground': '#65736b', 'editorLineNumber.activeForeground': '#d5e4da', 'editorCursor.foreground': '#a3e3ba', 'editor.selectionBackground': '#44695877', 'editor.lineHighlightBackground': '#19221e' },
    })
    monaco.editor.defineTheme('fieldnote-light', {
      base: 'vs', inherit: true, rules: [],
      colors: { 'editor.background': '#f4f7f4', 'editorLineNumber.foreground': '#97a39b', 'editorLineNumber.activeForeground': '#34503f', 'editorCursor.foreground': '#287c50', 'editor.selectionBackground': '#b7ddc377', 'editor.lineHighlightBackground': '#edf3ee' },
    })
    monaco.editor.setTheme(darkTheme ? 'fieldnote-dark' : 'fieldnote-light')
  }

  function openFile(fileName: string) {
    if (!doc) return
    const fileMap = doc.getMap<Y.Text>('files')
    if (!fileMap.has(fileName)) fileMap.set(fileName, new Y.Text())
    setFiles((current) => current.includes(fileName) ? current : [...current, fileName])
    setOpenTabs((current) => current.includes(fileName) ? current : [...current, fileName])
    setActiveFile(fileName)
  }

  function createFile() {
    const name = window.prompt('File path', 'src/new-file.ts')?.trim()
    if (!name || !doc) return
    const path = name.startsWith('src/') || name.includes('/') ? name : `src/${name}`
    openFile(path)
  }

  function closeTab(fileName: string) {
    const remaining = openTabs.filter((tab) => tab !== fileName)
    setOpenTabs(remaining)
    if (activeFile === fileName && remaining.length) setActiveFile(remaining[remaining.length - 1])
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function addComment() {
    if (!commentText.trim() || !doc) return
    const line = editorRef.current?.getPosition()?.lineNumber ?? 1
    doc.getArray<CommentItem>('comments').insert(0, [{ id: crypto.randomUUID(), text: commentText.trim(), author: localName, time: 'just now', fileName: activeFile, line }])
    setCommentText('')
  }

  function saveRevision() {
    if (!codeText || !doc) return
    const history = doc.getArray<Revision>('revisions')
    const revision: Revision = {
      id: crypto.randomUUID(), label: `Snapshot ${String(history.length + 1).padStart(2, '0')}`,
      author: localName, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), fileName: activeFile, content: codeText.toString(),
    }
    history.insert(0, [revision])
    setPanel('history')
    setInspectorVisible(true)
  }

  function restoreRevision(revision: Revision) {
    const revisionText = doc?.getMap<Y.Text>('files').get(revision.fileName)
    if (!revisionText || !doc) return
    doc.transact(() => {
      revisionText.delete(0, revisionText.length)
      revisionText.insert(0, revision.content)
    })
    openFile(revision.fileName)
  }

  function formatDocument() {
    void editorRef.current?.getAction('editor.action.formatDocument')?.run()
  }

  void presenceVersion

  return (
    <div className={`workbench ${darkTheme ? 'theme-dark' : 'theme-light'}`}>
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><Code2 size={17} strokeWidth={2.2} /></div><span className="brand-name">fieldnote</span><span className="brand-divider" /><span className="project-name">orbit-web</span><ChevronDown size={13} className="muted-icon" /></div>
        <div className="topbar-center"><span className="branch-pill"><GitBranch size={13} /> main</span><span className="topbar-separator" /><span className="workspace-state"><span className={`status-dot status-dot--${connection}`} />{connection === 'online' ? 'All changes synced' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting'}</span></div>
        <div className="topbar-actions">
          <div className="avatar-stack" aria-label={`${memberCount} collaborators online`}>{presence.slice(0, 3).map((person) => <span key={person.name} className="avatar" style={{ '--avatar-color': person.color } as CSSProperties} title={person.name}>{initials(person.name)}</span>)}<span className="presence-count">{memberCount}</span></div>
          <button className="button button--share" onClick={() => void copyLink()}><Link2 size={14} />{copied ? 'Copied' : 'Share'}</button>
          <button className="icon-button theme-toggle" onClick={() => setDarkTheme((theme) => { localStorage.setItem('fieldnote:theme', theme ? 'light' : 'dark'); return !theme })} title={darkTheme ? 'Switch to light theme' : 'Switch to dark theme'} aria-label="Toggle theme">{darkTheme ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="profile-button" title="Change display name" onClick={() => {
            const nextName = window.prompt('Your display name', localName)?.trim()
            if (nextName) {
              localStorage.setItem('fieldnote:name', nextName)
              setLocalName(nextName)
            }
          }}>{initials(localName)}</button>
        </div>
      </header>

      <div className="workspace-titlebar">
        <div className="workspace-title"><span className="title-eyebrow">WORKSPACE</span><span className="title-name">Orbit storefront</span></div>
        <div className="title-meta"><span><Users size={13} /> {memberCount} {memberCount === 1 ? 'member' : 'members'}</span><span className="meta-separator">/</span><span>Room {roomId}</span></div>
        <div className="title-controls"><button className="button button--quiet" onClick={saveRevision}><History size={14} /> Save version</button></div>
      </div>

      <main className={`workspace-body ${inspectorVisible ? '' : 'workspace-body--no-inspector'}`}>
        <aside className={`explorer ${explorerOpen ? '' : 'explorer--collapsed'}`}>
          {explorerOpen ? <>
            <div className="pane-heading"><span>EXPLORER</span><div className="pane-actions"><button className="mini-icon" title="New file" onClick={createFile}><FilePlus2 size={15} /></button><button className="mini-icon" title="Collapse explorer" onClick={() => setExplorerOpen(false)}><PanelLeftClose size={15} /></button></div></div>
            <div className="project-tree"><button className="tree-root"><ChevronDown size={13} /><Folder size={14} className="folder-icon" /> ORBIT-WEB</button><button className="tree-folder"><ChevronDown size={13} /><Folder size={14} className="folder-icon" /> src</button>
              {files.filter((file) => file.startsWith('src/')).map((file) => <button key={file} className={`tree-file ${activeFile === file ? 'tree-file--active' : ''}`} onClick={() => openFile(file)}>{fileIcon(file)}<span>{file.split('/').pop()}</span></button>)}
              {files.filter((file) => !file.startsWith('src/')).map((file) => <button key={file} className={`tree-file tree-file--root ${activeFile === file ? 'tree-file--active' : ''}`} onClick={() => openFile(file)}>{fileIcon(file)}<span>{file.split('/').pop()}</span></button>)}
            </div>
            <div className="explorer-bottom"><div className="pane-heading pane-heading--members"><span>LIVE IN THIS ROOM</span><span className="live-count">{memberCount}</span></div><div className="member-list">
              {presence.map((person) => <div className="member-row" key={person.name}><span className="avatar avatar--small" style={{ '--avatar-color': person.color } as CSSProperties}>{initials(person.name)}</span><span className="member-name">{person.name}{person.name === localName && <small>you</small>}</span><span className={`member-state ${person.activeFile ? 'member-state--active' : ''}`}>{person.activeFile ? 'editing' : 'online'}</span></div>)}
              {!memberCount && <div className="member-empty">Waiting for collaborators</div>}
            </div><div className="room-card"><div className="room-card-top"><span className="room-pulse" /><span>ROOM {roomId}</span><button title="Copy room link" onClick={() => void copyLink()}><Link2 size={13} /></button></div><p>Anyone with the link can join</p></div></div>
          </> : <button className="collapsed-open" title="Open explorer" onClick={() => setExplorerOpen(true)}><PanelLeftClose size={16} /></button>}
        </aside>

        <section className="editor-column">
          <div className="tab-strip"><div className="tabs-list">{openTabs.map((tab) => <button key={tab} className={`editor-tab ${activeFile === tab ? 'editor-tab--active' : ''}`} onClick={() => setActiveFile(tab)}>{fileIcon(tab)}<span>{tab.split('/').pop()}</span>{!saved && activeFile === tab && <Circle size={7} fill="currentColor" className="tab-unsaved" />}<span className="tab-close" role="button" title={`Close ${tab}`} onClick={(event) => { event.stopPropagation(); closeTab(tab) }}><X size={12} /></span></button>)}</div><div className="tab-tools"><button className="mini-icon" title="Add file" onClick={createFile}><Plus size={15} /></button><button className="mini-icon" title="Download current file" onClick={() => {
            const blob = new Blob([codeText?.toString() ?? ''], { type: 'text/plain' })
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = activeFile.split('/').pop() ?? 'file.txt'
            anchor.click()
            URL.revokeObjectURL(url)
          }}><ArrowDownToLine size={15} /></button></div></div>
          <div className="editor-toolbar"><div className="breadcrumbs"><span>orbit-web</span><ChevronRight size={12} /><span>{activeFile.split('/').slice(0, -1).join('/') || 'root'}</span><ChevronRight size={12} /><strong>{activeFile.split('/').pop()}</strong></div><div className="editor-actions"><span className="autosave"><span className="autosave-dot">{saved ? <Check size={10} /> : <Circle size={7} fill="currentColor" />}</span>{saved ? 'Saved' : 'Saving'}</span><span className="toolbar-divider" /><button className="mini-icon format-button" onClick={formatDocument} title="Format document"><span>{'{}'}</span></button><button className="mini-icon" onClick={() => setInspectorVisible((visible) => !visible)} title="Toggle side panel"><PanelRightClose size={15} /></button></div></div>
          <div className="editor-stage">{codeText && <Suspense fallback={<div className="editor-loading">Opening editor…</div>}><Editor key={activeFile} path={`file:///${activeFile}`} language={languageFor(activeFile)} theme={darkTheme ? 'fieldnote-dark' : 'fieldnote-light'} onMount={onEditorMount} options={{ automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 18, bottom: 24 }, renderLineHighlight: 'line', cursorBlinking: 'smooth', smoothScrolling: true, wordWrap: 'on', tabSize: 2, bracketPairColorization: { enabled: true }, guides: { indentation: true }, readOnly: false }} /></Suspense>}</div>
          <footer className="statusbar"><div className="status-left"><span className="status-branch"><GitBranch size={12} /> main</span><span>{connection === 'online' ? <Wifi size={12} /> : <WifiOff size={12} />}{connection === 'online' ? 'Live' : 'Offline'}</span><span className="status-save"><Check size={11} /> {saved ? 'Saved locally' : 'Autosaving'}</span></div><div className="status-right"><span>Ln {currentLine}, Col 1</span><span>UTF-8</span><span>{languageFor(activeFile).toUpperCase()}</span><span className="status-bell"><Circle size={12} /></span></div></footer>
        </section>

        <aside className="activity-rail"><button className={panel === 'comments' ? 'rail-button rail-button--active' : 'rail-button'} onClick={() => { setPanel('comments'); setInspectorVisible(true) }} title="Comments"><MessageSquare size={17} /><span className="rail-badge">{comments.length}</span></button><button className={panel === 'history' ? 'rail-button rail-button--active' : 'rail-button'} onClick={() => { setPanel('history'); setInspectorVisible(true) }} title="Version history"><History size={17} /></button><div className="rail-spacer" /><button className="rail-button" title="Connection status">{connection === 'online' ? <Wifi size={16} /> : <WifiOff size={16} />}</button></aside>

        {inspectorVisible && <aside className="inspector"><div className="inspector-header"><div><h2>{panel === 'comments' ? 'Discussion' : 'History'}</h2><p>{panel === 'comments' ? 'Notes on this workspace' : 'Saved versions'}</p></div><button className="mini-icon inspector-close" title="Close side panel" onClick={() => setInspectorVisible(false)}><X size={15} /></button></div>
          {panel === 'comments' ? <><div className="comment-context"><span className="context-file"><FileCode2 size={13} /> {activeFile.split('/').pop()}</span><span>Line {currentLine}</span></div><div className="comment-list">
            {comments.map((comment) => <article className="comment" key={comment.id}><div className="comment-author"><span className="avatar avatar--tiny" style={{ '--avatar-color': '#e99b75' } as CSSProperties}>{initials(comment.author)}</span><strong>{comment.author}</strong><span>{comment.time}</span></div><p>{comment.text}</p><button className="comment-line" onClick={() => { openFile(comment.fileName); window.setTimeout(() => { editorRef.current?.revealLineInCenter(comment.line); editorRef.current?.setPosition({ lineNumber: comment.line, column: 1 }) }, 80) }}>{comment.fileName}:{comment.line}</button></article>)}
            {!comments.length && <div className="empty-state"><MessageSquare size={20} /><span>No comments yet</span><small>Start a thread on this file.</small></div>}
          </div><div className="comment-composer"><div className="composer-meta"><span className="avatar avatar--tiny" style={{ '--avatar-color': '#e99b75' } as CSSProperties}>{initials(localName)}</span><span>{localName}</span><span>·</span><span>Line {currentLine}</span></div><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Leave a note for your team…" rows={3} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') addComment() }} /><div className="composer-actions"><span>⌘ ↵ to send</span><button className="send-button" onClick={addComment} title="Add comment" aria-label="Add comment"><Send size={14} /></button></div></div></> : <><div className="history-summary"><span className="history-summary-icon"><Clock3 size={15} /></span><div><strong>{revisions.length} snapshots</strong><small>Shared with this room</small></div><button className="mini-icon" title="Save snapshot" onClick={saveRevision}><Plus size={15} /></button></div><div className="revision-list">{revisions.map((revision, index) => <article className={`revision ${index === 0 ? 'revision--latest' : ''}`} key={revision.id}><span className="revision-marker" /><div className="revision-content"><strong>{revision.label}</strong><span>{revision.author} · {revision.time}</span><button onClick={() => restoreRevision(revision)}>Restore version</button></div></article>)}{!revisions.length && <div className="empty-state"><History size={20} /><span>No saved versions</span><small>Create a snapshot to mark a checkpoint.</small><button className="button button--quiet" onClick={saveRevision}><Plus size={13} /> Save first version</button></div>}</div></>}
          <div className="inspector-footer"><span className="inspector-lock"><Circle size={8} fill="currentColor" /> Workspace activity</span><span>Room {roomId}</span></div>
        </aside>}
      </main>
    </div>
  )
}

export default App