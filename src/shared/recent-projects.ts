export type RecentProject = { id: string; name: string; path: string; openedAt: string; available: boolean };
export type RecentProjects = { items: RecentProject[]; notices: string[] };
