import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { projectFileService } from '../../../services/projectFileService';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import {
  createNewProject,
  saveCurrentProject,
} from '../../../services/projectSync';

interface UseToolbarProjectShortcutsArgs {
  handleNew: () => void;
  handleOpen: () => void;
  projectName: string;
  setIsProjectOpen: Dispatch<SetStateAction<boolean>>;
  setProjectName: Dispatch<SetStateAction<string>>;
  setShowSavedToast: Dispatch<SetStateAction<boolean>>;
}

export function useToolbarProjectShortcuts({
  handleNew,
  handleOpen,
  projectName,
  setIsProjectOpen,
  setProjectName,
  setShowSavedToast,
}: UseToolbarProjectShortcutsArgs): void {
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (registry.matches('project.save', event) || registry.matches('project.saveAs', event)) {
        event.preventDefault();
        event.stopPropagation();

        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

        if (registry.matches('project.saveAs', event)) {
          const name = prompt('Save project as:', projectName || 'New Project');
          if (name) {
            createNewProject(name).then((success) => {
              if (success) {
                setProjectName(name);
                setIsProjectOpen(true);
                setShowSavedToast(true);
              }
            });
          }
        } else if (!projectFileService.isProjectOpen()) {
          const name = prompt('Enter project name:', 'New Project');
          if (name) {
            createNewProject(name).then((success) => {
              if (success) {
                setProjectName(name);
                setIsProjectOpen(true);
                setShowSavedToast(true);
              }
            });
          }
        } else {
          saveCurrentProject({ source: 'manual', label: 'Ctrl+S save' }).then(() => {
            setShowSavedToast(true);
          });
        }
        return;
      }

      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

      if (registry.matches('project.new', event)) {
        event.preventDefault();
        handleNew();
      }

      if (registry.matches('project.open', event)) {
        event.preventDefault();
        handleOpen();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    handleNew,
    handleOpen,
    projectName,
    setIsProjectOpen,
    setProjectName,
    setShowSavedToast,
  ]);
}
