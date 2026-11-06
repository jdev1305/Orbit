import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import * as THREE from 'three'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, Container, Cuboid, Eye, EyeOff, Folder, FolderOpen, FileCode2, ArrowLeftRight, GripVertical, Tags, Layers3, Maximize2, Minus, Pin, PinOff, Plus, RotateCcw, Search, X } from 'lucide-react'
import { parseStepXml } from './parsers/stepXmlParser'
import type { StepNode, StepLink, ParsedStepXml } from './parsers/stepXmlParser'
import './App.css'

type Category = 'products' | 'entities' | 'containers'
type Section = Category | 'references'
type OrbitTheme = 'graphite'
type ExplorerMode = 'model' | 'product'
type LayoutMode = 'spider' | 'hierarchy'
type GraphNode = StepNode & { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number; fx?: number; fy?: number; fz?: number }
type GraphLink = { id: string; source: string | GraphNode; target: string | GraphNode; label: string; kind?: 'reference' | 'hierarchy' | 'container'; count?: number }

function endId(end: string | GraphNode): string {
  return typeof end === 'string' ? end : end.id
}
type GraphData = { nodes: GraphNode[]; links: GraphLink[] }
type CameraControls = { target: THREE.Vector3; update?: () => void }

const sections: { id: Section; label: string }[] = [
  { id: 'products', label: 'Products' }, { id: 'entities', label: 'Entities' },
  { id: 'references', label: 'References' }, { id: 'containers', label: 'Data Containers' },
]
const FIT_DURATION = 650
const EMPTY_NODES: StepNode[] = []
const EMPTY_LINKS: StepLink[] = []
const THEME_META: Record<OrbitTheme, { name: string; background: string; labelBackground: string; labelText: string; labelMuted: string }> = {
  graphite: { name: 'Graphite Space', background: '#0c1017', labelBackground: '#1b222d', labelText: '#f1f3f7', labelMuted: '#aab5c5' },
}


function makeLabel(title: string, subtitle: string | null, color: string, size: number, relationship = false, theme: OrbitTheme = 'graphite') {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Group()
  const multiplier = size / 100
  const width = relationship ? 340 : 480
  const height = relationship ? 78 : 116
  canvas.width = width * 2
  canvas.height = height * 2
  ctx.scale(2, 2)
  ctx.fillStyle = THEME_META[theme].labelBackground
  ctx.beginPath()
  ctx.roundRect(3, 3, width - 6, height - 6, relationship ? 16 : 18)
  ctx.fill()
  ctx.shadowColor = color
  ctx.shadowBlur = relationship ? 0 : 17
  ctx.strokeStyle = color
  ctx.lineWidth = relationship ? 2 : 3
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = THEME_META[theme].labelText
  ctx.font = `600 ${relationship ? 29 : 35}px Inter, system-ui, sans-serif`
  ctx.fillText(title, width / 2, relationship ? 39 : 43, width - 24)
  if (subtitle) {
    ctx.fillStyle = THEME_META[theme].labelMuted
    ctx.font = '500 23px "JetBrains Mono", monospace'
    ctx.fillText(subtitle, width / 2, 83, width - 24)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  const pixelWidth = (relationship ? 94 : 178) * multiplier
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

// Minimal Graphite cards: quiet surfaces, one slim type accent, no neon outline.
// Keep the same screen-space dimensions as the prior cards for connection clipping.
function makeNodeCard(node: GraphNode, size: number, mode: ExplorerMode, selected: boolean): THREE.Sprite | THREE.Group {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Group()
  const width = 480, height = 116
  canvas.width = width * 2
  canvas.height = height * 2
  ctx.scale(2, 2)
  const background = ctx.createLinearGradient(0, 0, 0, height)
  background.addColorStop(0, '#242b35')
  background.addColorStop(1, '#1a2029')
  ctx.fillStyle = background
  ctx.beginPath()
  ctx.roundRect(3, 3, width - 6, height - 6, 14)
  ctx.fill()
  ctx.strokeStyle = selected ? '#9146ff' : '#46505e'
  ctx.lineWidth = selected ? 4 : 2
  ctx.stroke()
  // Accent is confined to a narrow vertical bar rather than the entire border.
  ctx.fillStyle = node.color
  ctx.beginPath()
  ctx.roundRect(13, 21, 6, 74, 3)
  ctx.fill()
  // Supertype icons: Layers3 (Products), Cuboid (Entities), Container (Data Containers).
  // Canvas paths match the corresponding Lucide outline icons in the sidebar.
  const iconX = 43, iconY = mode === 'model' ? 58 : 32
  ctx.save()
  ctx.translate(iconX, iconY)
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 2.7
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const segment = (points: number[]) => {
    ctx.beginPath()
    ctx.moveTo(points[0], points[1])
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
    ctx.stroke()
  }
  if (node.category === 'products') {
    // Layers3: stacked planes representing the product hierarchy.
    segment([-12, -7, 0, -14, 12, -7, 0, 0, -12, -7])
    segment([-12, 0, 0, 7, 12, 0])
    segment([-12, 7, 0, 14, 12, 7])
  } else if (node.category === 'entities') {
    // Cuboid: an independent three-dimensional object.
    segment([-12, -7, 0, -14, 12, -7, 12, 7, 0, 14, -12, 7, -12, -7])
    segment([-12, -7, 0, 0, 12, -7])
    segment([0, 0, 0, 14])
  } else {
    // Container: shipping-container silhouette with its characteristic ribs.
    segment([-13, -9, -6, -13, 13, -10, 13, 10, -6, 13, -13, 9, -13, -9])
    segment([-6, -13, -6, 13])
    segment([-10, -11, -10, 11])
    for (const x of [0, 5, 10]) segment([x, -5, x, 6])
  }
  ctx.restore()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const left = 69
  if (mode === 'model') {
    // Data Model: only the unique STEP object type ID, once.
    const typeId = node.name || node.id.replace(/^[^:]+:/, '')
    ctx.fillStyle = '#f0f3f8'
    ctx.font = '600 30px Inter, system-ui, sans-serif'
    ctx.fillText(typeId, left, 58, width - left - 18)
  } else {
    // Product Explorer: instance name, instance ID, and object type ID.
    ctx.fillStyle = '#f0f3f8'
    ctx.font = '600 29px Inter, system-ui, sans-serif'
    ctx.fillText(node.name || node.id, left, 28, width - left - 18)
    ctx.fillStyle = '#c0c9d7'
    ctx.font = '500 20px "JetBrains Mono", monospace'
    ctx.fillText(node.id, left, 64, width - left - 18)
    ctx.fillStyle = '#9daabc'
    ctx.font = '500 18px "JetBrains Mono", monospace'
    ctx.fillText(node.type || '', left, 96, width - left - 18)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  const pixelWidth = 178 * size / 100
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

// Relationship endpoints are clipped against the screen-facing node cards.
// Projection is recalculated on render so orbiting/zooming does not expose lines through labels.
function clipToCard(from: THREE.Vector3, to: THREE.Vector3, card: THREE.Vector3, camera: THREE.Camera, viewport: THREE.Vector2, size: number): THREE.Vector3 {
  const a = from.clone().project(camera)
  const b = to.clone().project(camera)
  const c = card.clone().project(camera)
  const sx = viewport.x / 2, sy = viewport.y / 2
  const x0 = (a.x + 1) * sx, y0 = (1 - a.y) * sy
  const x1 = (b.x + 1) * sx, y1 = (1 - b.y) * sy
  const cx = (c.x + 1) * sx, cy = (1 - c.y) * sy
  const halfW = 89 * size / 100 + 5, halfH = 21.5 * size / 100 + 5
  const dx = x1 - x0, dy = y1 - y0
  const left = cx - halfW, right = cx + halfW, top = cy - halfH, bottom = cy + halfH
  // Liang-Barsky segment/rectangle intersection: exit the card if the line begins inside.
  let entry = 0, exit = 1
  const tests = [[-dx, x0 - left], [dx, right - x0], [-dy, y0 - top], [dy, bottom - y0]]
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return from.clone(); continue }
    const r = q / p
    if (p < 0) entry = Math.max(entry, r)
    else exit = Math.min(exit, r)
    if (entry > exit) return from.clone()
  }
  // If the endpoint is outside the card, the segment is not obscured at its origin.
  if (x0 < left || x0 > right || y0 < top || y0 > bottom) return from.clone()
  return from.clone().lerp(to, Math.min(0.98, exit + 0.006))
}

function makeRelationshipVisual(label: string, color: string, size: number, theme: OrbitTheme, showLabel: boolean, active: boolean): THREE.Group {
  const group = new THREE.Group()
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: active ? 0.95 : 0.65, depthTest: false })
  const line = new THREE.Line(geometry, material)
  line.renderOrder = 1
  group.add(line)
  const labelSprite = showLabel ? makeLabel(label, null, color, size, true, theme) : null
  if (labelSprite) { labelSprite.renderOrder = 3; group.add(labelSprite) }
  // Keep the endpoints in world coordinates; the group is deliberately never translated.
  let start = new THREE.Vector3(), end = new THREE.Vector3()
  const setPositions = (a: THREE.Vector3, b: THREE.Vector3) => { start = a; end = b }
  line.onBeforeRender = (renderer, _scene, camera) => {
    const viewport = renderer.getSize(new THREE.Vector2())
    const a = clipToCard(start, end, start.clone().add(new THREE.Vector3(0, 23, 0)), camera, viewport, size)
    const b = clipToCard(end, start, end.clone().add(new THREE.Vector3(0, 23, 0)), camera, viewport, size)
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    positions.setXYZ(0, a.x, a.y, a.z)
    positions.setXYZ(1, b.x, b.y, b.z)
    positions.needsUpdate = true
    geometry.computeBoundingSphere()
    if (labelSprite) {
      const midpoint = a.clone().add(b).multiplyScalar(0.5)
      // Place the label slightly away from the line, in screen-up direction.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const worldPerPixel = camera instanceof THREE.PerspectiveCamera
        ? 2 * camera.position.distanceTo(midpoint) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, viewport.y)
        : 1
      labelSprite.position.copy(midpoint).addScaledVector(up, 14 * worldPerPixel)
    }
  }
  ;(group as THREE.Group & { setEndpoints: typeof setPositions }).setEndpoints = setPositions
  return group
}

// Soft additive glow sits behind the native colored node sphere.
function makeNodeVisual(node: GraphNode, labelSize: number, mode: ExplorerMode, selected: boolean): THREE.Group {
  const group = new THREE.Group()
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 63)
    gradient.addColorStop(0, 'rgba(255,255,255,0.70)')
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.30)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 128)
    const texture = new THREE.CanvasTexture(canvas)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, color: node.color, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }))
    halo.scale.set(42, 42, 1)
    halo.position.set(0, 0, -2)
    group.add(halo)
  }
  const label = makeNodeCard(node, labelSize, mode, selected)
  label.position.set(0, 23, 0)
  group.add(label)
  return group
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
  if (id === 'products') return <Layers3 size={15} />
  if (id === 'entities') return <Cuboid size={15} />
  if (id === 'references') return <ArrowLeftRight size={15} />
  return <Container size={15} />
}

function App() {
  const [mode, setMode] = useState<ExplorerMode>('product')
  const [parsed, setParsed] = useState<ParsedStepXml | null>(null)
  const [xmlName, setXmlName] = useState('')
  const [xmlFiles, setXmlFiles] = useState<string[]>([])
  const localFilesRef = useRef<Map<string, File>>(new Map())
  const filePickerRef = useRef<HTMLInputElement>(null)
  const folderPickerRef = useRef<HTMLInputElement>(null)
  const [xmlFoldersOpen, setXmlFoldersOpen] = useState<string[]>([''])
  const [xmlListError, setXmlListError] = useState<string | null>(null)
  const [xmlError, setXmlError] = useState<string | null>(null)
  const [xmlLoading, setXmlLoading] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('spider')
  const [layoutCenterId, setLayoutCenterId] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [hiddenNodes, setHiddenNodes] = useState<string[]>([])
  const [hiddenLinks, setHiddenLinks] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Section[]>([])
  const [search, setSearch] = useState('')
  const [labelSize, setLabelSize] = useState(100)
  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([document.fonts.load('600 16px Inter'), document.fonts.load('500 16px "JetBrains Mono"')])
      .then(() => { if (active) setFontsReady(true) })
      .catch(() => {})
    return () => { active = false }
  }, [])
  const [showLinkLabels, setShowLinkLabels] = useState(true)
  const theme: OrbitTheme = 'graphite'
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const sourceNodes = (mode === 'model' ? parsed?.model.nodes : parsed?.product.nodes) ?? EMPTY_NODES
  const sourceLinks = (mode === 'model' ? parsed?.model.links : parsed?.product.links) ?? EMPTY_LINKS
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const focusRef = useRef<string | null>(null)
  const lastFocusPosition = useRef<THREE.Vector3 | null>(null)
  const draggingFocusedNode = useRef(false)
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  type ToolbarCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  const [toolbarCorner, setToolbarCorner] = useState<ToolbarCorner>('bottom-right')
  const [toolbarDrag, setToolbarDrag] = useState<{ left: number; top: number } | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const toolbarPointer = useRef<{ id: number; offsetX: number; offsetY: number; moved: boolean } | null>(null)

  function beginToolbarDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !containerRef.current || !toolbarRef.current) return
    const bounds = containerRef.current.getBoundingClientRect()
    const toolbarBounds = toolbarRef.current.getBoundingClientRect()
    toolbarPointer.current = {
      id: event.pointerId,
      offsetX: event.clientX - toolbarBounds.left,
      offsetY: event.clientY - toolbarBounds.top,
      moved: false,
    }
    setToolbarDrag({ left: toolbarBounds.left - bounds.left, top: toolbarBounds.top - bounds.top })
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveToolbarDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const pointer = toolbarPointer.current
    const container = containerRef.current
    const toolbar = toolbarRef.current
    if (!pointer || pointer.id !== event.pointerId || !container || !toolbar) return
    const bounds = container.getBoundingClientRect()
    const width = toolbar.offsetWidth
    const height = toolbar.offsetHeight
    const left = Math.max(8, Math.min(bounds.width - width - 8, event.clientX - bounds.left - pointer.offsetX))
    const top = Math.max(8, Math.min(bounds.height - height - 8, event.clientY - bounds.top - pointer.offsetY))
    pointer.moved = true
    setToolbarDrag({ left, top })
  }

  function endToolbarDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const pointer = toolbarPointer.current
    if (!pointer || pointer.id !== event.pointerId) return
    const bounds = containerRef.current?.getBoundingClientRect()
    const toolbar = toolbarRef.current
    if (bounds && toolbar) {
      const rect = toolbar.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2 - bounds.left
      const centerY = rect.top + rect.height / 2 - bounds.top
      setToolbarCorner(`${centerY < bounds.height / 2 ? 'top' : 'bottom'}-${centerX < bounds.width / 2 ? 'left' : 'right'}` as ToolbarCorner)
    }
    toolbarPointer.current = null
    setToolbarDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }


  const resetForGraph = (next: ParsedStepXml, nextMode: ExplorerMode) => {
    const first = (nextMode === 'model' ? next.model.nodes : next.product.nodes)[0]?.id ?? ''
    stopFocus()
    setSelectedNodeId(first || null)
    setSelectedLinkId(null)
    setLayoutCenterId(first)
    setHiddenNodes([])
    setHiddenLinks([])
    setSearch('')
    setLayoutVersion(v => v + 1)
  }

  // STEPXML is never fetched from a server. The browser reads only files explicitly selected by the user.
  const loadXml = async (filename: string) => {
    const file = localFilesRef.current.get(filename)
    if (!file) { setXmlError('Select a local STEPXML file or folder first.'); return }
    setXmlLoading(true)
    setXmlError(null)
    try {
      const next = parseStepXml(await file.text())
      resetForGraph(next, mode)
      setParsed(next)
      setXmlName(filename)
    } catch {
      // Never include parser errors or XML content in the UI or diagnostic logs.
      setXmlError('Unable to parse this STEPXML file. Check its format locally.')
    } finally { setXmlLoading(false) }
  }

  const importLocalFiles = (list: FileList | null, folder: boolean) => {
    if (!list?.length) return
    const files = new Map<string, File>()
    for (const file of Array.from(list)) {
      const name = folder ? (file.webkitRelativePath || file.name) : file.name
      if (!/\.xml$/i.test(name)) continue
      if (files.has(name)) { setXmlListError('Duplicate file names. Select a folder instead.'); return }
      files.set(name, file)
    }
    if (!files.size) { setXmlListError('No XML files found in the selection.'); return }
    localFilesRef.current = files
    setXmlFiles([...files.keys()].sort((a, b) => a.localeCompare(b)))
    setXmlFoldersOpen(['', ...new Set([...files.keys()].flatMap(name => {
      const parts = name.split('/')
      return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
    }))])
    setXmlListError(null)
    setXmlError(null)
    setParsed(null)
    setXmlName('')
    stopFocus()
    setSelectedNodeId(null)
    setSelectedLinkId(null)
    setHiddenNodes([])
    setHiddenLinks([])
    setLayoutVersion(v => v + 1)
  }

  const toggleXmlFolder = (path: string) => setXmlFoldersOpen(current => current.includes(path) ? current.filter(p => p !== path) : [...current, path])
  const renderXmlFolder = (folder: string, depth: number): ReactNode => {
    const prefix = folder ? `${folder}/` : ''
    const children = xmlFiles.filter(file => file.startsWith(prefix))
    const directories = [...new Set(children.filter(file => file.slice(prefix.length).includes('/')).map(file => file.slice(prefix.length).split('/')[0]))].sort()
    const files = children.filter(file => !file.slice(prefix.length).includes('/'))
    const isOpen = xmlFoldersOpen.includes(folder)
    return <div key={folder}>
      <button type="button" className="stepxml-tree-folder" style={{ paddingLeft: 7 + depth * 13 }} onClick={() => toggleXmlFolder(folder)} aria-expanded={isOpen}>
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
        <span>{folder ? folder.split('/').pop() : 'Local STEPXML'}</span>
        {folder === '' && <span className="stepxml-tree-count">{xmlFiles.length}</span>}
      </button>
      {isOpen && <div>
        {directories.map(name => renderXmlFolder(`${prefix}${name}`, depth + 1))}
        {files.map(file => <button key={file} type="button" className={`stepxml-tree-file ${xmlName === file ? 'active' : ''}`} style={{ paddingLeft: 24 + (depth + 1) * 13 }} onClick={() => { if (!xmlLoading) void loadXml(file) }} disabled={xmlLoading} title={file} aria-current={xmlName === file ? 'true' : undefined}>
          <FileCode2 size={14} /><span>{file.slice(prefix.length)}</span>{xmlName === file && <Check size={13} />}
        </button>)}
        {folder === '' && xmlFiles.length === 0 && <p className="stepxml-tree-empty">Choose files or a folder above</p>}
      </div>}
    </div>
  }

  // Selection never removes objects. Visibility is controlled only by the left sidebar.
  // Layout is independent of selection. Only Reset Layout recreates positions.
  // The explicit Focus action chooses the layout anchor; selecting alone never changes it.
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
    const layoutCenter = allowed.has(layoutCenterId) ? layoutCenterId : [...allowed][0]
    if (layoutCenter && allowed.has(layoutCenter)) visit(layoutCenter)
    for (const id of allowed) visit(id)
    const positions = new Map<string, [number, number, number]>()
    if (layoutCenter && allowed.has(layoutCenter)) positions.set(layoutCenter, [0, 0, 0])
    const layers = [...new Set([...depth.values()])].sort((a, b) => a - b)
    for (const layer of layers) {
      const ids = [...allowed].filter(id => depth.get(id) === layer && id !== layoutCenter)
      ids.forEach((id, i) => {
        const count = ids.length
        const angle = -Math.PI / 2 + (layoutVersion % 4) * 0.18 + 2 * Math.PI * i / Math.max(1, count)
        const radius = layer === 0 ? 380 : 320 * layer
        positions.set(id, [radius * Math.cos(angle), radius * Math.sin(angle), 0])
      })
    }
    if (layoutMode === 'hierarchy') {
      // Hierarchy edges are directed parent -> child. Reference/container edges never
      // change ancestry; their otherwise unplaced targets occupy lateral columns.
      positions.clear()
      const children = new Map<string, string[]>()
      const parents = new Map<string, string>()
      const typeById = new Map(sourceNodes.map(n => [n.id, n.type ?? '']))
      const isUnit = (id: string) => /prd_(?:CU|TU|TradeUnits|SalesUnit)/i.test(typeById.get(id) ?? '')
      for (const id of allowed) children.set(id, [])
      for (const link of sourceLinks) {
        // Only CU/TU/SalesUnit hierarchy belongs in the vertical product tree.
        // GTIN, supplier, data-pool and data-container nodes remain lateral,
        // even when the XML happens to contain a ParentID for them.
        if (link.kind !== 'hierarchy' || hiddenLinks.includes(link.id) ||
            !allowed.has(link.source) || !allowed.has(link.target) ||
            !isUnit(link.source) || !isUnit(link.target) ||
            link.source === link.target || parents.has(link.target)) continue
        let ancestor: string | undefined = link.source
        let cycle = false
        while (ancestor) {
          if (ancestor === link.target) { cycle = true; break }
          ancestor = parents.get(ancestor)
        }
        if (!cycle) {
          parents.set(link.target, link.source)
          children.get(link.source)?.push(link.target)
        }
      }
      const hierarchyRoots = [...allowed].filter(id => isUnit(id) && !parents.has(id))
      const lateralRoots = [...allowed].filter(id => !isUnit(id))
      const branchWidth = (id: string): number => {
        const descendants = children.get(id) ?? []
        return Math.max(1, descendants.reduce((sum, child) => sum + branchWidth(child), 0))
      }
      const placeBranch = (id: string, left: number, level: number) => {
        const width = branchWidth(id)
        positions.set(id, [(left + width / 2) * 300, -level * 260, 0])
        let next = left
        for (const child of children.get(id) ?? []) {
          placeBranch(child, next, level + 1)
          next += branchWidth(child)
        }
      }
      let cursor = 0
      for (const root of hierarchyRoots) {
        placeBranch(root, cursor, 0)
        cursor += branchWidth(root) + 1
      }
      if (positions.size > 0) {
        const placed = [...positions.values()]
        const centerX = (Math.min(...placed.map(p => p[0])) + Math.max(...placed.map(p => p[0]))) / 2
        for (const [id, pos] of positions) positions.set(id, [pos[0] - centerX, pos[1], pos[2]])

        // Place non-tree objects in side columns. Prefer a direct link to a
        // CU/TU/SalesUnit as the vertical anchor; never place them as children.
        const lateral = lateralRoots.map(id => {
          const links = sourceLinks.filter(l => !hiddenLinks.includes(l.id) &&
            (l.source === id || l.target === id))
          const anchor = links.map(l => positions.get(l.source === id ? l.target : l.source))
            .find((v): v is [number, number, number] => Boolean(v))
          return { id, anchorY: anchor?.[1] ?? 0 }
        }).sort((a, b) => b.anchorY - a.anchorY || a.id.localeCompare(b.id))
        const columns: number[][] = [[], []]
        for (const item of lateral) {
          const side = columns[0].length <= columns[1].length ? 0 : 1
          const occupied = columns[side]
          let y = item.anchorY
          // Keep the side columns readable even when several nodes share a CU.
          while (occupied.some(other => Math.abs(other - y) < 135)) y -= 150
          occupied.push(y)
          positions.set(item.id, [side === 0 ? -850 : 850, y, 0])
        }
      } else {
        // No CU/TU/SalesUnit nodes: use the normal spider arrangement.
        positions.clear()
        if (layoutCenter && allowed.has(layoutCenter)) positions.set(layoutCenter, [0, 0, 0])
        for (const layer of layers) {
          const ids = [...allowed].filter(id => depth.get(id) === layer && id !== layoutCenter)
          ids.forEach((id, i) => {
            const angle = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, ids.length)
            const radius = layer === 0 ? 380 : 320 * layer
            positions.set(id, [radius * Math.cos(angle), radius * Math.sin(angle), 0])
          })
        }
      }
    }
    const nodes: GraphNode[] = sourceNodes.filter(n => allowed.has(n.id)).map(n => {
      const [x, y, z] = positions.get(n.id) ?? [0, 0, 0]
      return { ...n, x, y, z, fx: x, fy: y, fz: z }
    })
    const links: GraphLink[] = sourceLinks.filter(l =>
      !hiddenLinks.includes(l.id) && allowed.has(l.source) && allowed.has(l.target)
    ).map(l => ({ ...l }))
    return { nodes, links }
  }, [sourceNodes, sourceLinks, layoutVersion, layoutCenterId, layoutMode, hiddenNodes, hiddenLinks])

  const selectedNode = sourceNodes.find(n => n.id === selectedNodeId)
  const selectedLink = sourceLinks.find(l => l.id === selectedLinkId)
  // One neutral highlight for every reference connected to the selected object.
  // Direction remains available in the inspector, not through line color.
  const relationshipColor = (link: GraphLink): string => {
    if (selectedLinkId === link.id) return '#f8fafc'
    if (!selectedNodeId) return '#a5b2c4'
    return endId(link.source) === selectedNodeId || endId(link.target) === selectedNodeId
      ? '#e2e8f0'
      : '#526174'
  }
  const relationshipActive = (link: GraphLink): boolean =>
    selectedLinkId === link.id ||
    !!selectedNodeId && (endId(link.source) === selectedNodeId || endId(link.target) === selectedNodeId)

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
    draggingFocusedNode.current = false
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
      if (id && graph && !draggingFocusedNode.current) {
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
  function switchMode(next: ExplorerMode) {
    if (next === mode) return
    cancelFit()
    stopFocus()
    const initial = (next === 'model' ? parsed?.model.nodes : parsed?.product.nodes)?.[0]?.id ?? ''
    setMode(next)
    setSelectedNodeId(initial || null)
    setSelectedLinkId(null)
    setLayoutCenterId(initial)
    setHiddenNodes([])
    setHiddenLinks([])
    setSearch('')
    setExpanded([])
    setLayoutVersion(previous => previous + 1)
  }

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
    setLayoutVersion(previous => previous + 1)
    setSelectedLinkId(null)
  }
  function centerOnNode(id: string) {
    setHiddenNodes(previous => previous.filter(hiddenId => hiddenId !== id))
    setSelectedNodeId(id)
    setSelectedLinkId(null)
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
    if (layoutMode !== 'spider') return
    centerOnNode(id)
    setLayoutCenterId(id)
    focusRef.current = id
    lastFocusPosition.current = null
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

  function handleNodeDrag(node: GraphNode) {
    if (focusRef.current === node.id) {
      // Do not move the camera while the drag library projects pointer movement.
      draggingFocusedNode.current = true
    }
  }

  function handleDragEnd(node: GraphNode) {
    if (focusRef.current === node.id) {
      // Resume following from the new position, without applying drag delta.
      lastFocusPosition.current = new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0)
      draggingFocusedNode.current = false
    }
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
      <button className="icon-button copy-object-button" title={copiedId === node.id ? `Copied ID: ${node.id}` : `Copy object ID: ${node.id}`} aria-label={`Copy ID of ${node.name}`} onClick={() => copyObjectId(node.id)}>{copiedId === node.id ? <Check size={14} /> : <Copy size={14} />}</button>
      {layoutMode === 'spider' && <button className={`icon-button ${focusedId === node.id ? 'active' : ''}`} disabled={hidden} title="Focus object" aria-label={`Focus ${node.name}`} onClick={() => focusedId === node.id ? stopFocus() : focusNode(node.id)}>{focusedId === node.id ? <PinOff size={14} /> : <Pin size={14} />}</button>}
    </div>
  }
  function linkRow(link: StepLink) {
    const hidden = hiddenLinks.includes(link.id)
    return <div className={`object-row ${hidden ? 'is-hidden' : ''}`} key={link.id}>
      <button className={`object-item ${selectedLinkId === link.id ? 'selected' : ''}`} onClick={() => selectLink(link.id)}>
        <ArrowLeftRight size={13} className="reference-icon" /><span className="object-info"><strong>{link.label}{mode === 'model' && link.count ? ` ×${link.count}` : ''}</strong><small title={`${link.source} → ${link.target}`}>{link.source} → {link.target}</small></span>
      </button>
      <button className="icon-button" title={hidden ? 'Show relationship' : 'Hide relationship'} aria-label={hidden ? `Show ${link.label}` : `Hide ${link.label}`} onClick={() => toggleLink(link.id)}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
    </div>
  }

  const outgoingReferences = selectedNode ? sourceLinks.filter(link => link.source === selectedNode.id && link.kind !== 'hierarchy' && link.kind !== 'container') : []
  const incomingReferences = selectedNode ? sourceLinks.filter(link => link.target === selectedNode.id && link.kind !== 'hierarchy' && link.kind !== 'container') : []
  const structuralLinks = selectedNode ? sourceLinks.filter(link => (link.source === selectedNode.id || link.target === selectedNode.id) && (link.kind === 'hierarchy' || link.kind === 'container')) : []

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

  return <div className={`orbit theme-${theme}`}>
    <aside className="sidebar">
      <div className="brand"><svg className="orbit-brand-mark" viewBox="0 0 64 64" role="img" aria-label="Orbit cube logo"><defs><linearGradient id="orbit-logo-purple" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#C4A1FF"/><stop offset="1" stopColor="#9146FF"/></linearGradient></defs><path d="M32 5 56 18.5V45.5L32 59 8 45.5V18.5Z" fill="#251B36" stroke="url(#orbit-logo-purple)" strokeWidth="4" strokeLinejoin="round"/><path d="M8 18.5 32 32 56 18.5M32 32V59" fill="none" stroke="#B58AFF" strokeWidth="3.5" strokeLinejoin="round"/><path d="M32 5 56 18.5 32 32 8 18.5Z" fill="#9146FF" fillOpacity=".33"/><path d="M32 32 56 18.5V45.5L32 59Z" fill="#7134C6" fillOpacity=".35"/></svg><span className="orbit-brand-wordmark">ORBIT</span></div>
      <div className="orbit-view-selector" aria-label="Viewer and layout settings">
        <div className="orbit-mode-switch" role="group" aria-label="Explorer mode">
          <button type="button" className={mode === 'model' ? 'active' : ''} aria-pressed={mode === 'model'} onClick={() => switchMode('model')}>Data Model</button>
          <button type="button" className={mode === 'product' ? 'active' : ''} aria-pressed={mode === 'product'} onClick={() => switchMode('product')}>Product Explorer</button>
        </div>
        <div className="orbit-layout-switch" role="group" aria-label="Graph layout">
          <button type="button" className={layoutMode === 'spider' ? 'active' : ''} aria-pressed={layoutMode === 'spider'} onClick={() => { if (layoutMode !== 'spider') { stopFocus(); setLayoutMode('spider') } }} title="Radial graph layout">Spider</button>
          <button type="button" className={layoutMode === 'hierarchy' ? 'active' : ''} aria-pressed={layoutMode === 'hierarchy'} onClick={() => { if (layoutMode !== 'hierarchy') { stopFocus(); setLayoutMode('hierarchy') } }} title="Parent-child graph layout">Hierarchy</button>
        </div>
      </div>
      <div className="stepxml-source">
        <div className="stepxml-source-heading"><span>LOCAL STEPXML</span><div className="local-file-actions"><button type="button" onClick={() => filePickerRef.current?.click()} title="Open local XML files" aria-label="Open local XML files"><FileCode2 size={15} /></button><button type="button" onClick={() => folderPickerRef.current?.click()} title="Open local XML folder" aria-label="Open local XML folder"><FolderOpen size={15} /></button></div></div>
        <input ref={filePickerRef} className="local-file-input" type="file" accept=".xml,text/xml,application/xml" multiple onChange={e => { importLocalFiles(e.target.files, false); e.target.value = '' }} />
        <input ref={element => { folderPickerRef.current = element; if (element) element.setAttribute('webkitdirectory', '') }} className="local-file-input" type="file" multiple onChange={e => { importLocalFiles(e.target.files, true); e.target.value = '' }} />
        <div className="stepxml-tree" role="tree" aria-label="STEPXML files">{renderXmlFolder('', 0)}</div>
        {xmlListError && <p className="stepxml-error" role="alert">{xmlListError}</p>}
        {xmlError && <p className="stepxml-error" role="alert">{xmlError}</p>}
      </div>
      <div className="search-box"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ID, name, type..." aria-label="Search STEP objects" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</div>
      <div className="explorer-actions"><button onClick={() => { setHiddenNodes([]); setHiddenLinks([]) }} title="Show all" aria-label="Show all"><Eye size={15} /></button><button onClick={() => { stopFocus(); setHiddenNodes(sourceNodes.map(n => n.id)); setHiddenLinks(sourceLinks.map(l => l.id)) }} title="Hide all" aria-label="Hide all"><EyeOff size={15} /></button></div>
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
      {layoutMode === 'spider' && focusedNode && <div className="focus-status"><div className="focus-heading"><Pin size={13} /> FOCUS MODE</div><strong>{focusedNode.name}</strong><small>{focusedNode.id}</small><button onClick={stopFocus}>Release focus</button></div>}
    </aside>
    <main className="graph" ref={containerRef}>
      <div ref={toolbarRef} className={`graph-controls dock-${toolbarCorner} ${toolbarDrag ? 'is-dragging' : ''}`} style={toolbarDrag ? { left: toolbarDrag.left, top: toolbarDrag.top, right: 'auto', bottom: 'auto' } : undefined} aria-label="Graph display and navigation controls">
        <button type="button" className="toolbar-drag-handle" title="Drag to move toolbar; releases at nearest corner" aria-label="Drag toolbar to a corner" onPointerDown={beginToolbarDrag} onPointerMove={moveToolbarDrag} onPointerUp={endToolbarDrag} onPointerCancel={endToolbarDrag}><GripVertical size={17} /></button>
        <button type="button" className={`orbit-label-toggle ${showLinkLabels ? 'active' : ''}`} onClick={() => setShowLinkLabels(value => !value)} title={showLinkLabels ? 'Hide relationship labels' : 'Show relationship labels'} aria-label={showLinkLabels ? 'Hide relationship labels' : 'Show relationship labels'} aria-pressed={showLinkLabels}><Tags size={18} /></button>
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
      <div className="stellar-static-grid" aria-hidden="true" />
      <ForceGraph3D<GraphNode, GraphLink>
        key={`${mode}:${xmlName}:${fontsReady}:${layoutMode}:${layoutVersion}`} ref={graphRef} graphData={graphData} width={dimensions.width} height={dimensions.height}
        backgroundColor={THEME_META[theme].background} showNavInfo={false} enableNodeDrag={true}
        nodeRelSize={7} nodeColor={n => selectedNodeId && !adjacentIds.has(n.id) ? '#475569' : n.color}
        nodeOpacity={0.95} nodeLabel={n => `${n.name} (${n.id})`}
        nodeThreeObject={n => makeNodeVisual(n, labelSize, mode, selectedNodeId === n.id)}
        nodeThreeObjectExtend={true}
        linkColor={relationshipColor}
        linkWidth={0}
        linkOpacity={0}
        linkDirectionalParticles={0}
        linkLabel={l => mode === 'model' ? `${l.label} ×${l.count ?? 1}` : l.label}
        linkThreeObject={l => makeRelationshipVisual(mode === 'model' ? `${l.label} ×${l.count ?? 1}` : l.label, relationshipColor(l), labelSize, theme, showLinkLabels, relationshipActive(l))}
        linkThreeObjectExtend={false}
        linkPositionUpdate={(obj, positions) => {
          const relationship = obj as THREE.Group & { setEndpoints?: (a: THREE.Vector3, b: THREE.Vector3) => void }
          relationship.setEndpoints?.(new THREE.Vector3(positions.start.x, positions.start.y, positions.start.z), new THREE.Vector3(positions.end.x, positions.end.y, positions.end.z))
          return true
        }}
        onNodeClick={n => selectNode(n.id)} onLinkClick={l => selectLink(l.id)} onNodeDrag={handleNodeDrag} onNodeDragEnd={handleDragEnd}
      />
    </main>
    <aside className="details inspector">
      <div className="inspector-header"><h3>{mode === 'model' ? 'Type Details' : 'Object Details'}</h3><span className="inspector-subheading">{mode === 'model' ? 'Observed type relationships' : 'STEP Object Inspector'}</span></div>
      {selectedNode ? <>
        <div className="inspector-properties">
          <div className="inspector-property"><div className="section-title">ID</div><div className="inspector-value inspector-value-id">{selectedNode.id}</div></div>
          <div className="inspector-property"><div className="section-title">NAME</div><div className="inspector-value inspector-value-name">{selectedNode.name}</div></div>
          <div className="inspector-property"><div className="section-title">{mode === 'model' ? 'DEFINITION TYPE' : 'OBJECT TYPE'}</div><span className="inspector-type"><span className="type-dot" style={{ background: selectedNode.color }} />{selectedNode.type}</span></div>
          {mode === 'model' && <div className="inspector-property"><div className="section-title">INSTANCES IN XML</div><div className="inspector-value">{selectedNode.count ?? 0}</div></div>}
          {mode === 'product' && selectedNode.attributes && Object.keys(selectedNode.attributes).length > 0 && <div className="inspector-property"><div className="section-title">ATTRIBUTES</div>{Object.entries(selectedNode.attributes).map(([key, values]) => <div className="inspector-attribute" key={key}><span className="inspector-attribute-key">{key}</span><span className="inspector-attribute-value">{values.join(', ')}</span></div>)}</div>}
        </div>
        <section className="inspector-group"><div className="inspector-group-heading"><h4>References</h4><span>{outgoingReferences.length}</span></div><p className="inspector-group-caption">Outgoing references</p>{outgoingReferences.length ? outgoingReferences.map(link => referenceCard(link, 'outgoing')) : <p className="inspector-empty">No outgoing references</p>}</section>
        <section className="inspector-group"><div className="inspector-group-heading"><h4>Referenced By</h4><span>{incomingReferences.length}</span></div><p className="inspector-group-caption">Incoming references</p>{incomingReferences.length ? incomingReferences.map(link => referenceCard(link, 'incoming')) : <p className="inspector-empty">No incoming references</p>}</section>
        {structuralLinks.length > 0 && <section className="inspector-group"><div className="inspector-group-heading"><h4>Structure &amp; Containers</h4><span>{structuralLinks.length}</span></div>{structuralLinks.map(link => referenceCard(link, link.source === selectedNode.id ? 'outgoing' : 'incoming'))}</section>}
      </> : selectedLink ? <>
        <div className="inspector-properties">
          <div className="inspector-property"><div className="section-title">RELATIONSHIP TYPE</div><div className="inspector-value">{selectedLink.label}</div></div>
          <div className="inspector-property"><div className="section-title">RELATIONSHIP ID</div><div className="inspector-value inspector-value-id">{selectedLink.id}</div></div>
          {mode === 'model' && <div className="inspector-property"><div className="section-title">OBSERVED CONNECTIONS</div><div className="inspector-value">{selectedLink.count ?? 1}</div></div>}
        </div>
        <section className="inspector-group"><div className="inspector-group-heading"><h4>Source</h4></div>{referenceCard(selectedLink, 'incoming')}</section>
        <section className="inspector-group"><div className="inspector-group-heading"><h4>Target</h4></div>{referenceCard(selectedLink, 'outgoing')}</section>
      </> : <p className="muted">Select an object or relationship to inspect it.</p>}
    </aside>
  </div>
}
export default App
