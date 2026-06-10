import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { Logger } from '../../../services/logger';
import {
  projectFileService,
  type RecentProjectEntry,
} from '../../../services/projectFileService';
import {
  createNewProject,
  loadProjectToStores,
  openExistingProject,
  saveCurrentProject,
  setProjectLoadProgress,
  syncStoresToProject,
} from '../../../services/projectSync';

const log = Logger.create('Toolbar');

interface UseToolbarProjectActionsArgs {
  closeMenu: () => void;
  editName: string;
  isRenamingRef: MutableRefObject<boolean>;
  projectName: string;
  resetMediaProject: (name: string) => void;
  setEditName: Dispatch<SetStateAction<string>>;
  setIsEditingName: Dispatch<SetStateAction<boolean>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsProjectOpen: Dispatch<SetStateAction<boolean>>;
  setNeedsPermission: Dispatch<SetStateAction<boolean>>;
  setPendingProjectName: Dispatch<SetStateAction<string | null>>;
  setProjectName: Dispatch<SetStateAction<string>>;
  setRecentProjects: Dispatch<SetStateAction<RecentProjectEntry[]>>;
  setRenameError: Dispatch<SetStateAction<string | null>>;
  setShowSavedToast: Dispatch<SetStateAction<boolean>>;
}

export function useToolbarProjectActions({
  closeMenu,
  editName,
  isRenamingRef,
  projectName,
  resetMediaProject,
  setEditName,
  setIsEditingName,
  setIsLoading,
  setIsProjectOpen,
  setNeedsPermission,
  setPendingProjectName,
  setProjectName,
  setRecentProjects,
  setRenameError,
  setShowSavedToast,
}: UseToolbarProjectActionsArgs) {
  const handleSave = useCallback(async (showToast = true) => {
    if (!projectFileService.isProjectOpen()) {
      const name = prompt('Enter project name:', 'New Project');
      if (!name) return;
      setIsLoading(true);
      const success = await createNewProject(name);
      if (success) {
        setProjectName(name);
        setIsProjectOpen(true);
        if (showToast) setShowSavedToast(true);
      }
      setIsLoading(false);
    } else {
      await saveCurrentProject({ source: 'manual', label: 'Manual save' });
      if (showToast) setShowSavedToast(true);
    }
    closeMenu();
  }, [closeMenu, setIsLoading, setIsProjectOpen, setProjectName, setShowSavedToast]);

  const handleSaveAs = useCallback(async () => {
    const name = prompt('Save project as:', projectName || 'New Project');
    if (!name) return;

    setIsLoading(true);
    const success = await createNewProject(name);
    if (success) {
      setProjectName(name);
      setIsProjectOpen(true);
      setNeedsPermission(false);
      setShowSavedToast(true);
    }
    setIsLoading(false);
    closeMenu();
  }, [
    closeMenu,
    projectName,
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setProjectName,
    setShowSavedToast,
  ]);

  const handleOpen = useCallback(async () => {
    if (projectFileService.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Open a different project?')) {
        return;
      }
    }
    setIsLoading(true);
    setProjectLoadProgress({
      phase: 'opening',
      percent: 3,
      message: 'Opening project',
      blocking: true,
    });
    const success = await openExistingProject();
    if (!success) {
      setProjectLoadProgress(null);
    }
    if (success) {
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
      }
    }
    setIsLoading(false);
    closeMenu();
  }, [closeMenu, setIsLoading, setIsProjectOpen, setProjectName]);

  const handleOpenRecent = useCallback(async (projectId: string) => {
    if (projectFileService.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Open a different project?')) {
        return;
      }
    }

    setIsLoading(true);
    setProjectLoadProgress({
      phase: 'opening',
      percent: 3,
      message: 'Opening recent project',
      blocking: true,
    });

    try {
      const success = await projectFileService.openRecentProject(projectId);
      if (!success) {
        setProjectLoadProgress(null);
        window.alert('Could not open that recent project. It may have moved, or the browser may need permission again.');
        return;
      }

      await loadProjectToStores();
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
        setNeedsPermission(false);
        setPendingProjectName(null);
      }
    } catch (error) {
      log.error('Failed to open recent project', error);
      setProjectLoadProgress(null);
      window.alert('Could not open that recent project.');
    } finally {
      setRecentProjects(projectFileService.getRecentProjects());
      setIsLoading(false);
      closeMenu();
    }
  }, [
    closeMenu,
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setPendingProjectName,
    setProjectName,
    setRecentProjects,
  ]);

  const handleClearRecentProjects = useCallback(async () => {
    await projectFileService.clearRecentProjects();
    setRecentProjects([]);
    closeMenu();
  }, [closeMenu, setRecentProjects]);

  const handleNameSubmit = useCallback(async () => {
    if (isRenamingRef.current) return;

    setRenameError(null);

    if (editName.trim()) {
      const newName = editName.trim();
      const data = projectFileService.getProjectData();

      if (data && newName !== data.name) {
        isRenamingRef.current = true;
        setIsLoading(true);
        const success = await projectFileService.renameProject(newName);
        if (success) {
          setProjectName(newName);
          setShowSavedToast(true);
        } else {
          setEditName(data.name);
          setRenameError(`Could not rename to "${newName}" \u2014 a folder with that name may already exist.`);
          setTimeout(() => setRenameError(null), 4000);
        }
        setIsLoading(false);
        isRenamingRef.current = false;
      }
    }
    setIsEditingName(false);
  }, [
    editName,
    isRenamingRef,
    setEditName,
    setIsEditingName,
    setIsLoading,
    setProjectName,
    setRenameError,
    setShowSavedToast,
  ]);

  const handleNew = useCallback(async () => {
    if (projectFileService.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Create a new project?')) {
        return;
      }
    }
    const name = prompt('Enter project name:', 'New Project');
    if (!name) return;

    setIsLoading(true);
    const folderCreated = await projectFileService.createProject(name);
    if (folderCreated) {
      resetMediaProject(name);
      await syncStoresToProject();
      await projectFileService.saveProject();

      setProjectName(name);
      setIsProjectOpen(true);
      setNeedsPermission(false);
    }
    setIsLoading(false);
    closeMenu();
  }, [
    closeMenu,
    resetMediaProject,
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setProjectName,
  ]);

  const handleRestorePermission = useCallback(async () => {
    setIsLoading(true);
    setProjectLoadProgress({
      phase: 'opening',
      percent: 3,
      message: 'Restoring project permission',
      blocking: true,
    });
    const success = await projectFileService.requestPendingPermission();
    if (success) {
      await loadProjectToStores();
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
      }
      setNeedsPermission(false);
      setPendingProjectName(null);
    } else {
      setProjectLoadProgress(null);
    }
    setIsLoading(false);
  }, [
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setPendingProjectName,
    setProjectName,
  ]);

  return {
    handleClearRecentProjects,
    handleNameSubmit,
    handleNew,
    handleOpen,
    handleOpenRecent,
    handleRestorePermission,
    handleSave,
    handleSaveAs,
  };
}
