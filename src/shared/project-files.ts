export type ProjectFile = { id: string; name: string; group: 'Paper' | 'Saved state' | 'Context & chat' | 'PDFs'; path: string; bytes: number; modified: string; directory: boolean };
export type ProjectFiles = { items: ProjectFile[]; notices: string[] };
export type PdfExport = { path: string; purpose: string; sourceHash: string };
