/** The project folder the workbench works in (chosen in the Code tab). */
export interface Workspace {
  /** Absolute path to the folder. */
  path: string;
  /** Folder name shown in the UI. */
  name: string;
  /** Parent directory, used as the default location for new folders. */
  parent: string;
}
