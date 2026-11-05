import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import * as THREE from 'three'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, Database, Eye, EyeOff, GitBranch, Layers3, Maximize2, Minus, Package, Pin, PinOff, Plus, RotateCcw, Search, X } from 'lucide-react'
import './App.css'

type Category = 'products' | 'entities' | 'containers'
type Section = Category | 'references'
type StepNode = { id: string; name: string; type: string; category: Category; color: string }
type StepLink = { id: string; source: string; target: string; label: string }
type GraphNode = StepNode & { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number; fx?: number; fy?: number; fz?: number }
type GraphLink = { id: string; source: string | GraphNode; target: string | GraphNode; label: string }
type GraphData = { nodes: GraphNode[]; links: GraphLink[] }
type CameraControls = { target: THREE.Vector3; update?: () => void }

const sourceNodes: StepNode[] = [
  { id: 'prd_CU-1001', name: 'Consumer Unit', type: 'CU', category: 'products', color: '#38bdf8' },
  { id: 'prd_TU-1002', name: 'Trade Unit', type: 'TU', category: 'products', color: '#a78bfa' },
  { id: 'GTIN-8712345678901', name: 'GTIN', type: 'GTIN', category: 'entities', color: '#34d399' },
  { id: 'prd_SupplierItem-1003', name: 'Supplier Item', type: 'Supplier Item', category: 'products', color: '#fbbf24' },
  { id: 'DC-1004', name: 'Packaging Information', type: 'Data Container', category: 'containers', color: '#fb7185' },
]
const sourceLinks: StepLink[] = [
  { id: 'rel-1', source: 'prd_TU-1002', target: 'prd_CU-1001', label: 'Hierarchy' },
  { id: 'rel-2', source: 'prd_CU-1001', target: 'GTIN-8712345678901', label: 'rpe_GTIN' },
  { id: 'rel-3', source: 'prd_SupplierItem-1003', target: 'GTIN-8712345678901', label: 'Reference' },
  { id: 'rel-4', source: 'GTIN-8712345678901', target: 'DC-1004', label: 'Data Container' },
]
const sections: { id: Section; label: string }[] = [
  { id: 'products', label: 'Products' }, { id: 'entities', label: 'Entities' },
  { id: 'references', label: 'References' }, { id: 'containers', label: 'Data Containers' },
]
const FIT_DURATION = 650

function endId(end: string | GraphNode) { return typeof end === 'string' ? end : end.id }

// Sprite dimensions are recalculated every render, keeping labels approximately constant in screen pixels.
function makeLabel(title: string, subtitle: string | null, color: string, size: number, relationship = false) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Group()
  const multiplier = size / 100
  const width = relationship ? 340 : 480
  const height = relationship ? 78 : 116
  canvas.width = width * 2
  canvas.height = height * 2
  ctx.scale(2, 2)
  ctx.fillStyle = relationship ? 'rgba(22, 30, 47, 0.96)' : 'rgba(15, 23, 42, 0.96)'
  ctx.beginPath()
  ctx.roundRect(3, 3, width - 6, height - 6, relationship ? 16 : 18)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = relationship ? 2 : 3
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f8fafc'
  ctx.font = `600 ${relationship ? 30 : 34}px Arial`
  ctx.fillText(title, width / 2, relationship ? 39 : 43, width - 24)
  if (subtitle) {
    ctx.fillStyle = '#cbd5e1'
    ctx.font = '24px Arial'
    ctx.fillText(subtitle, width / 2, 83, width - 24)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  const pixelWidth = (relationship ? 124 : 178) * multiplier
  const pixelHeight = pixelWidth * height / width
  sprite.onBeforeRender = (renderer, _scene, camera) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const viewport = renderer.getSize(new THREE.Vector2())
    const distance = Math.max(1, camera.position.distanceTo(sprite.getWorldPosition(new THREE.Vector3())))
    const worldPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, viewport.y)
    sprite.scale.set(pixelWidth * worldPerPixel, pixelHeight * worldPerPixel, 1)
  }
  return sprite
}

function frameVisibleGraph(
  graph: ForceGraphMethods<GraphNode, GraphLink> | undefined,
  dimensions: { width: number; height: number },
  duration: number,
  visibleNodes: GraphNode[],
) {
  if (!graph) return
  const camera = graph.camera()
  if (!(camera instanceof THREE.PerspectiveCamera)) return
  const nodes = visibleNodes
  if (!nodes.length) return

  const bounds = new THREE.Box3().setFromPoints(
    nodes.map(n => new THREE.Vector3(n.x ?? n.fx ?? 0, n.y ?? n.fy ?? 0, n.z ?? n.fz ?? 0)),
  )
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const aspect = Math.max(0.1, dimensions.width / Math.max(1, dimensions.height))

  // Screen-space labels are ~178 px wide. Reserve half a label at each
  // side, plus extra room for the floating controls at bottom right.
  const safeWidth = Math.max(180, dimensions.width - 260)
  const safeHeight = Math.max(180, dimensions.height - 190)
  const widthFraction = safeWidth / Math.max(1, dimensions.width)
  const heightFraction = safeHeight / Math.max(1, dimensions.height)
  const distanceX = (size.x / 2 + 70) / (tanHalfFov * aspect * widthFraction)
  const distanceY = (size.y / 2 + 55) / (tanHalfFov * heightFraction)
  const distance = Math.max(260, distanceX, distanceY) + size.z / 2

  // Deterministic camera and target: repeated Fit clicks yield the same view.
  graph.cameraPosition(
    { x: center.x, y: center.y, z: center.z + distance },
    { x: center.x, y: center.y, z: center.z },
    duration,
  )
}

function sectionIcon(id: Section) {
  if (id === 'products') return <Package size={15} />
  if (id === 'entities') return <Layers3 size={15} />
  if (id === 'references') return <GitBranch size={15} />
  return <Database size={15} />
}

function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('prd_CU-1001')
  const [centerId, setCenterId] = useState('prd_CU-1001')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [hiddenNodes, setHiddenNodes] = useState<string[]>([])
  const [hiddenLinks, setHiddenLinks] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Section[]>(['products', 'entities', 'references', 'containers'])
  const [search, setSearch] = useState('')
  const [labelSize, setLabelSize] = useState(100)
  const [showLinkLabels, setShowLinkLabels] = useState(true)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const focusRef = useRef<string | null>(null)
  const lastFocusPosition = useRef<THREE.Vector3 | null>(null)
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Selection never removes objects. Visibility is controlled only by the left sidebar.
  // Arrange all visible nodes in rings around the selected center, following the
  // undirected graph for positioning while retaining the original link direction.
  const graphData = useMemo<GraphData>(() => {
    const allowed = new Set(sourceNodes.filter(n => !hiddenNodes.includes(n.id)).map(n => n.id))
    const adjacency = new Map<string, string[]>()
    for (const id of allowed) adjacency.set(id, [])
    for (const link of sourceLinks) {
      if (hiddenLinks.includes(link.id) || !allowed.has(link.source) || !allowed.has(link.target)) continue
      adjacency.get(link.source)?.push(link.target)
      adjacency.get(link.target)?.push(link.source)
    }
    const depth = new Map<string, number>()
    const queue: string[] = []
    const visit = (root: string) => {
      if (depth.has(root)) return
      depth.set(root, 0)
      queue.push(root)
      while (queue.length) {
        const id = queue.shift()!
        for (const other of adjacency.get(id) ?? []) {
          if (!depth.has(other)) { depth.set(other, (depth.get(id) ?? 0) + 1); queue.push(other) }
        }
      }
    }
    if (allowed.has(centerId)) visit(centerId)
    for (const id of allowed) visit(id)
    const positions = new Map<string, [number, number, number]>()
    if (allowed.has(centerId)) positions.set(centerId, [0, 0, 0])
    const layers = [...new Set([...depth.values()])].sort((a, b) => a - b)
    for (const layer of layers) {
      const ids = [...allowed].filter(id => depth.get(id) === layer && id !== centerId)
      ids.forEach((id, i) => {
        const count = ids.length
        const angle = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, count)
        const radius = layer === 0 ? 340 : 260 * layer
        positions.set(id, [radius * Math.cos(angle), radius * Math.sin(angle), 0])
      })
    }
    const nodes: GraphNode[] = sourceNodes.filter(n => allowed.has(n.id)).map(n => {
      const [x, y, z] = positions.get(n.id) ?? [0, 0, 0]
      return { ...n, x, y, z, fx: x, fy: y, fz: z }
    })
    const links: GraphLink[] = sourceLinks.filter(l =>
      !hiddenLinks.includes(l.id) && allowed.has(l.source) && allowed.has(l.target)
    ).map(l => ({ ...l }))
    return { nodes, links }
  }, [centerId, hiddenNodes, hiddenLinks])

  const selectedNode = sourceNodes.find(n => n.id === selectedNodeId)
  const selectedLink = sourceLinks.find(l => l.id === selectedLinkId)
  const focusedNode = sourceNodes.find(n => n.id === focusedId)
  const matches = (value: string) => value.toLowerCase().includes(search.trim().toLowerCase())
  const adjacentIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>()
    const ids = new Set<string>([selectedNodeId])
    for (const l of graphData.links) {
      const a = endId(l.source), b = endId(l.target)
      if (a === selectedNodeId) ids.add(b)
      if (b === selectedNodeId) ids.add(a)
    }
    return ids
  }, [selectedNodeId, graphData])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setDimensions({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const stopFocus = useCallback(() => {
    focusRef.current = null
    lastFocusPosition.current = null
    setFocusedId(null)
  }, [])

  // Follow the moving centerpiece while leaving its physical position unconstrained.
  useEffect(() => {
    let active = true
    let frame = 0
    const follow = () => {
      if (!active) return
      const id = focusRef.current
      const graph = graphRef.current
      if (id && graph) {
        const node = graphData.nodes.find(n => n.id === id)
        const camera = graph.camera()
        const controls = graph.controls() as CameraControls | undefined
        if (node && camera && controls?.target && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
          const next = new THREE.Vector3(node.x, node.y, node.z)
          if (lastFocusPosition.current) {
            const delta = next.clone().sub(lastFocusPosition.current)
            if (delta.lengthSq() > 0.000001) {
              camera.position.add(delta)
              controls.target.add(delta)
              controls.update?.()
            }
          }
          lastFocusPosition.current = next
        }
      }
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => { active = false; cancelAnimationFrame(frame) }
  }, [graphData])

  useEffect(() => () => { if (fitTimer.current) clearTimeout(fitTimer.current) }, [])

  function cancelFit() { if (fitTimer.current) { clearTimeout(fitTimer.current); fitTimer.current = null } }
  // Frame the actual graph nodes, with room for the fixed-pixel labels.
  // Both automatic framing and the Fit button use this exact same calculation.
  function fitToView() {
    cancelFit()
    stopFocus()
    frameVisibleGraph(graphRef.current, dimensions, FIT_DURATION, graphData.nodes)
  }
  function resetLayout() {
    cancelFit()
    stopFocus()
    setHiddenNodes([])
    setHiddenLinks([])
    setCenterId('prd_CU-1001')
    setSelectedNodeId('prd_CU-1001')
    setSelectedLinkId(null)
  }
  function centerOnNode(id: string) {
    setHiddenNodes(previous => previous.filter(hiddenId => hiddenId !== id))
    setSelectedNodeId(id)
    setSelectedLinkId(null)
    setCenterId(id)
    stopFocus()
  }
  function zoom(factor: number) {
    const graph = graphRef.current
    if (!graph) return
    const camera = graph.camera()
    const controls = graph.controls() as CameraControls | undefined
    if (!camera || !controls?.target) return
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor)
    graph.cameraPosition(controls.target.clone().add(offset), controls.target.clone(), 350)
  }
  function focusNode(id: string) {
    centerOnNode(id)
    focusRef.current = id
    setFocusedId(id)
  }
  function toggleNode(id: string) {
    if (id === focusedId && !hiddenNodes.includes(id)) stopFocus()
    setHiddenNodes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleLink(id: string) { setHiddenLinks(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]) }
  function toggleSectionVisibility(section: Section) {
    if (section === 'references') {
      const ids = sourceLinks.map(l => l.id)
      setHiddenLinks(prev => ids.every(id => prev.includes(id)) ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])])
    } else {
      const ids = sourceNodes.filter(n => n.category === section).map(n => n.id)
      if (focusedId && ids.includes(focusedId) && !ids.every(id => hiddenNodes.includes(id))) stopFocus()
      setHiddenNodes(prev => ids.every(id => prev.includes(id)) ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])])
    }
  }
  function sectionHidden(section: Section) {
    return section === 'references'
      ? sourceLinks.every(l => hiddenLinks.includes(l.id))
      : sourceNodes.filter(n => n.category === section).every(n => hiddenNodes.includes(n.id))
  }
  function selectNode(id: string) { centerOnNode(id) }
  function copyObjectId(id: string) {
    void navigator.clipboard.writeText(id).then(() => setCopiedId(id)).catch(() => undefined)
  }
  function selectLink(id: string) { setSelectedLinkId(id); setSelectedNodeId(null) }

  function handleDragEnd(node: GraphNode) {
    node.fx = node.x; node.fy = node.y; node.fz = node.z
    node.vx = 0; node.vy = 0; node.vz = 0
  }

  // Wait for react-force-graph to receive the new nodes before framing them.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      frameVisibleGraph(graphRef.current, dimensions, 500, graphData.nodes)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [graphData, dimensions])

  function nodeRow(node: StepNode) {
    const hidden = hiddenNodes.includes(node.id)
    return <div className={`object-row ${hidden ? 'is-hidden' : ''} ${focusedId === node.id ? 'focused' : ''}`} key={node.id}>
      <button className={`object-item ${selectedNodeId === node.id ? 'selected' : ''}`} onClick={() => selectNode(node.id)}>
        <span className="type-dot" style={{ background: node.color }} />
        <span className="object-info"><strong>{node.name}</strong><small title={node.id}>{node.id}</small></span>
      </button>
      <button className="icon-button" title={hidden ? 'Show object' : 'Hide object'} aria-label={hidden ? `Show ${node.name}` : `Hide ${node.name}`} onClick={() => toggleNode(node.id)}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
      <button className={`icon-button ${focusedId === node.id ? 'active' : ''}`} disabled={hidden} title="Focus object" aria-label={`Focus ${node.name}`} onClick={() => focusedId === node.id ? stopFocus() : focusNode(node.id)}>{focusedId === node.id ? <PinOff size={14} /> : <Pin size={14} />}</button>
    </div>
  }
  function linkRow(link: StepLink) {
    const hidden = hiddenLinks.includes(link.id)
    return <div className={`object-row ${hidden ? 'is-hidden' : ''}`} key={link.id}>
      <button className={`object-item ${selectedLinkId === link.id ? 'selected' : ''}`} onClick={() => selectLink(link.id)}>
        <GitBranch size={13} className="reference-icon" /><span className="object-info"><strong>{link.label}</strong><small title={`${link.source} → ${link.target}`}>{link.source} → {link.target}</small></span>
      </button>
      <button className="icon-button" title={hidden ? 'Show relationship' : 'Hide relationship'} aria-label={hidden ? `Show ${link.label}` : `Hide ${link.label}`} onClick={() => toggleLink(link.id)}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
    </div>
  }

  const outgoingReferences = selectedNode ? sourceLinks.filter(link => link.source === selectedNode.id && link.label !== 'Hierarchy' && link.label !== 'Data Container') : []
  const incomingReferences = selectedNode ? sourceLinks.filter(link => link.target === selectedNode.id && link.label !== 'Hierarchy' && link.label !== 'Data Container') : []
  const structuralLinks = selectedNode ? sourceLinks.filter(link => (link.source === selectedNode.id || link.target === selectedNode.id) && (link.label === 'Hierarchy' || link.label === 'Data Container')) : []

  function referenceCard(link: StepLink, direction: 'outgoing' | 'incoming') {
    const otherId = direction === 'outgoing' ? link.target : link.source
    const otherNode = sourceNodes.find(candidate => candidate.id === otherId)
    return <div key={link.id} className="inspector-reference-wrap">
      <button className="inspector-reference" onClick={() => selectNode(otherId)} title={`Center on ${otherId}`}>
      <span className="inspector-reference-top"><strong>{link.label}</strong>{direction === 'outgoing' ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}</span>
      <span className="inspector-reference-name">{otherNode?.name ?? otherId}</span>
      <span className="inspector-reference-id">{otherId}</span>
      {otherNode && <span className="inspector-reference-type"><span className="type-dot" style={{ background: otherNode.color }} />{otherNode.type}</span>}
      </button>

    </div>
  }

  return <div className="orbit">
    <aside className="sidebar">
      <div className="brand"><h2>ORBIT</h2><p>STEP Object Explorer</p></div>
      <div className="search-box"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ID, name, type..." aria-label="Search STEP objects" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</div>
      <div className="explorer-actions"><button onClick={() => { setHiddenNodes([]); setHiddenLinks([]) }}><Eye size={13} /> Show all</button><button onClick={() => { stopFocus(); setHiddenNodes(sourceNodes.map(n => n.id)); setHiddenLinks(sourceLinks.map(l => l.id)) }}><EyeOff size={13} /> Hide all</button></div>
      <div className="explorer-sections">{sections.map(section => {
        const isExpanded = expanded.includes(section.id)
        const items = section.id === 'references' ? sourceLinks.filter(l => matches(`${l.label} ${l.source} ${l.target} ${l.id}`)) : sourceNodes.filter(n => n.category === section.id && matches(`${n.name} ${n.id} ${n.type}`))
        return <div className="explorer-section" key={section.id}>
          <div className="section-header">
            <button className="section-expand" onClick={() => setExpanded(prev => prev.includes(section.id) ? prev.filter(x => x !== section.id) : [...prev, section.id])} aria-expanded={isExpanded}>
              {sectionIcon(section.id)}<span>{section.label}</span><span className="section-count">{items.length}</span>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <button className="section-visibility" title={`Toggle ${section.label} visibility`} aria-label={`Toggle ${section.label} visibility`} onClick={() => toggleSectionVisibility(section.id)}>{sectionHidden(section.id) ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
          {isExpanded && <div className="section-content">{items.length ? section.id === 'references' ? (items as StepLink[]).map(linkRow) : (items as StepNode[]).map(nodeRow) : <p className="empty-section">No matches</p>}</div>}
        </div>
      })}</div>
      {focusedNode && <div className="focus-status"><div className="focus-heading"><Pin size={13} /> FOCUS MODE</div><strong>{focusedNode.name}</strong><small>{focusedNode.id}</small><button onClick={stopFocus}>Release focus</button></div>}
    </aside>
    <main className="graph" ref={containerRef}>
      <header className="toolbar"><div className="toolbar-heading"><strong>STEP Object Orbit</strong><span>{graphData.nodes.length} objects · {graphData.links.length} relationships</span></div>

        <div className="orbit-graph-actions">
          <span className="orbit-center-name">{sourceNodes.find(n => n.id === centerId)?.name}</span>
          <span className="orbit-center-name">All visible objects remain on the canvas</span>
        </div>
      </header>
      <div className="graph-controls" aria-label="Graph display and navigation controls">
        <label className="vertical-control-label" title="Toggle relationship labels">
          <input type="checkbox" checked={showLinkLabels} onChange={e => setShowLinkLabels(e.target.checked)} />
          <span>Labels</span>
        </label>
        <div className="vertical-control-divider" />
        <label className="vertical-control-label" htmlFor="orbit-label-size">Size</label>
        <input id="orbit-label-size" className="vertical-size-slider" aria-label="Label size" type="range" min="60" max="150" step="5" value={labelSize} onChange={e => setLabelSize(Number(e.target.value))} />
        <span className="vertical-size-value">{labelSize}%</span>
        <div className="vertical-control-divider" />
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoom(0.8)}><Plus size={17} /></button>
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoom(1.25)}><Minus size={17} /></button>
        <div className="vertical-control-divider" />
        <button title="Fit to View" aria-label="Fit to View" onClick={fitToView}><Maximize2 size={17} /></button>
        <button title="Reset Layout" aria-label="Reset Layout" onClick={resetLayout}><RotateCcw size={17} /></button>
      </div>
      <ForceGraph3D<GraphNode, GraphLink>
        ref={graphRef} graphData={graphData} width={dimensions.width} height={dimensions.height}
        backgroundColor="#080d19" showNavInfo={false} enableNodeDrag={true}
        nodeRelSize={7} nodeColor={n => selectedNodeId && !adjacentIds.has(n.id) ? '#475569' : n.color}
        nodeOpacity={0.95} nodeLabel={n => `${n.name} (${n.id})`}
        nodeThreeObject={n => { const sprite = makeLabel(n.name, n.id, n.color, labelSize); sprite.position.set(0, 23, 0); return sprite }}
        nodeThreeObjectExtend={true}
        linkColor={l => selectedLinkId === l.id || (selectedNodeId && (endId(l.source) === selectedNodeId || endId(l.target) === selectedNodeId)) ? '#c4b5fd' : selectedNodeId ? '#334155' : '#64748b'}
        linkWidth={l => selectedLinkId === l.id || (selectedNodeId && (endId(l.source) === selectedNodeId || endId(l.target) === selectedNodeId)) ? 2.8 : 1.1}
        linkOpacity={0.7} linkDirectionalParticles={2} linkDirectionalParticleWidth={1.4} linkLabel={l => l.label}
        linkThreeObject={l => showLinkLabels ? makeLabel(l.label, null, '#64748b', labelSize, true) : new THREE.Group()}
        linkThreeObjectExtend={true}
        linkPositionUpdate={(obj, positions) => { obj.position.set(positions.start.x * 0.5 + positions.end.x * 0.5, positions.start.y * 0.5 + positions.end.y * 0.5 - 24, positions.start.z * 0.62 + positions.end.z * 0.38); return true }}
        onNodeClick={n => selectNode(n.id)} onLinkClick={l => selectLink(l.id)} onNodeDragEnd={handleDragEnd}
      />
    </main>
    <aside className="details inspector">
      <div className="inspector-header"><h3>Object Details</h3><span className="inspector-subheading">STEP Object Inspector</span></div>
      {selectedNode ? <>
        <div className="inspector-properties">
          <div className="inspector-property"><div className="section-title">ID</div><div className="inspector-id-row"><span>{selectedNode.id}</span><button aria-label="Copy object ID" title={copiedId === selectedNode.id ? 'Copied' : 'Copy ID'} onClick={() => copyObjectId(selectedNode.id)}>{copiedId === selectedNode.id ? <Check size={15} /> : <Copy size={15} />}</button></div></div>
          <div className="inspector-property"><div className="section-title">NAME</div><p className="inspector-name">{selectedNode.name}</p></div>
          <div className="inspector-property"><div className="section-title">OBJECT TYPE</div><span className="inspector-type"><span className="type-dot" style={{ background: selectedNode.color }} />{selectedNode.type}</span></div>
        </div>
        <section className="inspector-group"><div className="inspector-group-heading"><h4>References</h4><span>{outgoingReferences.length}</span></div><p className="inspector-group-caption">Outgoing references</p>{outgoingReferences.length ? outgoingReferences.map(link => referenceCard(link, 'outgoing')) : <p className="inspector-empty">No outgoing references</p>}</section>
        <section className="inspector-group"><div className="inspector-group-heading"><h4>Referenced By</h4><span>{incomingReferences.length}</span></div><p className="inspector-group-caption">Incoming references</p>{incomingReferences.length ? incomingReferences.map(link => referenceCard(link, 'incoming')) : <p className="inspector-empty">No incoming references</p>}</section>
        {structuralLinks.length > 0 && <section className="inspector-group"><div className="inspector-group-heading"><h4>Structure &amp; Containers</h4><span>{structuralLinks.length}</span></div>{structuralLinks.map(link => referenceCard(link, link.source === selectedNode.id ? 'outgoing' : 'incoming'))}</section>}
      </> : selectedLink ? <>
        <div className="inspector-properties">
          <div className="inspector-property"><div className="section-title">RELATIONSHIP TYPE</div><p>{selectedLink.label}</p></div>
          <div className="inspector-property"><div className="section-title">RELATIONSHIP ID</div><p>{selectedLink.id}</p></div>
        </div>
        <section className="inspector-group"><div className="inspector-group-heading"><h4>Source</h4></div>{referenceCard(selectedLink, 'incoming')}</section>
        <section className="inspector-group"><div className="inspector-group-heading"><h4>Target</h4></div>{referenceCard(selectedLink, 'outgoing')}</section>
      </> : <p className="muted">Select an object or relationship to inspect it.</p>}
    </aside>
  </div>
}
export default App
