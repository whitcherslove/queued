export type Section = 'movies' | 'tv' | 'console' | 'pc' | 'retro';
export type Status = 'backlog' | 'playing' | 'done' | 'dropped';

export interface Title {
  id: string; kind: 'movie' | 'tv' | 'game'; source: string; source_id: string; imdb_id: string | null;
  title: string; release_date: string | null; year: number | null; runtime: number | null;
  directors: string[]; genres: string[]; overview: string | null;
  poster_url: string | null; backdrop_url: string | null; metascore: number | null; imdb_rating: number | null;
  data: Record<string, unknown>;
}

export type Overrides = Partial<Pick<Title, 'title' | 'release_date' | 'runtime' | 'directors' | 'genres' | 'metascore' | 'imdb_rating'>>;

export interface LibItem {
  id: string; title_id: string; section: Section; status: Status; up_next: boolean; position: number;
  tier: string | null; score: number | null; rewatch?: boolean; overrides: Overrides; title: Title;
}

export interface ItemLog { id: string; watched_at: string; tier: string | null; score: number | null; rewatch: boolean }
export interface ChatMsg { id: string; role: 'user' | 'model'; content: string; created_at: string; pending?: boolean }
export interface CollectionPart { sourceId: string; title: string; year: number; posterUrl: string | null }

export interface LogRow {
  id: string; library_id: string; scope: 'item' | 'season' | 'seasons' | 'show'; season_from: number | null; season_to: number | null;
  watched_at: string; tier: string | null; score: number | null; rewatch: boolean; position: number | null;
  library: LibItem;
}

export interface SearchHit { sourceId: string; title: string; year: number | null; releaseDate: string | null; posterUrl: string | null }
