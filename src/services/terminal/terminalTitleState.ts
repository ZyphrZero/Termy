type TerminalTitleSource = 'default' | 'custom' | 'automatic';

const BLANK_TITLE = '';

export class TerminalTitleState {
  private readonly defaultTitle: string;
  private title: string;
  private source: TerminalTitleSource = 'default';
  private titleBeforeAutomatic: string | null = null;

  constructor(defaultTitle: string) {
    this.defaultTitle = defaultTitle;
    this.title = defaultTitle;
  }

  getTitle(): string {
    return this.title;
  }

  setCustomTitle(title: string): boolean {
    this.titleBeforeAutomatic = null;
    return this.setTitle(title, 'custom');
  }

  setAutomaticTitle(title: string): boolean {
    if (this.source === 'custom') {
      return false;
    }

    if (this.source !== 'automatic') {
      this.titleBeforeAutomatic = this.title;
    }

    return this.setTitle(title, 'automatic');
  }

  setProcessTitle(title: string): boolean {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || trimmedTitle === BLANK_TITLE) {
      return false;
    }
    return this.setAutomaticTitle(trimmedTitle);
  }

  clearAutomaticTitle(): boolean {
    if (this.source !== 'automatic') {
      return false;
    }

    const restoredTitle = this.titleBeforeAutomatic ?? this.defaultTitle;
    this.titleBeforeAutomatic = null;
    return this.setTitle(restoredTitle, 'default');
  }

  private setTitle(title: string, source: TerminalTitleSource): boolean {
    const changed = this.title !== title || this.source !== source;
    this.title = title;
    this.source = source;
    return changed;
  }
}
