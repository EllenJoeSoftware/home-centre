import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiUrl, buildQuery, playbackSource, setUnauthorizedHandler, urls } from "./client";
import { setToken } from "./token";

afterEach(() => {
  setToken(null);
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe("URL building", () => {
  it("buildQuery skips empty values", () => {
    expect(buildQuery({})).toBe("");
    expect(buildQuery({ a: 1, b: undefined, c: null, d: "", e: "x y" })).toBe("?a=1&e=x+y");
  });

  it("apiUrl prefixes /api", () => {
    expect(apiUrl("/media", { kind: "video", offset: 0 })).toBe("/api/media?kind=video&offset=0");
    expect(apiUrl("libraries")).toBe("/api/libraries");
  });

  it("media urls carry the token as a query param", () => {
    setToken("abc.def");
    expect(urls.stream("123")).toBe("/api/media/123/stream?token=abc.def");
    expect(urls.thumbnail("123", 320)).toBe("/api/media/123/thumbnail?w=320&token=abc.def");
    expect(urls.subtitle("123", "en/1")).toBe("/api/media/123/subtitles/en%2F1?token=abc.def");
    expect(urls.hls("123", 90.7)).toBe("/api/media/123/transcode.m3u8?start=90&token=abc.def");
    expect(urls.hls("123")).toBe("/api/media/123/transcode.m3u8?token=abc.def");
  });

  it("playbackSource follows the playback rule", () => {
    setToken("t");
    expect(playbackSource({ id: "a", kind: "video", directPlayable: true })).toEqual({
      url: "/api/media/a/stream?token=t",
      type: "direct",
    });
    expect(playbackSource({ id: "a", kind: "video", directPlayable: false }, 30).type).toBe("hls");
  });
});

describe("request", () => {
  it("sends bearer token and parses JSON", async () => {
    setToken("tok");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 1, username: "a", isAdmin: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const me = await api.me();
    expect(me.username).toBe("a");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/me");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("calls the unauthorized handler on 401 and throws ApiError", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 401 })));
    await expect(api.libraries()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("login 401 does not trigger redirect", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 })));
    await expect(api.login("a", "b")).rejects.toThrow("Invalid credentials");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("library management endpoints", () => {
  const capture = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return () => fetchMock.mock.calls.map((c) => c as unknown as [string, RequestInit]);
  };

  it("uses the documented methods, paths and bodies", async () => {
    setToken("tok");
    const calls = capture(200, {});
    await api.fsRoots();
    await api.fsBrowse("/host/Movies & TV");
    await api.createLibrary({ path: "/host/Movies", name: "Films" });
    await api.updateLibrary("abc", { path: "/host/Music" });
    await api.deleteLibrary("abc");
    expect(calls().map(([url, init]) => [init.method, url, init.body ?? null])).toEqual([
      ["GET", "/api/fs/roots", null],
      ["GET", "/api/fs/browse?path=%2Fhost%2FMovies+%26+TV", null],
      ["POST", "/api/libraries", JSON.stringify({ path: "/host/Movies", name: "Films" })],
      ["PATCH", "/api/libraries/abc", JSON.stringify({ path: "/host/Music" })],
      ["DELETE", "/api/libraries/abc", null],
    ]);
  });

  it("surfaces server validation messages", async () => {
    capture(400, { error: 'This folder is inside the library "Movies" (/host/Movies)' });
    await expect(api.createLibrary({ path: "/host/Movies/Extras" })).rejects.toThrow(/inside the library/);
  });
});
