"use client";
import { useCallback, useReducer } from "react";
import type { Workspace } from "@/lib/model";
import { newResumeHistory, resumeHistoryReducer } from "@/lib/resume-history";
export function useResumeHistory(initial: () => Workspace) {
  const [state, dispatch] = useReducer(resumeHistoryReducer, undefined, () =>
    newResumeHistory(initial()),
  );
  const set = useCallback(
    (change: Workspace | ((w: Workspace) => Workspace)) =>
      dispatch({ type: "set", change }),
    [],
  );
  const edit = useCallback(
    (change: (w: Workspace) => Workspace, group?: string) =>
      dispatch({ type: "edit", change, group }),
    [],
  );
  const boundary = useCallback(() => dispatch({ type: "boundary" }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  return {
    preview: (direction: "undo" | "redo") =>
      resumeHistoryReducer(state, { type: direction }).present,
    workspace: state.present,
    set,
    edit,
    boundary,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
