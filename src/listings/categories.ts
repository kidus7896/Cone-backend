// Pure helpers for the category and area trees (no database access).

export interface CategoryField {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  required?: boolean;
}

export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  order: number;
  fields: unknown;
}

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  order: number;
  fields: CategoryField[];
  children: CategoryNode[];
}

export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      slug: row.slug,
      order: row.order,
      fields: Array.isArray(row.fields) ? (row.fields as CategoryField[]) : [],
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    // A child whose parent is missing or inactive is hidden rather than shown as a root.
    if (parent) parent.children.push(node);
    else if (!node.parentId) roots.push(node);
  }
  return roots;
}

// The id itself plus every descendant id. Used so "Vehicles" also finds listings in "Cars".
export function withDescendants(
  rootId: string,
  rows: { id: string; parentId: string | null }[]
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row.id);
    childrenOf.set(row.parentId, list);
  }
  const result: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue; // guards against a bad cycle in the data
    seen.add(id);
    result.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}
