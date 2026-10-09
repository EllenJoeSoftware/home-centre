import { describe, expect, it } from "vitest";
import { baseName, crumbsFor, parentPath } from "./paths";

const roots = [
  { name: "Media", path: "/media" },
  { name: "host", path: "/host" },
  { name: "Films", path: "/host/Films" },
];

describe("paths", () => {
  it("builds breadcrumbs from the longest matching root", () => {
    expect(crumbsFor("/host", roots)).toEqual([{ label: "host", path: "/host" }]);
    expect(crumbsFor("/host/Music/Jazz", roots)).toEqual([
      { label: "host", path: "/host" },
      { label: "Music", path: "/host/Music" },
      { label: "Jazz", path: "/host/Music/Jazz" },
    ]);
    expect(crumbsFor("/host/Films/2020", roots).map((c) => c.label)).toEqual(["Films", "2020"]);
    expect(crumbsFor("/hostile", roots)).toEqual([{ label: "/hostile", path: "/hostile" }]);
    expect(crumbsFor("/x/y", [{ name: "/", path: "/" }]).map((c) => c.path)).toEqual(["/", "/x", "/x/y"]);
  });

  it("derives base and parent names", () => {
    expect(baseName("/host/Movies/")).toBe("Movies");
    expect(parentPath("/host/Movies")).toBe("/host");
    expect(parentPath("/host")).toBe("/");
    expect(parentPath("/")).toBeNull();
  });
});
