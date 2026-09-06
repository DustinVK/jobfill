/** Work experience editor: entries with summary snippet + bullets, each with variants. */
import { useState } from 'preact/hooks';
import type { Snippet, WorkExperience } from '../../shared/types.js';
import { newId } from '../../shared/vault.js';
import { SnippetEditor } from './SnippetEditor.js';

function freshSnippet(label?: string): Snippet {
  const variantId = newId();
  return {
    id: newId(),
    label,
    tags: [],
    variants: [{ id: variantId, style: 'impact', text: '' }],
    defaultVariantId: variantId,
  };
}

function freshWork(): WorkExperience {
  return {
    id: newId(),
    company: '',
    title: '',
    startDate: '',
    current: false,
    summary: freshSnippet('Summary'),
    bullets: [],
  };
}

function WorkEntry({
  work,
  onChange,
  onRemove,
}: {
  work: WorkExperience;
  onChange: (next: WorkExperience) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const set = <K extends keyof WorkExperience>(key: K, value: WorkExperience[K]) =>
    onChange({ ...work, [key]: value });

  return (
    <section class="panel" data-testid="work-entry">
      <div class="entry-head">
        <button type="button" class="btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'}
        </button>
        <strong>{work.title || 'New role'}</strong>
        <span class="muted">{work.company ? ` @ ${work.company}` : ''}</span>
        <span class="spacer" />
        <button type="button" class="btn-ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
      {open && (
        <div>
          <div class="grid-2">
            <label class="field">
              <span>Company</span>
              <input
                type="text"
                value={work.company}
                data-testid="work-company"
                onInput={(e) => set('company', (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span>Title</span>
              <input
                type="text"
                value={work.title}
                data-testid="work-title"
                onInput={(e) => set('title', (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span>Location</span>
              <input
                type="text"
                value={work.location ?? ''}
                onInput={(e) =>
                  set('location', (e.currentTarget as HTMLInputElement).value || undefined)
                }
              />
            </label>
            <label class="field">
              <span>Start (YYYY-MM)</span>
              <input
                type="month"
                value={work.startDate}
                data-testid="work-start"
                onInput={(e) => set('startDate', (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span>End (YYYY-MM)</span>
              <input
                type="month"
                value={work.endDate ?? ''}
                disabled={work.current}
                onInput={(e) =>
                  set('endDate', (e.currentTarget as HTMLInputElement).value || undefined)
                }
              />
            </label>
            <label class="field field-inline">
              <input
                type="checkbox"
                checked={work.current}
                onChange={(e) => set('current', (e.currentTarget as HTMLInputElement).checked)}
              />
              <span>I currently work here</span>
            </label>
          </div>

          <h3>Summary</h3>
          <SnippetEditor
            snippet={work.summary}
            onChange={(summary) => set('summary', summary)}
            placeholder="What you owned and achieved in this role…"
          />

          <h3>Bullets</h3>
          {work.bullets.map((bullet, i) => (
            <div class="bullet-block" key={bullet.id} data-testid="bullet-block">
              <div class="entry-head">
                <label class="field field-grow">
                  <span class="sr-only">Bullet label</span>
                  <input
                    type="text"
                    value={bullet.label ?? ''}
                    placeholder={`Bullet ${i + 1} label (for the palette)`}
                    onInput={(e) =>
                      set(
                        'bullets',
                        work.bullets.map((b) =>
                          b.id === bullet.id
                            ? {
                                ...b,
                                label: (e.currentTarget as HTMLInputElement).value || undefined,
                              }
                            : b,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  class="btn-ghost"
                  onClick={() =>
                    set(
                      'bullets',
                      work.bullets.filter((b) => b.id !== bullet.id),
                    )
                  }
                >
                  Remove bullet
                </button>
              </div>
              <SnippetEditor
                snippet={bullet}
                onChange={(next) =>
                  set(
                    'bullets',
                    work.bullets.map((b) => (b.id === next.id ? next : b)),
                  )
                }
                placeholder="One accomplishment or duty…"
              />
            </div>
          ))}
          <button
            type="button"
            data-testid="add-bullet"
            onClick={() => set('bullets', [...work.bullets, freshSnippet()])}
          >
            + Add bullet
          </button>
        </div>
      )}
    </section>
  );
}

export function WorkEditor({
  work,
  onChange,
}: {
  work: WorkExperience[];
  onChange: (next: WorkExperience[]) => void;
}) {
  return (
    <div>
      {work.map((entry) => (
        <WorkEntry
          key={entry.id}
          work={entry}
          onChange={(next) => onChange(work.map((w) => (w.id === next.id ? next : w)))}
          onRemove={() => onChange(work.filter((w) => w.id !== entry.id))}
        />
      ))}
      <button type="button" data-testid="add-work" onClick={() => onChange([...work, freshWork()])}>
        + Add work experience
      </button>
    </div>
  );
}
