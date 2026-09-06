/**
 * Answers bank editor (SPEC §4.3). Sensitive flag per entry; EEO storage sits behind an
 * explicit opt-in gate, EEO entries are forced sensitive, and the UI says why they exist.
 */
import type { AnswerEntry, AnswerKind, Settings, WellKnownAnswerKey } from '../../shared/types.js';
import {
  ALWAYS_SENSITIVE_ANSWER_KEYS,
  EEO_ANSWER_KEYS,
  WELL_KNOWN_ANSWER_KEYS,
} from '../../shared/types.js';
import { newId } from '../../shared/vault.js';

const KIND_OPTIONS: AnswerKind[] = ['boolean', 'choice', 'text', 'number', 'date'];

function isEeo(key: WellKnownAnswerKey | undefined): boolean {
  return key !== undefined && EEO_ANSWER_KEYS.includes(key);
}

function forcedSensitive(key: WellKnownAnswerKey | undefined): boolean {
  return key !== undefined && ALWAYS_SENSITIVE_ANSWER_KEYS.includes(key);
}

function AnswerRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: AnswerEntry;
  onChange: (next: AnswerEntry) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof AnswerEntry>(key: K, value: AnswerEntry[K]) =>
    onChange({ ...entry, [key]: value });

  return (
    <div class="panel answer-row" data-testid="answer-row">
      <div class="grid-2">
        <label class="field">
          <span>Well-known key</span>
          <select
            value={entry.key ?? ''}
            onChange={(e) => {
              const raw = (e.currentTarget as HTMLSelectElement).value;
              const key = raw === '' ? undefined : (raw as WellKnownAnswerKey);
              onChange({
                ...entry,
                key,
                sensitive: forcedSensitive(key) ? true : entry.sensitive,
              });
            }}
          >
            <option value="">custom question</option>
            {WELL_KNOWN_ANSWER_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Kind</span>
          <select
            value={entry.kind}
            onChange={(e) =>
              set('kind', (e.currentTarget as HTMLSelectElement).value as AnswerKind)
            }
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label class="field">
        <span>Question (as you think of it)</span>
        <input
          type="text"
          value={entry.question}
          data-testid="answer-question"
          onInput={(e) => set('question', (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="field">
        <span>Answer</span>
        {entry.kind === 'boolean' ? (
          <select
            value={String(entry.value)}
            data-testid="answer-value"
            onChange={(e) => set('value', (e.currentTarget as HTMLSelectElement).value === 'true')}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            type={entry.kind === 'number' ? 'number' : 'text'}
            value={String(entry.value)}
            data-testid="answer-value"
            onInput={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value;
              set('value', entry.kind === 'number' ? Number(raw) : raw);
            }}
          />
        )}
      </label>
      <label class="field">
        <span>Match patterns (comma-separated regex fragments)</span>
        <input
          type="text"
          value={entry.patterns.join(', ')}
          onChange={(e) =>
            set(
              'patterns',
              (e.currentTarget as HTMLInputElement).value
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      {entry.kind === 'choice' && (
        <label class="field">
          <span>Acceptable option labels (comma-separated)</span>
          <input
            type="text"
            value={(entry.choiceSynonyms ?? []).join(', ')}
            onChange={(e) =>
              set(
                'choiceSynonyms',
                (e.currentTarget as HTMLInputElement).value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      )}
      <div class="entry-head">
        <label
          class="field-inline"
          title={forcedSensitive(entry.key) ? 'Always sensitive for this key' : ''}
        >
          <input
            type="checkbox"
            checked={entry.sensitive}
            disabled={forcedSensitive(entry.key)}
            data-testid="answer-sensitive"
            onChange={(e) => set('sensitive', (e.currentTarget as HTMLInputElement).checked)}
          />
          <span>
            Sensitive — never in fill-all; explicit per-field confirm only
            {forcedSensitive(entry.key) ? ' (locked for this key)' : ''}
          </span>
        </label>
        <span class="spacer" />
        <button type="button" class="btn-ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

export function AnswersEditor({
  answers,
  settings,
  onChange,
  onSettingsChange,
}: {
  answers: AnswerEntry[];
  settings: Settings;
  onChange: (next: AnswerEntry[]) => void;
  onSettingsChange: (next: Settings) => void;
}) {
  const eeoEntries = answers.filter((a) => isEeo(a.key));
  const regularEntries = answers.filter((a) => !isEeo(a.key));

  const addEntry = (key?: WellKnownAnswerKey) => {
    const entry: AnswerEntry = {
      id: newId(),
      key,
      question: '',
      patterns: [],
      kind: key === 'sponsorship' || key === 'workAuthorization' ? 'boolean' : 'text',
      value: '',
      sensitive: forcedSensitive(key),
    };
    onChange([...answers, entry]);
  };

  return (
    <div>
      {regularEntries.map((entry) => (
        <AnswerRow
          key={entry.id}
          entry={entry}
          onChange={(next) => onChange(answers.map((a) => (a.id === next.id ? next : a)))}
          onRemove={() => onChange(answers.filter((a) => a.id !== entry.id))}
        />
      ))}
      <button type="button" data-testid="add-answer" onClick={() => addEntry()}>
        + Add answer
      </button>

      <section class="panel eeo-panel">
        <h2>Demographic / EEO self-identification</h2>
        <p class="muted">
          These exist only so <em>you</em> can one-click them per field. Storing them is opt-in;
          they are always marked sensitive, are excluded from fill-all, and each fill needs an
          explicit confirmation on the page.
        </p>
        <label class="field-inline">
          <input
            type="checkbox"
            checked={settings.storeEeoAnswers}
            data-testid="eeo-opt-in"
            onChange={(e) => {
              const enabled = (e.currentTarget as HTMLInputElement).checked;
              if (!enabled) {
                // Opting out removes stored EEO answers — they were only storable under the gate.
                onChange(answers.filter((a) => !isEeo(a.key)));
              }
              onSettingsChange({ ...settings, storeEeoAnswers: enabled });
            }}
          />
          <span>Allow storing EEO answers</span>
        </label>
        {settings.storeEeoAnswers && (
          <div>
            {eeoEntries.map((entry) => (
              <AnswerRow
                key={entry.id}
                entry={entry}
                onChange={(next) => onChange(answers.map((a) => (a.id === next.id ? next : a)))}
                onRemove={() => onChange(answers.filter((a) => a.id !== entry.id))}
              />
            ))}
            <div class="chip-row">
              {EEO_ANSWER_KEYS.filter((k) => !eeoEntries.some((e) => e.key === k)).map((k) => (
                <button key={k} type="button" class="chip" onClick={() => addEntry(k)}>
                  + {k}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
