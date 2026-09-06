/**
 * Variant editor (SPEC §3.2 — the heart of G1). Used for every snippet: summaries, bullets,
 * cover letter. Style chips, per-variant char counts, add/remove, default marker.
 */
import type { Snippet, Variant } from '../../shared/types.js';
import { KNOWN_VARIANT_STYLES } from '../../shared/types.js';
import { newId } from '../../shared/vault.js';

export function SnippetEditor({
  snippet,
  onChange,
  placeholder,
}: {
  snippet: Snippet;
  onChange: (next: Snippet) => void;
  placeholder?: string;
}) {
  const updateVariant = (id: string, patch: Partial<Variant>) => {
    onChange({
      ...snippet,
      variants: snippet.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  };

  const addVariant = () => {
    // SPEC §3.2: "Add variant" pre-fills with the current default text for editing.
    const current = snippet.variants.find((v) => v.id === snippet.defaultVariantId);
    const unusedStyle =
      KNOWN_VARIANT_STYLES.find((s) => !snippet.variants.some((v) => v.style === s)) ?? 'custom';
    const variant: Variant = { id: newId(), style: unusedStyle, text: current?.text ?? '' };
    onChange({ ...snippet, variants: [...snippet.variants, variant] });
  };

  const removeVariant = (id: string) => {
    if (snippet.variants.length <= 1) return; // a snippet always keeps ≥1 variant
    const variants = snippet.variants.filter((v) => v.id !== id);
    onChange({
      ...snippet,
      variants,
      defaultVariantId:
        snippet.defaultVariantId === id ? (variants[0]?.id ?? '') : snippet.defaultVariantId,
    });
  };

  return (
    <div class="snippet-editor">
      {snippet.variants.map((variant) => (
        <div class="variant-row" key={variant.id} data-testid="variant-row">
          <div class="variant-head">
            <span class="style-chips" role="group" aria-label="Variant style">
              {KNOWN_VARIANT_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  class={`chip ${variant.style === style ? 'chip-on' : ''}`}
                  onClick={() => updateVariant(variant.id, { style })}
                >
                  {style}
                </button>
              ))}
              <input
                class="chip-custom"
                type="text"
                value={
                  (KNOWN_VARIANT_STYLES as readonly string[]).includes(variant.style)
                    ? ''
                    : variant.style
                }
                placeholder="custom…"
                aria-label="Custom style label"
                onChange={(e) => {
                  const label = (e.currentTarget as HTMLInputElement).value.trim();
                  if (label) updateVariant(variant.id, { style: label });
                }}
              />
            </span>
            <label class="default-pick">
              <input
                type="radio"
                name={`default-${snippet.id}`}
                checked={snippet.defaultVariantId === variant.id}
                onChange={() => onChange({ ...snippet, defaultVariantId: variant.id })}
              />
              default
            </label>
            <span class="char-count" title="Character count (many ATS fields have maxlength)">
              {variant.text.length}
            </span>
            <button
              type="button"
              class="btn-ghost"
              disabled={snippet.variants.length <= 1}
              onClick={() => removeVariant(variant.id)}
              aria-label={`Remove ${variant.style} variant`}
            >
              ✕
            </button>
          </div>
          <textarea
            rows={3}
            value={variant.text}
            placeholder={placeholder}
            data-testid={`variant-text-${variant.style}`}
            onInput={(e) =>
              updateVariant(variant.id, { text: (e.currentTarget as HTMLTextAreaElement).value })
            }
          />
        </div>
      ))}
      <button type="button" class="btn-ghost" onClick={addVariant} data-testid="add-variant">
        + Add variant
      </button>
    </div>
  );
}
