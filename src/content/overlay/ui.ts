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
import { attachFile, findAttachableDropzone } from '../attach.js';
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
  /** Field the open palette is bound to — kept above the on-screen keyboard (SPEC §8.5). */
  private paletteTarget: HTMLElement | undefined;
  private popoverEntry: PlanEntry | undefined;
  private reviewQueue: PlanEntry[] = [];
  private reviewing = false;
  private repositionScheduled = false;
  /** UI chrome state (page-session lifetime). */
  private badgesHidden = false;
  private barPosition: { left: number; top: number } | undefined;

  private readonly reposition = (): void => this.scheduleReposition();

  constructor(private readonly deps: OverlayUIDeps) {
    this.doc = deps.layer.ownerDocument;
    const style = el(this.doc, 'style');
    style.textContent = OVERLAY_STYLES;
    deps.shadow.append(style);

    this.badgeLayer = el(this.doc, 'div');
    this.bar = el(this.doc, 'div', 'jf-bar');
    // Stays hidden until the first session render — affordance mode (SPEC §8.5) boots the
    // UI without a scan, and an empty styled bar must not linger next to the chip.
    this.bar.hidden = true;
    deps.layer.append(this.badgeLayer, this.bar);

    deps.session.onChange(() => this.render());

    // Badges track their fields through scroll/resize.
    this.doc.defaultView?.addEventListener('scroll', this.reposition, true);
    this.doc.defaultView?.addEventListener('resize', this.reposition);
    // Resizing the bar itself (native corner grip) must re-clamp it into the viewport.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => this.scheduleReposition()).observe(this.bar);
    }

    // Touch platform (SPEC §8.5): coarse pointer → bigger targets, no hover dependence.
    // matchMedia is defended in case an exotic page context lacks it (never crash the overlay).
    const win = this.doc.defaultView;
    const coarse =
      typeof win?.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
    if (win && (coarse || win.navigator.maxTouchPoints > 0)) {
      deps.layer.classList.add('jf-touch');
    }

    // visualViewport → CSS vars (SPEC §8.5): the on-screen keyboard and dynamic URL bar
    // resize the VISUAL viewport only; fixed-position geometry must track it, never 100vh.
    this.viewport = win?.visualViewport ?? undefined;
    this.updateViewportVars();
    this.viewport?.addEventListener('resize', this.onViewportResize);
    this.viewport?.addEventListener('scroll', this.updateViewportVars);

    // Palette shortcut works while the overlay is alive (SPEC §3.6).
    this.doc.addEventListener('keydown', this.onGlobalKeydown, true);
  }

  private viewport: VisualViewport | undefined;

  private readonly updateViewportVars = (): void => {
    const win = this.doc.defaultView;
    const height = this.viewport?.height ?? win?.innerHeight;
    const top = this.viewport?.offsetTop ?? 0;
    if (height !== undefined) {
      this.deps.layer.style.setProperty('--jf-vvh', `${Math.round(height)}px`);
    }
    this.deps.layer.style.setProperty('--jf-vvt', `${Math.round(top)}px`);
  };

  private readonly onViewportResize = (): void => {
    this.updateViewportVars();
    // Keyboard appeared while the palette is bound to a field: keep that field visible
    // (resize only — reacting to visual-viewport scroll would fight the user's panning).
    if (this.paletteEl && this.paletteTarget?.isConnected) {
      this.paletteTarget.scrollIntoView({
        block: 'center',
        behavior: 'instant' as ScrollBehavior,
      });
    }
  };

  destroy(): void {
    this.doc.removeEventListener('keydown', this.onGlobalKeydown, true);
    this.doc.defaultView?.removeEventListener('scroll', this.reposition, true);
    this.doc.defaultView?.removeEventListener('resize', this.reposition);
    this.viewport?.removeEventListener('resize', this.onViewportResize);
    this.viewport?.removeEventListener('scroll', this.updateViewportVars);
  }

  private readonly onGlobalKeydown = (event: KeyboardEvent): void => {
    if (event.altKey && event.shiftKey && event.code === 'Space') {
      event.preventDefault();
      this.openPalette();
    }
    // Esc closes our topmost transient surface from ANYWHERE on the page (palette →
    // map… sublist → popover/review). The fill bar itself stays. When nothing of ours
    // is open, the event passes through untouched — the page keeps its own Esc behavior.
    if (event.key === 'Escape') {
      if (this.paletteEl) {
        event.preventDefault();
        this.closePalette();
      } else if (this.popoverEl) {
        event.preventDefault();
        const mapList = this.popoverEl.querySelector('.jf-map-list');
        if (mapList) mapList.remove();
        else if (this.reviewing) this.endReview();
        else this.closePopover();
      }
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
    this.bar.hidden = false;
    this.bar.replaceChildren();

    // Header row: grip top-left, close top-right. Everything else lives in the wrapping
    // body — a narrow bar stacks vertically, a wide one flows horizontally, and the
    // native bottom-right resize grip lets the user pick any width in between.
    const head = el(this.doc, 'div', 'jf-bar-head');
    const dragHandle = el(this.doc, 'span', 'jf-drag', '⠿');
    dragHandle.title = 'Drag to move · double-click to reset position';
    dragHandle.setAttribute('data-jf', 'drag');
    dragHandle.addEventListener('pointerdown', (event) => this.startBarDrag(event));
    dragHandle.addEventListener('dblclick', () => {
      this.barPosition = undefined; // escape hatch: snap back to the docked default
      this.applyBarLayout();
    });
    const closeBtn = el(this.doc, 'button', 'jf-btn jf-btn-quiet', '✕');
    closeBtn.setAttribute('data-jf', 'close');
    closeBtn.setAttribute('aria-label', 'Close jobfill');
    closeBtn.addEventListener('click', () => this.deps.onClose());
    head.append(dragHandle, closeBtn);
    this.bar.append(head);

    const body = el(this.doc, 'div', 'jf-bar-body');
    this.bar.append(body);

    // Version switcher (SPEC §3.3): always present so the active version is visible AND
    // changeable; names truncate to keep the bar compact (full name in the tooltip).
    if (state.versions.length > 0) {
      const truncate = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name);
      const versionSelect = el(this.doc, 'select', 'jf-version-select');
      versionSelect.setAttribute('data-jf', 'version-select');
      const activeName =
        state.versions.find((v) => v.id === state.activeVersionId)?.name ?? state.activeVersionName;
      versionSelect.title = `Resume version: ${activeName} — switching re-proposes all fields`;
      for (const version of state.versions) {
        const option = el(this.doc, 'option', undefined, truncate(version.name));
        option.value = version.id;
        option.title = version.name;
        option.selected = version.id === state.activeVersionId;
        versionSelect.append(option);
      }
      versionSelect.addEventListener('change', () => {
        void this.deps.session.setActiveVersion(versionSelect.value, this.doc);
      });
      body.append(versionSelect);
    }

    const autoCount = session.autoEntries().length;
    const suggestCount = session.suggestEntries().length;

    // Empty vault: nothing to fill, and no fill button would appear — say why, and offer the
    // one action that fixes it (on-device Android finding: silent no-op was baffling).
    if (!state.hasData) {
      const prompt = el(
        this.doc,
        'span',
        'jf-hint',
        'No data yet — import your résumé to start filling.',
      );
      const openOptions = el(this.doc, 'button', 'jf-btn jf-btn-primary', 'Open options');
      openOptions.setAttribute('data-jf', 'open-options');
      openOptions.addEventListener('click', () => {
        void this.deps.client.send({ t: 'options.open' }).catch(() => undefined);
      });
      body.append(prompt, openOptions);
    } else if (state.entries.length === 0) {
      body.append(
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
      body.append(fillBtn);
    }

    if (suggestCount > 0) {
      const reviewBtn = el(this.doc, 'button', 'jf-btn', `Review ${suggestCount}`);
      reviewBtn.setAttribute('data-jf', 'review');
      reviewBtn.addEventListener('click', () => this.startReview());
      body.append(reviewBtn);
    }

    // Attach target (rung-3 review P0-1): NEVER a deny-listed upload field; prefer the one
    // classified documents.resume, then a sole non-skip file input, then a detected
    // input-less dropzone. No safe target → no button.
    const fileEntries = state.entries.filter(
      (e) => e.field.kind === 'file' && e.classification.tier !== 'skip',
    );
    const resumeEntry =
      fileEntries.find((e) => e.classification.key === 'documents.resume') ??
      (fileEntries.length === 1 ? fileEntries[0] : undefined);
    const dropzoneTarget = resumeEntry ? undefined : findAttachableDropzone(this.doc);
    const attachTarget = resumeEntry?.field.element ?? dropzoneTarget;
    if (attachTarget && state.attachedFile) {
      const targetLabel = resumeEntry
        ? (resumeEntry.classification.key ?? 'upload field')
        : 'dropzone';
      const attachBtn = el(this.doc, 'button', 'jf-btn', `Attach ${state.attachedFile.name}`);
      attachBtn.setAttribute('data-jf', 'attach');
      attachBtn.title = `Attach your stored resume to the detected ${targetLabel}`;
      attachBtn.addEventListener(
        'click',
        () => void this.runAttach(attachTarget, state.attachedFile!.id, attachBtn),
      );
      body.append(attachBtn);
    }

    const paletteBtn = el(this.doc, 'button', 'jf-btn', 'Search ⌥⇧Space');
    paletteBtn.setAttribute('data-jf', 'palette');
    paletteBtn.title = 'Search all snippets and answers';
    paletteBtn.addEventListener('click', () => this.openPalette());
    body.append(paletteBtn);

    const undoBtn = el(this.doc, 'button', 'jf-btn', 'Undo');
    undoBtn.setAttribute('data-jf', 'undo');
    undoBtn.addEventListener('click', () => this.deps.session.undoAll());
    body.append(undoBtn);

    // Badges can cover page UI (icons in field corners) — one click hides them all.
    const badgesBtn = el(this.doc, 'button', 'jf-btn', this.badgesHidden ? 'Badges off' : 'Badges');
    badgesBtn.setAttribute('data-jf', 'toggle-badges');
    badgesBtn.setAttribute('aria-pressed', String(!this.badgesHidden));
    badgesBtn.title = this.badgesHidden
      ? 'Show the field badges again'
      : 'Hide the field badges (they can cover page controls)';
    badgesBtn.addEventListener('click', () => {
      this.badgesHidden = !this.badgesHidden;
      this.render();
    });
    body.append(badgesBtn);

    this.applyBarLayout();
    this.renderBadges();
  }

  /**
   * Re-applies orientation + dragged position after each render, ALWAYS clamped into the
   * viewport — the bar must be unlosable no matter how it got where it is (drag released
   * outside the window, orientation flip changing its size, window resize…).
   */
  private applyBarLayout(): void {
    if (this.barPosition) {
      // Position first so the rect reflects the current orientation, then clamp.
      this.bar.style.left = `${this.barPosition.left}px`;
      this.bar.style.top = `${this.barPosition.top}px`;
      this.bar.style.bottom = 'auto';
      this.bar.style.transform = 'none';
      this.clampBarPosition();
      this.bar.style.left = `${this.barPosition.left}px`;
      this.bar.style.top = `${this.barPosition.top}px`;
    } else {
      this.bar.style.left = '';
      this.bar.style.top = '';
      this.bar.style.bottom = '';
      this.bar.style.transform = '';
    }
  }

  /** Forces the dragged position fully inside the viewport (min 4px margin). */
  private clampBarPosition(): void {
    if (!this.barPosition) return;
    const win = this.doc.defaultView ?? window;
    const { width, height } = this.bar.getBoundingClientRect();
    // Floor the bounds: fractional bar widths otherwise leave a sub-pixel sliver past the
    // viewport edge (right = 1280.00002 on a 1280 window).
    this.barPosition = {
      left: Math.round(
        Math.min(
          Math.max(4, this.barPosition.left),
          Math.max(4, Math.floor(win.innerWidth - width) - 4),
        ),
      ),
      top: Math.round(
        Math.min(
          Math.max(4, this.barPosition.top),
          Math.max(4, Math.floor(win.innerHeight - height) - 4),
        ),
      ),
    };
  }

  private startBarDrag(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    // Pointer capture: the release fires even outside the window — without it, a drag
    // released off-screen skipped the clamp and stranded the bar (live bug).
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      /* synthetic events may carry an unregistered pointerId */
    }
    const rect = this.bar.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const win = this.doc.defaultView ?? window;
    const onMove = (move: PointerEvent) => {
      // Clamp on EVERY move — the bar can never leave the viewport even mid-drag.
      this.barPosition = { left: move.clientX - offsetX, top: move.clientY - offsetY };
      this.applyBarLayout();
    };
    const finish = () => {
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('pointerup', finish);
      win.removeEventListener('pointercancel', finish);
      this.applyBarLayout();
    };
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', finish);
    win.addEventListener('pointercancel', finish);
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
      const result = await this.deps.session.fillEntry(entry);
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

  /**
   * What kind of badge an entry earns: none (deny-listed / file), hollow (unclassified OR
   * classified-but-nothing-stored — still searchable/mappable), or a full proposal badge.
   */
  private badgeKindFor(entry: PlanEntry): 'none' | 'hollow' | 'proposal' {
    const { classification } = entry;
    if (classification.tier === 'skip' || entry.field.kind === 'file') return 'none';
    if (classification.tier === 'manual') return 'hollow';
    // Classified (e.g. a salary question) but the vault holds no value yet: hollow badge so
    // the user can fill it from search or store an answer — vanishing entirely looked like
    // a plain miss (first real-form test).
    if (!entry.value?.value && !entry.value?.choiceTargets) return 'hollow';
    return 'proposal';
  }

  private renderBadges(): void {
    this.badgeLayer.replaceChildren();
    this.badgeLayer.hidden = this.badgesHidden;
    if (this.badgesHidden) return;
    for (const entry of this.deps.session.current.entries) {
      const { classification } = entry;
      const kind = this.badgeKindFor(entry);
      if (kind === 'none') continue;
      if (kind === 'hollow') {
        const manualBadge = el(this.doc, 'button', 'jf-badge jf-manual');
        manualBadge.setAttribute('data-jf-badge', classification.key ?? 'manual');
        manualBadge.title = classification.key
          ? `${classification.key} — nothing stored yet; click to search or save an answer`
          : 'Unrecognized field — search or map it';
        manualBadge.addEventListener('click', () => this.openPopover(entry));
        this.badgeLayer.append(manualBadge);
        this.positionBadge(manualBadge, entry);
        continue;
      }
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
      // A shrinking window must pull a dragged bar back inside.
      if (this.barPosition) this.applyBarLayout();
      const badges = [...this.badgeLayer.children] as HTMLElement[];
      const entries = this.deps.session.current.entries.filter(
        (e) => this.badgeKindFor(e) !== 'none',
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
    pop.setAttribute('aria-modal', 'false'); // anchored, non-modal: Tab intentionally moves fields (SPEC §3.4)

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
    fillBtn.addEventListener('click', () => void this.commitPopover(preview.value, review));
    const mapBtn = el(this.doc, 'button', 'jf-btn', 'map…');
    mapBtn.setAttribute('data-jf', 'popover-map');
    mapBtn.addEventListener('click', () => this.openMapPicker(pop, entry));
    const skipBtn = el(
      this.doc,
      'button',
      'jf-btn jf-btn-quiet',
      review ? 'Skip (S)' : 'Close (Esc)',
    );
    skipBtn.addEventListener('click', () => {
      if (review) {
        this.deps.session.markSkipped(entry); // a skip leaves the Review count too
        this.advanceReview();
      } else {
        this.closePopover();
      }
    });
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
        void this.commitPopover(preview.value, review);
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
        this.deps.session.markSkipped(entry); // S = the same real skip as the button
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

  private async commitPopover(value: string, review: boolean): Promise<void> {
    const entry = this.popoverEntry;
    if (!entry) return;
    const result = await this.deps.session.fillEntry(entry, value, true);
    if (!result.ok) {
      this.toast(result.reason ?? 'Could not fill this field');
      if (entry.field.kind === 'listbox-button') {
        // Honest fallback when the widget refuses to be driven: value on the clipboard.
        const copied = await this.copyToClipboard(value);
        this.toast(
          copied
            ? "Copied — pick the option in the site's own widget"
            : "Couldn’t copy — open the site's own widget and pick the option",
        );
      }
      if (review) this.advanceReview();
      return;
    }
    if (result.ok && !result.verified && result.reason) this.toast(result.reason);
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
    this.reviewing = true;
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
    this.reviewing = false;
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
    this.paletteTarget = target;

    const palette = el(this.doc, 'div', 'jf-palette');
    palette.setAttribute('data-jf', 'palette-dialog'); // the BAR button owns data-jf="palette"
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', 'jobfill search');

    // Header row: hint on the left, close ✕ on the right. Touch devices have no Esc key, so
    // the palette needs a visible dismiss (on-device Android finding).
    const paletteHead = el(this.doc, 'div', 'jf-palette-head');
    paletteHead.append(
      el(
        this.doc,
        'div',
        'jf-palette-target',
        target
          ? `Enter fills the focused field · Shift+Enter copies`
          : `No field focused — Enter copies to clipboard`,
      ),
    );
    const paletteClose = el(this.doc, 'button', 'jf-btn jf-btn-quiet', '✕');
    paletteClose.setAttribute('data-jf', 'palette-close');
    paletteClose.setAttribute('aria-label', 'Close search');
    paletteClose.addEventListener('click', () => this.closePalette());
    paletteHead.append(paletteClose);
    palette.append(paletteHead);

    const search = el(this.doc, 'input', 'jf-search');
    search.placeholder = 'Search snippets, answers, everything…';
    search.setAttribute('data-jf', 'palette-search');
    palette.append(search);

    // Category tabs: browse the whole library by bucket instead of guessing search terms.
    const CATEGORIES: { id: SearchResult['category'] | 'all'; label: string }[] = [
      { id: 'all', label: 'All' },
      { id: 'personal', label: 'Personal' },
      { id: 'work', label: 'Work' },
      { id: 'skills', label: 'Skills' },
      { id: 'links', label: 'Links' },
      { id: 'education', label: 'Education' },
      { id: 'projects', label: 'Projects' },
      { id: 'answers', label: 'Answers' },
    ];
    let selectedCategory: SearchResult['category'] | 'all' = 'all';
    const tabs = el(this.doc, 'div', 'jf-cats');
    tabs.setAttribute('data-jf', 'palette-cats');
    tabs.setAttribute('role', 'tablist');
    for (const category of CATEGORIES) {
      const tab = el(this.doc, 'button', 'jf-cat', category.label);
      tab.setAttribute('data-jf-cat', category.id);
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => {
        selectedCategory = category.id;
        for (const other of tabs.children) {
          other.classList.toggle('jf-cat-on', other.getAttribute('data-jf-cat') === category.id);
        }
        renderResults();
        search.focus();
      });
      if (category.id === 'all') tab.classList.add('jf-cat-on');
      tabs.append(tab);
    }
    palette.append(tabs);

    const results = el(this.doc, 'div', 'jf-options');
    results.setAttribute('data-jf', 'palette-results');
    palette.append(results);

    let selectedIndex = 0;
    let currentResults: SearchResult[] = [];
    const visibleResults = () => {
      const sliced = (
        selectedCategory === 'all'
          ? currentResults
          : currentResults.filter((r) => r.category === selectedCategory)
      ).slice(0, 40);
      if (selectedCategory === 'all') return sliced;
      // Category view: entries of one entity (a position's title/company/summary/bullets)
      // stay together. Groups are ordered by their best-ranked entry; rank order is kept
      // within each group; ungrouped entries ride along as singletons.
      const order: string[] = [];
      const buckets = new Map<string, SearchResult[]>();
      for (const result of sliced) {
        const groupKey = result.groupKey ?? `~solo:${result.id}`;
        const bucket = buckets.get(groupKey);
        if (bucket) {
          bucket.push(result);
        } else {
          buckets.set(groupKey, [result]);
          order.push(groupKey);
        }
      }
      return order.flatMap((groupKey) => buckets.get(groupKey) ?? []);
    };

    let armedSensitive: SearchResult | undefined;
    const commit = (result: SearchResult | undefined, copy: boolean) => {
      if (!result) return;
      if (!copy && target) {
        // Sensitive values need a second, deliberate keystroke (SPEC §7.9) — same rule as
        // the popover's Confirm & fill (whole-night review P1-2).
        if (result.sensitive && armedSensitive !== result) {
          armedSensitive = result;
          this.toast('🔒 Sensitive — press Enter again to fill this field');
          return;
        }
        armedSensitive = undefined;
        const entry =
          this.deps.session.current.entries.find((e) => e.field.element === target) ??
          this.classifyLooseTarget(target);
        // The deny-list holds even for fields the scan missed (rung-2 review P0-2): a
        // password/SSN/DOB input focused by the user is still refused.
        void this.deps.session.fillEntry(entry, result.value, true).then((fillResult) => {
          if (fillResult.ok) {
            this.toast(
              fillResult.verified ? 'Filled' : 'Filled — but the site may have rewritten it',
            );
          } else {
            this.toast(fillResult.reason ?? 'Could not fill this field');
          }
          this.closePalette();
        });
        return;
      } else {
        // Copy is async and can be refused (Android Firefox, no document focus): await the
        // real outcome and tell the truth (was: unconditional "Copied", which lied on the
        // Pixel 9a on-device test).
        void this.copyToClipboard(result.value).then((ok) => {
          this.toast(
            ok ? 'Copied to clipboard' : 'Couldn’t copy — focus a field and use Enter to fill',
          );
        });
      }
      this.closePalette();
    };

    const renderResults = () => {
      results.replaceChildren();
      let lastGroup: string | undefined;
      visibleResults().forEach((result, i) => {
        // Group headings in category view only — the ranked All view stays flat.
        if (selectedCategory !== 'all' && result.group && result.group !== lastGroup) {
          const heading = el(this.doc, 'div', 'jf-group', result.group);
          heading.setAttribute('data-jf', 'palette-group');
          results.append(heading);
        }
        lastGroup = result.group;
        const option = el(
          this.doc,
          'button',
          `jf-option${i === selectedIndex ? ' jf-active' : ''}`,
        );
        // Under a heading the entity is already named — use the short label.
        const label =
          selectedCategory !== 'all' && result.group
            ? (result.shortLabel ?? result.label)
            : result.label;
        option.append(
          el(this.doc, 'span', 'jf-option-label', `${result.sensitive ? '🔒 ' : ''}${label}`),
          el(this.doc, 'span', 'jf-option-value', result.value),
        );
        option.addEventListener('click', () => commit(result, false));
        results.append(option);
      });
      if (visibleResults().length === 0 && search.value.trim()) {
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
          .send({ t: 'snippets.search', q: search.value, limit: 100 })
          .then(({ results: found }) => {
            currentResults = found;
            selectedIndex = 0;
            renderResults();
          })
          .catch(() => undefined);
      }, 80);
    };
    search.addEventListener('input', runSearch);

    palette.setAttribute('aria-modal', 'true');
    palette.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        // Focus trap (rung-4 a11y): Tab cycles within the palette, never escapes to the page.
        const focusables = [...palette.querySelectorAll<HTMLElement>('input, button')].filter(
          (node) => !node.hidden,
        );
        if (focusables.length > 0) {
          event.preventDefault();
          const active = this.deps.shadow.activeElement as HTMLElement | null;
          const index = active ? focusables.indexOf(active) : -1;
          const next =
            focusables[(index + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length];
          next?.focus();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closePalette();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, visibleResults().length - 1);
        renderResults();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderResults();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        commit(visibleResults()[selectedIndex], event.shiftKey || !target);
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
    this.paletteTarget = undefined;
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
    // Same options as scan-time classification: the answers bank's sensitivity flags apply
    // to loose targets too (whole-night review P1-2).
    const result = classifyFields([signals], { answers: this.deps.session.answers });
    return { field, signals, classification: result.fields[0]! };
  }

  /** Rung 3 (SPEC §3.7): pull the stored file from the background and attach it. */
  private attaching = false;

  private async runAttach(
    target: Element,
    fileId: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (this.attaching) return; // double-click guard (drop path would deliver twice)
    this.attaching = true;
    button.disabled = true;
    try {
      const { file } = await this.deps.client.send({ t: 'file.get', fileId });
      const result = attachFile(target, file, this.doc.defaultView ?? window);
      if (result.ok) {
        this.toast(
          result.verified
            ? `Attached ${file.name}`
            : `Dropped ${file.name} — check the site accepted it`,
        );
      } else {
        this.toast(`Could not attach: ${result.reason ?? 'unknown'} — use the field's own picker`);
      }
    } catch (err) {
      this.toast(err instanceof Error ? err.message : 'Could not load the stored file');
    } finally {
      this.attaching = false;
      button.disabled = false;
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
            el(
              this.doc,
              'span',
              'jf-option-label',
              `${result.sensitive ? '🔒 ' : ''}${result.label}`,
            ),
            el(this.doc, 'span', 'jf-option-value', result.value),
          );
          option.addEventListener('click', () => onPick(result));
          box.append(option);
        }
      })
      .catch(() => undefined);
  }

  /** Resolves true only when the value actually reached the clipboard. */
  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Async Clipboard API refused (no focus / permission) — fall through to execCommand.
    }
    // Fallback: off-screen textarea + execCommand. Must be focusable (not display:none) and
    // explicitly range-selected — `.select()` alone is unreliable on Android (on-device fix).
    try {
      const ta = this.doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      this.doc.body.append(ta);
      ta.focus();
      ta.setSelectionRange(0, text.length);
      const ok = this.doc.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  private toast(message: string): void {
    const toast = el(this.doc, 'div', 'jf-toast', message);
    toast.setAttribute('data-jf', 'toast');
    this.deps.layer.append(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  /** Public toast, for the bootstrap activation path (e.g. a failed first scan). */
  notify(message: string): void {
    this.toast(message);
  }
}
