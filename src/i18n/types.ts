/**
 * i18n 类型定义文件
 * 定义所有翻译键的类型结构，确保类型安全
 */

/**
 * 支持的语言区域
 */
export type SupportedLocale = 'en' | 'zh-CN';

/**
 * 翻译键接口
 * 包含终端插件所有可翻译文本的类型定义
 */
export interface TranslationKeys {
  // 通用文本
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

  // 插件信息
  plugin: {
    name: string;
    loadingMessage: string;
    loadedMessage: string;
    unloadingMessage: string;
    unloadedMessage: string;
  };

  // 终端
  terminal: {
    defaultTitle: string;
    loading: string;
    initFailed: string;
    notInitialized: string;
    renameTerminal: string;
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

  // 命令
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
  };

  // 侧边栏
  ribbon: {
    terminalTooltip: string;
  };

  // 功能可见性
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

  // 通知消息
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
      scrollbackRangeError: string;
      heightRangeError: string;
    };
  };

  // 设置
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

  // 设置详情 - 终端
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
      useObsidianTheme: string;
      useObsidianThemeDesc: string;
      backgroundColor: string;
      backgroundColorDesc: string;
      foregroundColor: string;
      foregroundColorDesc: string;
      backgroundImage: string;
      backgroundImageDesc: string;
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
      defaultHeight: string;
      defaultHeightDesc: string;
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

  // 模态框
  modals: {
    renameTerminal: {
      title: string;
      placeholder: string;
    };
  };

  // 错误消息
  errors: {
    serverNotRunning: string;
    connectionLost: string;
    invalidMessage: string;
  };

  // 终端实例
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

  // 终端服务
  terminalService: {
    processNotStarted: string;
    portInfoTimeout: string;
    startFailedWithCode: string;
  };

  // Shell 类型
  shellTypes: {
    cmd: string;
    powershell: string;
    wsl: string;
    gitbash: string;
    bash: string;
    zsh: string;
    custom: string;
  };

  // 新实例行为
  newInstanceBehavior: {
    newTab: string;
    newPane: string;
    newWindow: string;
  };

  // 光标样式
  cursorStyles: {
    block: string;
    underline: string;
    bar: string;
  };

  // 渲染器类型
  rendererTypes: {
    canvas: string;
    webgl: string;
  };

  // 背景图片尺寸
  backgroundImageSizes: {
    cover: string;
    contain: string;
    auto: string;
  };

  // Shell 选项
  shellOptions: {
    cmd: string;
    powershell: string;
    wsl: string;
    gitbash: string;
    bash: string;
    zsh: string;
    custom: string;
  };

  // 布局选项
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

  // 背景尺寸选项
  backgroundSizeOptions: {
    cover: string;
    contain: string;
    auto: string;
  };

  // 背景位置选项
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

  // 光标样式选项
  cursorStyleOptions: {
    block: string;
    underline: string;
    bar: string;
  };

  // 渲染器选项
  rendererOptions: {
    canvas: string;
    webgl: string;
  };
}
