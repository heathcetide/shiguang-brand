import { buildRefreshedFeed } from "./feed";

describe("buildRefreshedFeed", () => {
  const latest = [6, 5, 4, 3, 2, 1].map((id) => ({ id }));
  const recommended = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((id) => ({ id }));

  it("pins the newest posts and removes duplicates", () => {
    const result = buildRefreshedFeed(recommended, latest, 1);

    expect(result.slice(0, 3).map((item) => item.id)).toEqual([6, 5, 4]);
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
  });

  it("rotates deterministic recommendations on later refreshes", () => {
    const first = buildRefreshedFeed(recommended, latest, 1).map((item) => item.id);
    const second = buildRefreshedFeed(recommended, latest, 2).map((item) => item.id);

    expect(second.slice(0, 3)).toEqual(first.slice(0, 3));
    expect(second.slice(3)).not.toEqual(first.slice(3));
  });

  it("keeps the first copy of each post and supports missing feeds", () => {
    const first = { id: 1, title: "first" };
    const duplicate = { id: 1, title: "duplicate" };
    expect(buildRefreshedFeed([duplicate], [first, duplicate], 1)).toEqual([first]);
    expect(buildRefreshedFeed([first, duplicate], null, 1)).toEqual([first]);
    expect(buildRefreshedFeed(undefined, undefined, 1)).toEqual([]);
  });
});
