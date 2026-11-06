// A STEPXML product export is instance data. The type graph below describes
// relationships OBSERVED in that export, not all relationships permitted by STEP.
export type Category = 'products' | 'entities' | 'containers'
export type StepNode = { id: string; name: string; type: string; category: Category; color: string; attributes?: Record<string, string[]>; unresolved?: boolean; count?: number }
export type StepLink = { id: string; source: string; target: string; label: string; count?: number; kind?: 'reference' | 'hierarchy' | 'container' }
export type StepGraph = { nodes: StepNode[]; links: StepLink[] }
export type ParsedStepXml = { product: StepGraph; model: StepGraph; warnings: string[] }

const colors: Record<string, string> = { CU: '#38bdf8', TU: '#a78bfa', SU: '#818cf8', 'Supplier Item': '#fbbf24', GTIN: '#34d399', 'Data Container': '#f472b6' }
const local = (el: Element) => el.localName || el.tagName.split(':').pop() || ''
const children = (el: Element) => Array.from(el.children)
const attr = (el: Element, ...keys: string[]) => keys.map(k => el.getAttribute(k)).find(Boolean) || ''
const clean = (v: string) => v.trim()
function classify(tag: string, type: string): Category {
  if (tag === 'DataContainer') return 'containers'
  if (tag === 'Entity' || tag === 'Classification') return 'entities'
  return type.toLowerCase().includes('container') ? 'containers' : 'products'
}
function typeColor(type: string, category: Category) {
  if (/CU|ConsumerUnit/i.test(type)) return colors.CU
  if (/TU|TradeUnit/i.test(type)) return colors.TU
  if (/SupplierItem/i.test(type)) return colors['Supplier Item']
  if (/GTIN/i.test(type)) return colors.GTIN
  return category === 'containers' ? colors['Data Container'] : category === 'entities' ? '#34d399' : '#818cf8'
}
function findName(el: Element): string {
  const direct = children(el).find(c => local(c) === 'Name')
  return clean(direct?.textContent || '') || attr(el, 'Name') || attr(el, 'ID')
}
function collectValues(el: Element): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const value of Array.from(el.getElementsByTagName('*'))) {
    if (local(value) !== 'Value') continue
    const parent = value.parentElement
    if (!parent || local(parent) !== 'Values') continue
    const key = attr(value, 'AttributeID', 'AttributeId', 'ID')
    if (!key) continue
    ;(result[key] ||= []).push(clean(value.textContent || ''))
  }
  return result
}
export function parseStepXml(xml: string): ParsedStepXml {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML: ' + (doc.querySelector('parsererror')?.textContent || 'parse error').slice(0, 160))
  const objectTags = new Set(['Product', 'Entity', 'Classification', 'DataContainer'])
  const nodes = new Map<string, StepNode>()
  const links: StepLink[] = []
  const warnings: string[] = []
  const pending: { source: string; target: string; label: string; kind: StepLink['kind'] }[] = []
  const all = Array.from(doc.getElementsByTagName('*'))
  // Only object elements with IDs are instances; nested Values/References are not.
  for (const el of all) {
    const tag = local(el)
    if (!objectTags.has(tag)) continue
    const id = attr(el, 'ID', 'Id')
    if (!id) continue
    const type = attr(el, 'UserTypeID', 'UserTypeId', 'Type', 'TypeID') || tag
    const category = classify(tag, type)
    nodes.set(id, { id, name: findName(el) || id, type, category, color: typeColor(type, category), attributes: collectValues(el) })
  }
  if (!nodes.size) throw new Error('No Product, Entity, Classification or DataContainer objects with IDs were found in this STEPXML.')
  for (const el of all) {
    const tag = local(el)
    if (!objectTags.has(tag)) continue
    const id = attr(el, 'ID', 'Id')
    if (!id || !nodes.has(id)) continue
    const parentId = attr(el, 'ParentID', 'ParentId')
    if (parentId) pending.push({ source: parentId, target: id, label: 'Hierarchy', kind: 'hierarchy' })
    // References may be nested under a References wrapper or directly under the object.
    // Restrict to this object's subtree, excluding child object subtrees.
    const walk = (element: Element) => {
      for (const child of children(element)) {
        const name = local(child)
        if (objectTags.has(name)) continue
        if (name === 'ProductCrossReference' || name === 'EntityCrossReference' || name === 'ClassificationCrossReference' || name === 'CrossReference' || name === 'Reference') {
          const target = attr(child, 'ProductID', 'EntityID', 'ClassificationID', 'TargetID', 'TargetId', 'ToID', 'ToId')
          const label = attr(child, 'Type', 'ReferenceType', 'ReferenceTypeID', 'TypeID') || name
          if (target) pending.push({ source: id, target, label, kind: 'reference' })
        } else if (name === 'DataContainer') {
          const containerId = attr(child, 'ID', 'Id')
          if (containerId) pending.push({ source: id, target: containerId, label: attr(child, 'Type', 'DataContainerTypeID') || 'Data Container', kind: 'container' })
        } else walk(child)
      }
    }
    walk(el)
    // A nested data container is an owned structure, not a normal cross-reference.
    for (const container of Array.from(el.getElementsByTagName('*')).filter(c => local(c) === 'DataContainer')) {
      const containerId = attr(container, 'ID', 'Id')
      if (containerId && nodes.has(containerId)) pending.push({ source: id, target: containerId, label: attr(container, 'Type', 'DataContainerTypeID') || 'Data Container', kind: 'container' })
    }
  }
  const unique = new Set<string>()
  for (const edge of pending) {
    if (!nodes.has(edge.source)) {
      // Parent objects outside the export are not assumed to have known types.
      warnings.push(`Missing source object: ${edge.source}`)
      continue
    }
    if (!nodes.has(edge.target)) {
      nodes.set(edge.target, { id: edge.target, name: 'Unresolved object', type: 'Unknown', category: 'entities', color: '#64748b', unresolved: true })
      warnings.push(`Unresolved reference target: ${edge.target}`)
    }
    const key = [edge.source, edge.target, edge.label, edge.kind].join('\u0000')
    if (unique.has(key)) continue
    unique.add(key)
    links.push({ id: `xml-rel-${links.length + 1}`, ...edge })
  }
  const product = { nodes: Array.from(nodes.values()), links }
  const modelNodes = new Map<string, StepNode>()
  for (const n of product.nodes) {
    if (n.unresolved) continue
    const key = `${n.category}:${n.type}`
    const existing = modelNodes.get(key)
    if (existing) existing.count = (existing.count || 0) + 1
    else modelNodes.set(key, { id: key, name: n.type, type: n.category === 'products' ? 'Product Type' : n.category === 'entities' ? 'Entity Type' : 'Data Container Type', category: n.category, color: n.color, count: 1 })
  }
  const grouped = new Map<string, StepLink>()
  for (const link of links) {
    const from = nodes.get(link.source), to = nodes.get(link.target)
    if (!from || !to || from.unresolved || to.unresolved) continue
    const source = `${from.category}:${from.type}`, target = `${to.category}:${to.type}`
    const key = JSON.stringify([source, target, link.label, link.kind])
    const existing = grouped.get(key)
    if (existing) existing.count = (existing.count || 1) + 1
    else grouped.set(key, { id: `type-rel-${grouped.size + 1}`, source, target, label: link.label, kind: link.kind, count: 1 })
  }
  return { product, model: { nodes: [...modelNodes.values()], links: [...grouped.values()] }, warnings: [...new Set(warnings)] }
}
