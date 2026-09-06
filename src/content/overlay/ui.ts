/**
 * The in-page overlay: fill bar, field badges, popover, palette (SPEC §3.3–3.6).
 * Hand-rolled DOM inside the closed shadow root — no framework in content scripts
 * (CLAUDE.md invariant). All user-facing fill actions are confirm-first (SPEC G3):
 * fill-all touches only auto-tier fields, sensitive fields need an explicit confirm,
 * and nothing here ever submits a form.
 */
import type { ProtocolClient, SearchResult } from '../../shared/messages.js';
import { SIMPLE_CANONICAL_KEYS } from '../../shared/types.js';
import { classifyFields } from '../../shared/classify.js';
import { gatherSignals } from '../label.js';
import type { ScannedField } from '../scan.js';
import { attachFile } from '../attach.js';
import type { FillSession, PlanEntry } from '../session.js';
import { OVERLAY_STYLES } from './styles.js';

export interface OverlayUIDeps {
  layer: HTMLElement;
  shadow: ShadowRoot;
  session: FillSession;
  client: ProtocolClient;
  onClose: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class OverlayUI {
  private readonly doc: Document;
  private readonly bar: HTMLElement;
  private readonly badgeLayer: HTMLElement;
  private popoverEl: HTMLElement | undefined;
  private paletteEl: HTMLElement | undefined;
  private popoverEntry: PlanEntry | undefined;
  private reviewQueue: PlanEntry[] = [];
  private repositionScheduled = false;

  private readonly reposition = (): void => this.scheduleReposition();

  constructor(private readonly deps: OverlayUIDeps) {
    this.doc = deps.layer.ownerDocument;
    const style = el(this.doc, 'style');
    style.textContent = OVERLAY_STYLES;
    deps.shadow.append(style);

    this.badgeLayer = el(this.doc, 'div');
    this.bar = el(this.doc, 'div', 'jf-bar');
    deps.layer.append(this.badgeLayer, this.bar);

    deps.session.onChange(() => this.render());

    // Badges track their fields through scroll/resize.
    this.doc.defaultView?.addEventListener('scroll', this.reposition, true);
    this.doc.defaultView?.addEventListener('resize', this.reposition);

    // Palette shortcut works while the overlay is alive (SPEC §3.6).
    this.doc.addEventListener('keydown', this.onGlobalKeydown, true);
  }

  destroy(): void {
    this.doc.removeEventListener('keydown', this.onGlobalKeydown, true);
    this.doc.defaultView?.removeEventListener('scroll', this.reposition, true);
    this.doc.defaultView?.removeEventListener('resize', this.reposition);
  }

  private readonly onGlobalKeydown = (event: KeyboardEvent): void => {
    if (event.altKey && event.shiftKey && event.code === 'Space') {
      event.preventDefault();
      this.openPalette();
    }
    // Ctrl/Cmd+Z while focus is inside the overlay (SPEC §3.5).
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === 'z' || event.key === 'Z') &&
      event.composedPath().includes(this.deps.layer)
    ) {
      event.preventDefault();
      this.deps.session.undoAll();
    }
  };

  // -------------------------------------------------------------------------
  // Fill bar (SPEC §3.3)
  // -------------------------------------------------------------------------

  render(): void {
    const { session } = this.deps;
    const state = session.current;
    this.bar.replaceChildren();

    const version = el(this.doc, 'span', 'jf-version', state.activeVersionName || 'jobfill');
    version.title = 'Active resume version';
    this.bar.append(version);

    const autoCount = session.autoEntries().length;
    const suggestCount = session.suggestEntries().length;

    if (state.entries.length === 0) {
      this.bar.append(
        el(
          this.doc,
          'span',
          'jf-hint',
          'No form fields found — palette still works (Alt+Shift+Space)',
        ),
      );
    }

    if (state.fillAllEligible && autoCount > 0) {
      const fillBtn = el(
        this.doc,
        'button',
        'jf-btn jf-btn-primary',
        `Fill ${autoCount} field${autoCount === 1 ? '' : 's'}`,
      );
      fillBtn.setAttribute('data-jf', 'fill-all');
      fillBtn.addEventListener('click', () => void this.runFillAll());
      this.bar.append(fillBtn);
    }

    if (suggestCount > 0) {
      const reviewBtn = el(this.doc, 'button', 'jf-btn', `Review ${suggestCount}`);
      reviewBtn.setAttribute('data-jf', 'review');
      reviewBtn.addEventListener('click', () => this.startReview());
      this.bar.append(reviewBtn);
    }

    const uploadEntry = state.entries.find((e) => e.field.kind === 'file');
    if (uploadEntry && state.attachedFile) {
      const attachBtn = el(this.doc, 'button', 'jf-btn', `Attach ${state.attachedFile.name}`);
      attachBtn.setAttribute('data-jf', 'attach');
      attachBtn.title = 'Attach the resume linked to the active version';
      attachBtn.addEventListener(
        'click',
        () => void this.runAttach(uploadEntry, state.attachedFile!.id),
      );
      this.bar.append(attachBtn);
    }

    const paletteBtn = el(this.doc, 'button', 'jf-btn', 'Search ⌥⇧Space');
    paletteBtn.setAttribute('data-jf', 'palette');
    paletteBtn.title = 'Search all snippets and answers';
    paletteBtn.addEventListener('click', () => this.openPalette());
    this.bar.append(paletteBtn);

    const undoBtn = el(this.doc, 'button', 'jf-btn', 'Undo');
    undoBtn.setAttribute('data-jf', 'undo');
    undoBtn.addEventListener('click', () => this.deps.session.undoAll());
    this.bar.append(undoBtn);

    const closeBtn = el(this.doc, 'button', 'jf-btn jf-btn-quiet', '✕');
    closeBtn.setAttribute('data-jf', 'close');
    closeBtn.setAttribute('aria-label', 'Close jobfill');
    closeBtn.addEventListener('click', () => this.deps.onClose());
    this.bar.append(closeBtn);

    this.renderBadges();
  }

  private async runFillAll(): Promise<void> {
    // SPEC §7.9: everything the extension writes is visible — each field scrolls into view
    // and fills with a beat between, never invisibly below the fold.
    const entries = this.deps.session.autoEntries();
    let okCount = 0;
    let amber = 0;
    for (const entry of entries) {
      entry.field.element.scrollIntoView({
        block: 'center',
        behavior: 'instant' as ScrollBehavior,
      });
      const result = this.deps.session.fillEntry(entry);
      if (result.verified) okCount++;
      else if (result.ok) amber++;
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    this.toast(
      `Filled ${okCount} field${okCount === 1 ? '' : 's'}` +
        (amber > 0 ? ` · ${amber} unverified (check amber badges)` : ''),
    );
  }

  // -------------------------------------------------------------------------
  // Badges (SPEC §3.3/§3.5)
  // -------------------------------------------------------------------------

  private renderBadges(): void {
    this.badgeLayer.replaceChildren();
    for (const entry of this.deps.session.current.entries) {
      const { classification } = entry;
      if (classification.tier === 'skip') continue; // deny-listed: untouchable, unbadged
      if (classification.tier === 'manual') {
        // Hollow badge: opens the popover so `map…` can teach unclassified fields (§7.7).
        if (entry.field.kind === 'file') continue;
        const manualBadge = el(this.doc, 'button', 'jf-badge jf-manual');
        manualBadge.setAttribute('data-jf-badge', 'manual');
        manualBadge.title = 'Unrecognized field — search or map it';
        manualBadge.addEventListener('click', () => this.openPopover(entry));
        this.badgeLayer.append(manualBadge);
        this.positionBadge(manualBadge, entry);
        continue;
      }
      if (!entry.value?.value && !entry.value?.choiceTargets) continue;
      const badge = el(this.doc, 'button', 'jf-badge');
      badge.setAttribute('data-jf-badge', classification.key ?? '');
      badge.title = `${classification.key ?? 'field'} (${Math.round(classification.score * 100)}%)`;
      if (classification.sensitive) badge.classList.add('jf-sensitive');
      else if (classification.tier === 'suggest') badge.classList.add('jf-suggest');
      if (entry.fillState === 'filled') {
        badge.classList.add('jf-filled');
        badge.title += ' — filled; click to revert';
      }
      if (entry.fillState === 'unverified') {
        badge.classList.add('jf-unverified');
        badge.title += ' — the site may have rewritten this value';
      }
      badge.addEventListener('click', () => {
        if (entry.fillState === 'filled') {
          this.deps.session.undoEntry(entry);
        } else {
          this.openPopover(entry);
        }
      });
      this.badgeLayer.append(badge);
      this.positionBadge(badge, entry);
    }
  }

  private positionBadge(badge: HTMLElement, entry: PlanEntry): void {
    const rect = entry.field.element.getBoundingClientRect();
    badge.style.position = 'fixed';
    badge.style.left = `${Math.max(0, rect.right - 7)}px`;
    badge.style.top = `${Math.max(0, rect.top - 7)}px`;
    badge.hidden = rect.width === 0 && rect.height === 0;
  }

  private scheduleReposition(): void {
    if (this.repositionScheduled) return;
    this.repositionScheduled = true;
    requestAnimationFrame(() => {
      this.repositionScheduled = false;
      const badges = [...this.badgeLayer.children] as HTMLElement[];
      const entries = this.deps.session.current.entries.filter((e) =>
        e.classification.tier === 'manual'
          ? e.field.kind !== 'file'
          : e.classification.tier !== 'skip' && (e.value?.value || e.value?.choiceTargets),
      );
      badges.forEach((badge, i) => {
        const entry = entries[i];
        if (entry) this.positionBadge(badge, entry);
      });
      if (this.popoverEl && this.popoverEntry)
        this.positionPopover(this.popoverEl, this.popoverEntry);
    });
  }

  // -------------------------------------------------------------------------
  // Popover (SPEC §3.4)
  // -------------------------------------------------------------------------

  openPopover(entry: PlanEntry, review = false): void {
    this.closePopover();
    this.popoverEntry = entry;
    const pop = el(this.doc, 'div', 'jf-popover');
    pop.setAttribute('data-jf', 'popover');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', entry.classification.key ?? 'Field suggestion');

    // Header: canonical key + confidence.
    const head = el(this.doc, 'div', 'jf-popover-head');
    head.append(
      el(this.doc, 'span', 'jf-popover-key', entry.classification.key ?? 'unclassified'),
      el(this.doc, 'span', 'jf-conf', `${Math.round(entry.classification.score * 100)}%`),
    );
    pop.append(head);

    if (entry.classification.sensitive) {
      pop.append(
        el(
          this.doc,
          'div',
          'jf-warn jf-lock',
          '🔒 Sensitive — fills only with your explicit confirmation, never in fill-all.',
        ),
      );
    }

    // Editable preview (edits fill as-is).
    const preview = el(this.doc, 'textarea', 'jf-preview');
    preview.setAttribute('data-jf', 'preview');
    preview.rows = entry.signals.widget === 'textarea' ? 5 : 1;
    preview.value = entry.value?.value ?? '';
    pop.append(preview);

    if (entry.value?.truncated) {
      pop.append(el(this.doc, 'div', 'jf-warn', "Truncated to fit this field's maxlength."));
    }

    // Variant/format cycling (SPEC §3.4: ↑/↓ or chips).
    const alternates = entry.value?.alternates ?? [];
    let cycleIndex = 0; // 0 = original; 1..n = alternates
    const cycle = (direction: 1 | -1) => {
      if (alternates.length === 0) return;
      cycleIndex = (cycleIndex + direction + alternates.length + 1) % (alternates.length + 1);
      preview.value =
        cycleIndex === 0 ? (entry.value?.value ?? '') : (alternates[cycleIndex - 1] ?? '');
    };
    if (alternates.length > 0) {
      const hint = el(this.doc, 'div', 'jf-hint', `↑/↓ cycles ${alternates.length + 1} variants`);
      pop.append(hint);
    }

    // Choice widgets we can't drive show their option list for context (SPEC §5.4).
    if (
      (entry.field.kind === 'listbox-button' || entry.field.kind === 'combobox') &&
      entry.value?.choiceTargets
    ) {
      pop.append(
        el(
          this.doc,
          'div',
          'jf-hint',
          `Will try to match: ${entry.value.choiceTargets.slice(0, 3).join(' · ')}`,
        ),
      );
    }

    // Type-to-filter: swap the proposal for any other atom/snippet (same index as palette).
    const searchRow = el(this.doc, 'div', 'jf-row');
    const search = el(this.doc, 'input', 'jf-search');
    search.placeholder = 'Type to swap in another snippet…';
    search.setAttribute('data-jf', 'popover-search');
    searchRow.append(search);
    pop.append(searchRow);
    const optionsBox = el(this.doc, 'div', 'jf-options');
    pop.append(optionsBox);
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    search.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        void this.runSearch(search.value, optionsBox, (result) => {
          preview.value = result.value;
          optionsBox.replaceChildren();
          preview.focus();
        });
      }, 80);
    });

    // Actions.
    const actions = el(this.doc, 'div', 'jf-row');
    const fillLabel = entry.classification.sensitive ? 'Confirm & fill' : 'Fill (Enter)';
    const fillBtn = el(this.doc, 'button', 'jf-btn jf-btn-primary', fillLabel);
    fillBtn.setAttribute('data-jf', 'popover-fill');
    fillBtn.addEventListener('click', () => this.commitPopover(preview.value, review));
    const mapBtn = el(this.doc, 'button', 'jf-btn', 'map…');
    mapBtn.setAttribute('data-jf', 'popover-map');
    mapBtn.addEventListener('click', () => this.openMapPicker(pop, entry));
    const skipBtn = el(
      this.doc,
      'button',
      'jf-btn jf-btn-quiet',
      review ? 'Skip (S)' : 'Close (Esc)',
    );
    skipBtn.addEventListener('click', () => (review ? this.advanceReview() : this.closePopover()));
    actions.append(fillBtn, mapBtn, skipBtn);
    pop.append(actions);

    // Keyboard flow (SPEC §3.4).
    pop.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && event.target !== search) {
        if (
          entry.signals.widget === 'textarea' &&
          event.target === preview &&
          !event.metaKey &&
          !event.ctrlKey
        ) {
          return; // let Enter type newlines in multiline previews; buttons/Cmd-Enter fill
        }
        event.preventDefault();
        if (entry.classification.sensitive) {
          // §7.9: sensitive fills need the DELIBERATE button click, not flow-through Enter.
          this.toast('Sensitive field — click "Confirm & fill" to proceed');
          return;
        }
        this.commitPopover(preview.value, review);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (review) this.endReview();
        else this.closePopover();
      } else if (event.key === 'ArrowUp' && event.target === preview) {
        event.preventDefault();
        cycle(-1);
      } else if (event.key === 'ArrowDown' && event.target === preview) {
        event.preventDefault();
        cycle(1);
      } else if (
        (event.key === 's' || event.key === 'S') &&
        review &&
        event.target !== preview &&
        event.target !== search
      ) {
        event.preventDefault();
        this.advanceReview();
      } else if (event.key === 'Tab' && !review) {
        // Move to the next recognized field's popover, keeping flow keyboard-only.
        event.preventDefault();
        const flow = [...this.deps.session.autoEntries(), ...this.deps.session.suggestEntries()];
        const index = flow.indexOf(entry);
        const next = flow[(index + 1) % flow.length];
        if (next && next !== entry) this.openPopover(next);
      }
    });

    this.deps.layer.append(pop);
    this.popoverEl = pop;
    this.positionPopover(pop, entry);
    preview.focus();
    preview.setSelectionRange(preview.value.length, preview.value.length);
  }

  private commitPopover(value: string, review: boolean): void {
    const entry = this.popoverEntry;
    if (!entry) return;
    const result = this.deps.session.fillEntry(entry, value, true);
    if (!result.ok) {
      this.toast(result.reason ?? 'Could not fill this field');
      if (entry.field.kind === 'listbox-button') {
        // Honest fallback for widgets we can't drive: put the value on the clipboard.
        this.copyToClipboard(value);
        this.toast("Copied — pick the option in the site's own widget");
      }
      if (review) this.advanceReview();
      return;
    }
    if (review) this.advanceReview();
    else this.closePopover();
  }

  private openMapPicker(pop: HTMLElement, entry: PlanEntry): void {
    const existing = pop.querySelector('.jf-map-list');
    if (existing) {
      existing.remove();
      return;
    }
    const list = el(this.doc, 'div', 'jf-options jf-map-list');
    list.setAttribute('data-jf', 'map-list');
    for (const key of SIMPLE_CANONICAL_KEYS) {
      const option = el(this.doc, 'button', 'jf-option');
      option.append(el(this.doc, 'span', 'jf-option-value', key));
      option.addEventListener('click', () => {
        this.deps.session.recordMapping(entry, key);
        this.toast(`Mapped to ${key} (this page only tonight)`);
        this.closePopover();
      });
      list.append(option);
    }
    pop.append(list);
  }

  private positionPopover(pop: HTMLElement, entry: PlanEntry): void {
    const rect = entry.field.element.getBoundingClientRect();
    pop.style.position = 'fixed';
    const top = rect.bottom + 6;
    const maxTop = (this.doc.defaultView?.innerHeight ?? 800) - pop.offsetHeight - 10;
    pop.style.top = `${Math.min(top, Math.max(10, maxTop))}px`;
    pop.style.left = `${Math.max(8, Math.min(rect.left, (this.doc.defaultView?.innerWidth ?? 1000) - 440))}px`;
  }

  closePopover(): void {
    this.popoverEl?.remove();
    this.popoverEl = undefined;
    this.popoverEntry = undefined;
  }

  // -------------------------------------------------------------------------
  // Review stepping (SPEC §3.5)
  // -------------------------------------------------------------------------

  startReview(): void {
    this.reviewQueue = [...this.deps.session.suggestEntries()];
    this.advanceReview();
  }

  private advanceReview(): void {
    const next = this.reviewQueue.shift();
    if (!next) {
      this.endReview();
      return;
    }
    next.field.element.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    this.openPopover(next, true);
  }

  private endReview(): void {
    this.reviewQueue = [];
    this.closePopover();
  }

  // -------------------------------------------------------------------------
  // Palette (SPEC §3.6)
  // -------------------------------------------------------------------------

  openPalette(): void {
    if (this.paletteEl) {
      this.closePalette();
      return;
    }
    // Bind to the field focused at open time.
    const active = this.doc.activeElement;
    const target =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
        ? active
        : undefined;

    const palette = el(this.doc, 'div', 'jf-palette');
    palette.setAttribute('data-jf', 'palette');
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', 'jobfill search');

    palette.append(
      el(
        this.doc,
        'div',
        'jf-palette-target',
        target
          ? `Enter fills the focused field · Shift+Enter copies`
          : `No field focused — Enter copies to clipboard`,
      ),
    );

    const search = el(this.doc, 'input', 'jf-search');
    search.placeholder = 'Search snippets, answers, everything…';
    search.setAttribute('data-jf', 'palette-search');
    palette.append(search);
    const results = el(this.doc, 'div', 'jf-options');
    results.setAttribute('data-jf', 'palette-results');
    palette.append(results);

    let selectedIndex = 0;
    let currentResults: SearchResult[] = [];

    const commit = (result: SearchResult | undefined, copy: boolean) => {
      if (!result) return;
      if (!copy && target) {
        const entry =
          this.deps.session.current.entries.find((e) => e.field.element === target) ??
          this.classifyLooseTarget(target);
        // The deny-list holds even for fields the scan missed (rung-2 review P0-2): a
        // password/SSN/DOB input focused by the user is still refused.
        const fillResult = this.deps.session.fillEntry(entry, result.value, true);
        if (fillResult.ok) {
          this.toast(
            fillResult.verified ? 'Filled' : 'Filled — but the site may have rewritten it',
          );
        } else {
          this.toast(fillResult.reason ?? 'Could not fill this field');
        }
      } else {
        this.copyToClipboard(result.value);
        this.toast('Copied to clipboard');
      }
      this.closePalette();
    };

    const renderResults = () => {
      results.replaceChildren();
      currentResults.forEach((result, i) => {
        const option = el(
          this.doc,
          'button',
          `jf-option${i === selectedIndex ? ' jf-active' : ''}`,
        );
        option.append(
          el(
            this.doc,
            'span',
            'jf-option-label',
            `${result.sensitive ? '🔒 ' : ''}${result.label}`,
          ),
          el(this.doc, 'span', 'jf-option-value', result.value),
        );
        option.addEventListener('click', () => commit(result, false));
        results.append(option);
      });
      if (currentResults.length === 0 && search.value.trim()) {
        const save = el(this.doc, 'button', 'jf-option');
        save.setAttribute('data-jf', 'palette-save');
        save.append(
          el(
            this.doc,
            'span',
            'jf-option-value',
            `Save "${search.value.slice(0, 60)}" as an answer…`,
          ),
        );
        save.addEventListener('click', () => {
          // Inline question row (no page dialogs from a content script).
          save.remove();
          const row = el(this.doc, 'div', 'jf-row');
          const question = el(this.doc, 'input', 'jf-search');
          question.placeholder = 'Save as the answer to which question?';
          question.setAttribute('data-jf', 'palette-save-question');
          const confirmBtn = el(this.doc, 'button', 'jf-btn jf-btn-primary', 'Save');
          confirmBtn.setAttribute('data-jf', 'palette-save-confirm');
          confirmBtn.addEventListener(
            'click',
            () => void this.quickSave(search.value, question.value),
          );
          question.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void this.quickSave(search.value, question.value);
            }
            event.stopPropagation();
          });
          row.append(question, confirmBtn);
          results.append(row);
          question.focus();
        });
        results.append(save);
      }
    };

    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    const runSearch = () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        void this.deps.client
          .send({ t: 'snippets.search', q: search.value, limit: 12 })
          .then(({ results: found }) => {
            currentResults = found;
            selectedIndex = 0;
            renderResults();
          })
          .catch(() => undefined);
      }, 80);
    };
    search.addEventListener('input', runSearch);

    palette.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closePalette();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
        renderResults();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderResults();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        commit(currentResults[selectedIndex], event.shiftKey || !target);
      }
    });

    this.deps.layer.append(palette);
    this.paletteEl = palette;
    search.focus();
    runSearch();
  }

  private async quickSave(text: string, question: string): Promise<void> {
    // "Save '…' as" (SPEC §3.6): quick-save into the answers bank so the library grows
    // organically. Uses the narrow `answers.quickSave` message — content scripts have no
    // vault-level access (rung-1 review P1-8).
    if (!question.trim()) {
      this.toast('Give the answer a question first');
      return;
    }
    try {
      await this.deps.client.send({
        t: 'answers.quickSave',
        question: question.trim(),
        value: text,
      });
      this.toast('Saved to your answers bank');
    } catch (err) {
      this.toast(err instanceof Error ? err.message : 'Could not save');
    }
    this.closePalette();
  }

  closePalette(): void {
    this.paletteEl?.remove();
    this.paletteEl = undefined;
  }

  /**
   * Builds a plan entry for a focused element outside the last scan (late-mounted,
   * scan-invisible) by running the real label+classify pipeline on it — so the deny-list
   * and sensitivity rules apply exactly as they would have at scan time.
   */
  private classifyLooseTarget(target: HTMLElement): PlanEntry {
    const kind =
      target instanceof HTMLTextAreaElement
        ? ('textarea' as const)
        : target.isContentEditable
          ? ('contenteditable' as const)
          : ('text' as const);
    const field: ScannedField = { fieldId: 'palette-target', kind, element: target };
    const signals = gatherSignals(field);
    const result = classifyFields([signals]);
    return { field, signals, classification: result.fields[0]! };
  }

  /** Rung 3 (SPEC §3.7): pull the stored file from the background and attach it. */
  private async runAttach(entry: PlanEntry, fileId: string): Promise<void> {
    try {
      const { file } = await this.deps.client.send({ t: 'file.get', fileId });
      const result = attachFile(entry.field.element, file, this.doc.defaultView ?? window);
      if (result.ok) {
        this.toast(
          result.path === 'input'
            ? `Attached ${file.name}`
            : `Dropped ${file.name} — check the site accepted it`,
        );
      } else {
        this.toast(`Could not attach: ${result.reason ?? 'unknown'} — use the field's own picker`);
      }
    } catch (err) {
      this.toast(err instanceof Error ? err.message : 'Could not load the stored file');
    }
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  private runSearch(
    query: string,
    box: HTMLElement,
    onPick: (result: SearchResult) => void,
  ): Promise<void> {
    return this.deps.client
      .send({ t: 'snippets.search', q: query, limit: 6 })
      .then(({ results }) => {
        box.replaceChildren();
        for (const result of results) {
          const option = el(this.doc, 'button', 'jf-option');
          option.append(
            el(this.doc, 'span', 'jf-option-label', result.label),
            el(this.doc, 'span', 'jf-option-value', result.value),
          );
          option.addEventListener('click', () => onPick(result));
          box.append(option);
        }
      })
      .catch(() => undefined);
  }

  private copyToClipboard(text: string): void {
    void navigator.clipboard?.writeText(text).catch(() => {
      // Fallback: hidden textarea + execCommand (older clipboard permission models).
      const ta = this.doc.createElement('textarea');
      ta.value = text;
      this.doc.body.append(ta);
      ta.select();
      this.doc.execCommand('copy');
      ta.remove();
    });
  }

  private toast(message: string): void {
    const toast = el(this.doc, 'div', 'jf-toast', message);
    toast.setAttribute('data-jf', 'toast');
    this.deps.layer.append(toast);
    setTimeout(() => toast.remove(), 2600);
  }
}
