import { describe, expect, it } from 'vitest';
import { isDirectPlayable, kindForFile } from '../src/media.js';
import { parseMediaName } from '../src/parse.js';
import { srtToVtt } from '../src/routes/playback.js';
import { findSidecarSubtitles } from '../src/scanner.js';
import { parseRange } from '../src/stream.js';
import { buildVodPlaylist, rewritePlaylist } from '../src/transcode.js';

describe('parseMediaName: movies', () => {
  it.each([
    ['The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv', 'The Matrix', 1999],
    ['Blade Runner 2049 (2017).mp4', 'Blade Runner 2049', 2017],
    ['2001 A Space Odyssey (1968).mkv', '2001 A Space Odyssey', 1968],
    ['Inception_2010_720p_WEB-DL.mp4', 'Inception', 2010],
    ['[Group] Spirited Away (2001) [1080p].mkv', 'Spirited Away', 2001],
    ['Home Video.mov', 'Home Video', null],
    ['my_holiday_clip.mp4', 'my holiday clip', null],
  ])('%s → %s (%s)', (file, title, year) => {
    const r = parseMediaName(file, '', 'video');
    expect(r.title).toBe(title);
    expect(r.year).toBe(year);
    expect(r.series).toBeNull();
  });
});

describe('parseMediaName: series', () => {
  it('parses SxxEyy with episode title', () => {
    const r = parseMediaName('Breaking.Bad.S01E02.Cats.in.the.Bag.720p.HDTV.x264.mkv', 'TV/Breaking Bad/Season 1');
    expect(r.series).toEqual({ name: 'Breaking Bad', season: 1, episode: 2 });
    expect(r.title).toBe('Breaking Bad S01E02 - Cats in the Bag');
  });

  it('parses 1x02 notation', () => {
    const r = parseMediaName('The Office 2x05 - Halloween.avi');
    expect(r.series).toEqual({ name: 'The Office', season: 2, episode: 5 });
    expect(r.title).toBe('The Office S02E05 - Halloween');
  });

  it('falls back to folder name when the file only has the episode code', () => {
    const r = parseMediaName('S03E10.mkv', 'Shows/Severance (2022)/Season 03');
    expect(r.series).toEqual({ name: 'Severance', season: 3, episode: 10 });
  });

  it('detects season folder + episode number', () => {
    const r = parseMediaName('Episode 07.mp4', 'Shows/Dark/Season 2');
    expect(r.series).toEqual({ name: 'Dark', season: 2, episode: 7 });
  });

  it('handles lowercase and separators', () => {
    const r = parseMediaName('show_name_s2e3.mp4');
    expect(r.series).toEqual({ name: 'show name', season: 2, episode: 3 });
  });

  it('does not treat resolutions or codecs as episodes', () => {
    expect(parseMediaName('Movie.1920x1080.x264.mkv').series).toBeNull();
    expect(parseMediaName('Some Film 2012 h264.mp4').series).toBeNull();
  });
});

describe('parseMediaName: audio & images', () => {
  it('strips track numbers', () => {
    expect(parseMediaName('01 - Come Together.mp3', '', 'audio').title).toBe('Come Together');
    expect(parseMediaName('07. Something.flac', '', 'audio').title).toBe('Something');
  });
  it('cleans image names', () => {
    expect(parseMediaName('IMG_2024_beach.jpg', '', 'image').title).toBe('IMG 2024 beach');
  });
});

describe('media helpers', () => {
  it('classifies extensions', () => {
    expect(kindForFile('a.MKV')).toBe('video');
    expect(kindForFile('a.flac')).toBe('audio');
    expect(kindForFile('a.heic')).toBe('image');
    expect(kindForFile('a.txt')).toBeNull();
  });
  it('decides direct playability', () => {
    expect(isDirectPlayable('video', 'a.mp4', 'h264', 'aac')).toBe(true);
    expect(isDirectPlayable('video', 'a.mp4', 'h264', 'ac3')).toBe(false);
    expect(isDirectPlayable('video', 'a.mkv', 'h264', 'aac')).toBe(false);
    expect(isDirectPlayable('video', 'a.webm', 'vp9', 'opus')).toBe(true);
    expect(isDirectPlayable('audio', 'a.flac', null, 'flac')).toBe(true);
    expect(isDirectPlayable('audio', 'a.wma', null, 'wmav2')).toBe(false);
  });
});

describe('sidecar subtitles', () => {
  it('matches base, language and forced variants only', () => {
    const subs = findSidecarSubtitles('/m', 'Movie (2020).mkv', [
      'Movie (2020).mkv',
      'Movie (2020).srt',
      'Movie (2020).en.srt',
      'Movie (2020).fr.forced.vtt',
      'Other.srt',
      'Movie (2020) extras.srt',
    ]);
    expect(subs.map((s) => [s.language, s.format, s.label]).sort()).toEqual(
      [
        [null, 'srt', 'Default'],
        ['en', 'srt', 'EN'],
        ['fr', 'vtt', 'FR (Forced)'],
      ].sort(),
    );
    expect(new Set(subs.map((s) => s.id)).size).toBe(3);
  });
});

describe('srtToVtt', () => {
  it('converts timestamps and adds header', () => {
    const vtt = srtToVtt('﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n');
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500');
    expect(vtt).not.toContain('\r');
  });
});

describe('parseRange', () => {
  it('handles common forms', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-1', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
    expect(parseRange('bytes=0-1, 5-6', 100)).toEqual({ start: 0, end: 1 });
  });
});

describe('HLS playlists', () => {
  it('builds a VOD playlist with tokenised relative segment URLs', () => {
    const pl = buildVodPlaylist('abc', 10, 3, '?token=t', null);
    expect(pl).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(pl).toContain('hls/abc/0.ts?token=t');
    expect(pl).toContain('hls/abc/2.ts?token=t');
    expect(pl).toContain('#EXTINF:2.000000,');
    expect(pl.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });
  it('rewrites URIs', () => {
    expect(rewritePlaylist('#EXTM3U\n#EXTINF:4,\n0.ts\n1.ts?x=1\n', '?token=a')).toBe(
      '#EXTM3U\n#EXTINF:4,\n0.ts?token=a\n1.ts?x=1&token=a\n',
    );
  });
});
