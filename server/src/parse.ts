/**
 * Pure filename parsing helpers: title cleaning, year and TV-series detection.
 */

export interface SeriesInfo {
  name: string;
  season: number;
  episode: number;
}

export interface ParsedName {
  title: string;
  year: number | null;
  series: SeriesInfo | null;
}

// Release-junk tokens. Everything from the first such token onward is discarded
// (only when it is not the very first word, so titles like "Remux" survive).
const JUNK =
  /(?:^|\s)(?:2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr|hdr10|dv|bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|hdtv|hdrip|dvdrip|dvdscr|dvd|x264|x265|h264|h265|h\.264|h\.265|hevc|avc|xvid|divx|10bit|8bit|remux|proper|repack|extended|unrated|limited|internal|multi|aac|aac2\.0|ac3|eac3|dts|dd5\.1|ddp5\.1|5\.1|7\.1|atmos|truehd|yify|yts|rarbg)(?=\s|$)/i;

const YEAR = /(?:^|[\s([])((?:19|20)\d{2})(?=$|[\s)\]])/g;

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Replace separators, drop bracketed tags and collapse whitespace. */
function normalise(s: string): string {
  let out = s;
  out = out.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  // Dots/underscores as word separators (keep dots inside things like "5.1" handled by JUNK anyway).
  out = out.replace(/[._]+/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function cutJunk(s: string): string {
  const m = JUNK.exec(s);
  if (m && m.index > 0) return s.slice(0, m.index);
  return s;
}

function tidy(s: string): string {
  return s
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–:,(]+|[\s\-–:,(]+$/g, '')
    .trim();
}

/** Clean a free-standing name fragment (used for series names, episode titles, folders). */
export function cleanFragment(s: string): string {
  return tidy(cutJunk(normalise(s)));
}

/** Extract the last plausible year (never at position 0, so "2001 A Space Odyssey" keeps its title). */
function splitYear(s: string): { before: string; year: number | null } {
  let last: RegExpExecArray | null = null;
  YEAR.lastIndex = 0;
  for (let m = YEAR.exec(s); m; m = YEAR.exec(s)) {
    const yearIndex = m.index + m[0].indexOf(m[1]!);
    if (yearIndex > 0) last = m;
  }
  if (!last) return { before: s, year: null };
  const y = Number.parseInt(last[1]!, 10);
  const yearIndex = last.index + last[0].indexOf(last[1]!);
  return { before: s.slice(0, yearIndex), year: y };
}

const SXXEYY = /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})(?:[\s._-]*e\d{1,3})*(?=[^0-9]|$)/i;
const NXNN = /(?:^|[^0-9a-z])(\d{1,2})x(\d{2,3})(?=[^0-9]|$)/i;
const SEASON_FOLDER = /^(?:season|series|staffel|saison|temporada)[\s._-]*(\d{1,2})$|^s(\d{1,2})$/i;
const EPISODE_ONLY = /(?:^|[^a-z0-9])(?:e|ep|episode)[\s._-]*(\d{1,3})(?=[^0-9]|$)/i;

/** Pick the series name from folders, skipping "Season N" style folders. */
function seriesNameFromFolders(folderParts: string[]): string {
  for (let i = folderParts.length - 1; i >= 0; i--) {
    const part = folderParts[i]!;
    if (SEASON_FOLDER.test(part.trim()) || /^specials$/i.test(part.trim())) continue;
    const cleaned = cleanFragment(splitYear(normalise(part)).before);
    if (cleaned) return cleaned;
  }
  return '';
}

/**
 * Parse a media file name (with optional relative folder, "/" separated) into a display title,
 * a year and series information.
 */
export function parseMediaName(fileName: string, folder = '', kind: 'video' | 'audio' | 'image' = 'video'): ParsedName {
  const base = stripExtension(fileName);
  const folderParts = folder.split('/').filter((p) => p.length > 0);

  if (kind === 'video') {
    const norm = normalise(base);
    let m = SXXEYY.exec(norm);
    if (!m) m = NXNN.exec(norm);
    let season: number | null = null;
    let episode: number | null = null;
    let before = '';
    let after = '';
    if (m) {
      season = Number.parseInt(m[1]!, 10);
      episode = Number.parseInt(m[2]!, 10);
      const start = m.index + (m[0].length - m[0].replace(/^[^a-z0-9]/i, '').length);
      before = norm.slice(0, start);
      after = norm.slice(m.index + m[0].length);
    } else {
      // Folder-based: ".../Show/Season 2/Episode 05.mkv" or ".../Show/Season 2/05 - Title.mkv"
      const seasonFolder = folderParts.length > 0 ? SEASON_FOLDER.exec(folderParts[folderParts.length - 1]!.trim()) : null;
      if (seasonFolder) {
        const em = EPISODE_ONLY.exec(norm) ?? /^(\d{1,3})(?=\s|-|$)/.exec(norm);
        if (em) {
          season = Number.parseInt((seasonFolder[1] ?? seasonFolder[2])!, 10);
          episode = Number.parseInt(em[1]!, 10);
          before = norm.slice(0, em.index);
          after = norm.slice(em.index + em[0].length);
        }
      }
    }

    if (season !== null && episode !== null) {
      let name = cleanFragment(splitYear(before).before);
      if (!name) name = seriesNameFromFolders(folderParts);
      if (!name) name = 'Unknown Series';
      const epTitle = cleanFragment(after);
      const code = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
      const title = epTitle ? `${name} ${code} - ${epTitle}` : `${name} ${code}`;
      return { title, year: null, series: { name, season, episode } };
    }

    const { before: preYear, year } = splitYear(norm);
    let title = tidy(cutJunk(preYear));
    if (!title) title = tidy(norm) || base;
    return { title, year, series: null };
  }

  // Audio / image: just clean separators, keep everything else.
  let source = base;
  if (kind === 'audio') {
    // "01 - Song Name" / "01. Song" / "01 Song" → "Song Name"
    source = base.replace(/^(?:\d{1,3}\s*[-–.]|0\d\s|\d-\d{2}\s*[-–.]?)\s*(?=\S)/, '') || base;
  }
  const title = tidy(normalise(source));
  return { title: title || base, year: null, series: null };
}
