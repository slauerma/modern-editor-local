import type { ProjectFolderAccess } from '../shared/references.ts';
import { InfoHint } from './CommentDetails.tsx';

export function ProjectFolderControl({ folder, disabled, onChange, compact = false }: {
  folder?: ProjectFolderAccess; disabled: boolean; onChange(enabled: boolean): void; compact?: boolean;
}) {
  return <div className="project-folder-access">
    <label title={folder ? `Read access to ${folder.name} and its subfolders` : undefined}><input type="checkbox" checked={folder?.enabled ?? true} disabled={disabled || !folder}
      onChange={event => onChange(event.target.checked)} />{compact ? 'Codex can read this folder' : 'Codex can read this folder and subfolders'}</label>
    <InfoHint label="Codex folder access">
      {folder ? `Folder: ${folder.name}. ` : 'Loading this paper’s saved choice. '}
      Read-only access for reviews and discussions, on by default and remembered for this paper.
      Codex reads relevant files when needed; the folder is not sent wholesale.
      The current unsaved draft stays available when this is off. Separately attached references keep their own settings.
      Supports TeX, bibliography/style files, ordinary text/data files and PDF text.
      Hidden, generated and linked files are excluded; images and other binary files are not read.
      Reading limits and incomplete coverage appear in Sources used. Quick shortcuts can read the draft and saved context, but not other folders.
    </InfoHint>
    {folder && !folder.available && <span role="status">Folder unavailable</span>}
  </div>;
}
