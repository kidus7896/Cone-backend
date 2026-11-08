import { describe, expect, it } from "vitest";
import { buildCategoryTree, withDescendants } from "../src/listings/categories";

const rows = [
  { id: "v", parentId: null, name: "Vehicles", slug: "vehicles", order: 1, fields: [] },
  { id: "cars", parentId: "v", name: "Cars", slug: "cars", order: 1, fields: [{ key: "make", label: "Make", type: "text" }] },
  { id: "bikes", parentId: "v", name: "Motorcycles", slug: "motorcycles", order: 2, fields: null },
  { id: "o", parentId: null, name: "Other", slug: "other", order: 99, fields: [] },
  { id: "orphan", parentId: "inactive-parent", name: "Orphan", slug: "orphan", order: 1, fields: [] },
];

describe("buildCategoryTree", () => {
  it("nests children under their parents", () => {
    const tree = buildCategoryTree(rows);
    expect(tree.map((n) => n.id)).toEqual(["v", "o"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["cars", "bikes"]);
  });
  it("hides children whose parent is missing", () => {
    const ids = JSON.stringify(buildCategoryTree(rows));
    expect(ids.includes("orphan")).toBe(false);
  });
  it("treats non-array fields as empty", () => {
    const bikes = buildCategoryTree(rows)[0].children[1];
    expect(bikes.fields).toEqual([]);
  });
});

describe("withDescendants", () => {
  it("includes the category and everything beneath it", () => {
    expect(withDescendants("v", rows).sort()).toEqual(["bikes", "cars", "v"]);
  });
  it("returns just the id for a leaf or unknown id", () => {
    expect(withDescendants("cars", rows)).toEqual(["cars"]);
    expect(withDescendants("nope", rows)).toEqual(["nope"]);
  });
  it("survives a cycle in bad data", () => {
    const cyclic = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(withDescendants("a", cyclic).sort()).toEqual(["a", "b"]);
  });
});
