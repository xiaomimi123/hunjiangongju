export type TagNode = { id: string; name: string; parentId: string | null; sortOrder: number }

export function buildTree(nodes: TagNode[]): (TagNode & { children: TagNode[] })[] {
  const roots = nodes.filter((n) => !n.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
  return roots.map((r) => ({
    ...r,
    children: nodes.filter((n) => n.parentId === r.id).sort((a, b) => a.sortOrder - b.sortOrder),
  }))
}

export function flattenWithDepth(nodes: TagNode[]): (TagNode & { depth: number })[] {
  return buildTree(nodes).flatMap((r) => [
    { ...r, depth: 0 },
    ...r.children.map((c) => ({ ...c, depth: 1 })),
  ])
}
