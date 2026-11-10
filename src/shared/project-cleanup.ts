export type CleanupFile = {
  path: string; bytes: number; modifiedAt: string; purpose: string;
  action: 'remove' | 'reset';
};
export type CleanupPreview = {
  id: string; projectId: string; paperPath: string; createdAt: string;
  archivePath: string; files: CleanupFile[]; bytes: number;
  kept: { path: string; reason: string }[];
  mode?: CleanupMode; papers?: string[];
};
export type CleanupResult = { archivePath: string; removed: number; reset: number; warning?: string };
export type CleanupMode = 'temporary' | 'forget';
export type CleanupPaper = { id: string; path: string; name: string; bytes: number; lastActivity: string | null; current: boolean; problem?: string };
export type CleanupPapers = { papers: CleanupPaper[]; notices: string[] };
