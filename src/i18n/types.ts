/**
 * i18n type definitions
 * Defines the type structure for all translation keys to ensure type safety
 */

/**
 * Supported locales
 */
export type SupportedLocale = 'en' | 'zh-CN' | 'ja' | 'ko' | 'ru';

/**
 * Translation key interface
 * Contains type definitions for all translatable text in the terminal plugin
 */
export interface TranslationKeys {
  // Common text
  common: {
    confirm: string;
    cancel: string;
    save: string;
    delete: string;
    reset: string;
    loading: string;
    success: string;
    error: string;
    warning: string;
    info: string;
  };

  // Plugin information
  plugin: {
    name: string;
    loadingMessage: string;
    loadedMessage: string;
    unloadingMessage: string;
    unloadedMessage: string;
  };

  // Terminal
  terminal: {
    defaultTitle: string;
    loading: string;
    initFailed: string;
    notInitialized: string;
    renameTerminal: string;
    dropHintPasteFilePath: string;
    search: {
      placeholder: string;
      previous: string;
      next: string;
      close: string;
    };
    contextMenu: {
      copy: string;
      copyAsPlainText: string;
      paste: string;
      selectAll: string;
      selectLine: string;
      search: string;
      copyPath: string;
      openInExplorer: string;
      newTerminal: string;
      splitTerminal: string;
      splitHorizontal: string;
      splitVertical: string;
      fontSize: string;
      fontIncrease: string;
      fontDecrease: string;
      fontReset: string;
      clear: string;
      clearBuffer: string;
    };
  };

  // Commands
  commands: {
    openTerminal: string;
    terminalSearch: string;
    terminalClear: string;
    terminalCopy: string;
    terminalPaste: string;
    terminalFontIncrease: string;
    terminalFontDecrease: string;
    terminalFontReset: string;
    terminalSplitHorizontal: string;
    terminalSplitVertical: string;
    terminalClearBuffer: string;
    presetScriptPrefix: string;
  };

  // Ribbon
  ribbon: {
    terminalTooltip: string;
  };

  // Feature visibility
  visibility: {
    showInCommandPalette: string;
    showInCommandPaletteDesc: string;
    showInRibbon: string;
    showInRibbonDesc: string;
    showInNewTab: string;
    showInNewTabDesc: string;
    showInStatusBar: string;
    showInStatusBarDesc: string;
    visibilitySettings: string;
  };

  // Notice messages
  notices: {
    serverStartFailed: string;
    wsReconnectFailed: string;
    wsReconnectSuccess: string;
    downloadingBinary: string;
    updatingBinary: string;
    verifyingBinary: string;
    binaryDownloadComplete: string;
    binaryUpdateComplete: string;
    binaryNotAvailable: string;
    checksumMismatch: string;
    binaryInUse: string;
    terminal: {
      serverCrashed: string;
      sessionClosed: string;
      reconnecting: string;
    };
    settings: {
      backgroundColorReset: string;
      foregroundColorReset: string;
      backgroundImageCleared: string;
      rendererUpdated: string;
      debugLogEnabled: string;
      debugLogDisabled: string;
      scrollbackRangeError: string;
      heightRangeError: string;
    };
    presetScript: {
      notFound: string;
      emptyCommand: string;
      terminalUnavailable: string;
      runFailed: string;
    };
  };

  // Settings
  settings: {
    tabs: {
      terminal: string;
      advanced: string;
    };
    header: {
      title: string;
      feedbackText: string;
      feedbackLink: string;
      reload: string;
    };
  };

  // Setting details - Terminal
  settingsDetails: {
    terminal: {
      appearanceSettings: string;
      behaviorSettings: string;
      blurEffect: string;
      blurEffectDesc: string;
      rendererType: string;
      rendererTypeDesc: string;
      pathValid: string;
      pathInvalid: string;
      renameTerminalPlaceholder: string;
      shellSettings: string;
      defaultShell: string;
      defaultShellDesc: string;
      customShellPath: string;
      customShellPathDesc: string;
      customShellPathPlaceholder: string;
      defaultArgs: string;
      defaultArgsDesc: string;
      defaultArgsPlaceholder: string;
      autoEnterVault: string;
      autoEnterVaultDesc: string;
      instanceBehavior: string;
      newInstanceLayout: string;
      newInstanceLayoutDesc: string;
      createNearExisting: string;
      createNearExistingDesc: string;
      focusNewInstance: string;
      focusNewInstanceDesc: string;
      lockNewInstance: string;
      lockNewInstanceDesc: string;
      themeSettings: string;
      themePreview: string;
      rendererStatus: string;
      rendererStatusDesc: string;
      rendererStatusLive: string;
      rendererStatusPredicted: string;
      rendererStatusFallback: string;
      useObsidianTheme: string;
      useObsidianThemeDesc: string;
      backgroundColor: string;
      backgroundColorDesc: string;
      foregroundColor: string;
      foregroundColorDesc: string;
      backgroundImage: string;
      backgroundImageDesc: string;
      backgroundImageWebglHint: string;
      backgroundImagePlaceholder: string;
      backgroundImageOpacity: string;
      backgroundImageOpacityDesc: string;
      backgroundImageSize: string;
      backgroundImageSizeDesc: string;
      backgroundImagePosition: string;
      backgroundImagePositionDesc: string;
      enableBlur: string;
      enableBlurDesc: string;
      blurAmount: string;
      blurAmountDesc: string;
      textOpacity: string;
      textOpacityDesc: string;
      fontSettings: string;
      fontSize: string;
      fontSizeDesc: string;
      fontFamily: string;
      fontFamilyDesc: string;
      fontFamilyPlaceholder: string;
      cursorStyle: string;
      cursorStyleDesc: string;
      cursorBlink: string;
      cursorBlinkDesc: string;
      rendererSettings: string;
      preferredRenderer: string;
      preferredRendererDesc: string;
      scrollback: string;
      scrollbackDesc: string;
      presetScripts: string;
      presetScriptsDesc: string;
      presetScriptsAdd: string;
      presetScriptsAddMenu: string;
      presetScriptsEmpty: string;
      presetScriptsUnnamed: string;
      presetScriptsEmptyCommand: string;
      presetScriptsDeleteConfirm: string;
      presetScriptsMoveUp: string;
      presetScriptsMoveDown: string;
      presetScriptName: string;
      presetScriptNamePlaceholder: string;
      presetScriptIcon: string;
      presetScriptIconPlaceholder: string;
      presetScriptCommand: string;
      presetScriptCommandPlaceholder: string;
      presetScriptTerminalTitle: string;
      presetScriptTerminalTitlePlaceholder: string;
      presetScriptShowInStatusBar: string;
      presetScriptShowInStatusBarDesc: string;
      presetScriptAutoOpenTerminal: string;
      presetScriptAutoOpenTerminalDesc: string;
      presetScriptRunInNewTerminal: string;
      presetScriptRunInNewTerminalDesc: string;
    };
    advanced: {
      performanceAndDebug: string;
      debugMode: string;
      debugModeDesc: string;
      serverConnection: string;
      serverConnectionDesc: string;
      offlineMode: string;
      offlineModeDesc: string;
      downloadAccelerator: string;
      downloadAcceleratorDesc: string;
      resetToDefaults: string;
      resetToDefaultsDesc: string;
      customServerPort: string;
      customServerPortDesc: string;
      customServerPortPlaceholder: string;
    };
  };

  // Modals
  modals: {
    renameTerminal: {
      title: string;
      placeholder: string;
    };
    presetScript: {
      titleCreate: string;
      titleEdit: string;
    };
  };

  // Error messages
  errors: {
    serverNotRunning: string;
    connectionLost: string;
    invalidMessage: string;
  };

  // Terminal instance
  terminalInstance: {
    rendererNotSupported: string;
    webglContextLost: string;
    rendererLoadFailed: string;
    instanceDestroyed: string;
    startFailed: string;
    connectionTimeout: string;
    cannotConnect: string;
    xtermLoadFailed: string;
    xtermInitFailed: string;
  };

  // Terminal service
  terminalService: {
    processNotStarted: string;
    portInfoTimeout: string;
    startFailedWithCode: string;
  };

  // Shell types
  shellTypes: {
    cmd: string;
    powershell: string;
    wsl: string;
    gitbash: string;
    bash: string;
    zsh: string;
    custom: string;
  };

  // New instance behavior
  newInstanceBehavior: {
    newTab: string;
    newPane: string;
    newWindow: string;
  };

  // Cursor styles
  cursorStyles: {
    block: string;
    underline: string;
    bar: string;
  };

  // Renderer types
  rendererTypes: {
    canvas: string;
    webgl: string;
  };

  // Background image sizes
  backgroundImageSizes: {
    cover: string;
    contain: string;
    auto: string;
  };

  // Shell options
  shellOptions: {
    cmd: string;
    powershell: string;
    pwsh: string;
    wsl: string;
    gitbash: string;
    bash: string;
    zsh: string;
    custom: string;
  };

  // Layout options
  layoutOptions: {
    replaceTab: string;
    newTab: string;
    newLeftTab: string;
    newLeftSplit: string;
    newRightTab: string;
    newRightSplit: string;
    newHorizontalSplit: string;
    newVerticalSplit: string;
    newWindow: string;
  };

  // Background size options
  backgroundSizeOptions: {
    cover: string;
    contain: string;
    auto: string;
  };

  // Background position options
  backgroundPositionOptions: {
    center: string;
    top: string;
    bottom: string;
    left: string;
    right: string;
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
  };

  // Cursor style options
  cursorStyleOptions: {
    block: string;
    underline: string;
    bar: string;
  };

  // Renderer options
  rendererOptions: {
    canvas: string;
    webgl: string;
  };
}
