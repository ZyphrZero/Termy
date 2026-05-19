/**
 * Feature visibility management module exports
 */

export { FeatureVisibilityManager } from './featureVisibilityManager';
export { EditorSelectionHighlightManager } from './editorSelectionHighlight';
export { createEditorSelectionPersistenceExtension } from './editorSelectionPersistenceExtension';
export type { 
  VisibilityConfig, 
  RibbonConfig, 
  FeatureRegistrationConfig,
  FeatureRegistration 
} from './types';
export { DEFAULT_VISIBILITY_CONFIG } from './types';
