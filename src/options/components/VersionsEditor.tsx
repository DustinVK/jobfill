/**
 * Versions list (Rung 1 scope: name + stylePriority editable, set active, add/remove;
 * the full composer UI is SPEC M5 / out of scope tonight).
 */
import type { ResumeVersion, Vault } from '../../shared/types.js';
import { createDefaultVersion, newId } from '../../shared/vault.js';

export function VersionsEditor({
  vault,
  onChange,
  onSetActive,
}: {
  vault: Vault;
  onChange: (versions: ResumeVersion[]) => void;
  onSetActive: (id: string) => void;
}) {
  const versions = vault.versions;

  const addVersion = () => {
    const version = createDefaultVersion(newId());
    version.name = `Version ${versions.length + 1}`;
    // New versions start as "everything" lenses over the current data.
    version.include = {
      workIds: vault.work.map((w) => w.id),
      educationIds: vault.education.map((e) => e.id),
      projectIds: vault.projects.map((p) => p.id),
      certificationIds: vault.certifications.map((c) => c.id),
    };
    onChange([...versions, version]);
  };

  return (
    <div>
      <p class="muted">
        A version is a saved lens over your data: which entries are included and which phrasing
        style wins. The full composer (per-snippet picks) lands later; tonight you can rename,
        reorder style priority, and switch the active version.
      </p>
      {versions.map((version) => {
        const isActive = vault.settings.activeVersionId === version.id;
        return (
          <section
            class={`panel ${isActive ? 'panel-active' : ''}`}
            key={version.id}
            data-testid="version-row"
          >
            <div class="entry-head">
              <label class="field field-grow">
                <span class="sr-only">Version name</span>
                <input
                  type="text"
                  value={version.name}
                  data-testid="version-name"
                  onInput={(e) =>
                    onChange(
                      versions.map((v) =>
                        v.id === version.id
                          ? { ...v, name: (e.currentTarget as HTMLInputElement).value }
                          : v,
                      ),
                    )
                  }
                />
              </label>
              {isActive ? (
                <span class="badge-active" data-testid="active-badge">
                  active
                </span>
              ) : (
                <button type="button" onClick={() => onSetActive(version.id)}>
                  Make active
                </button>
              )}
              <button
                type="button"
                class="btn-ghost"
                disabled={versions.length <= 1}
                onClick={() => onChange(versions.filter((v) => v.id !== version.id))}
              >
                Remove
              </button>
            </div>
            <label class="field">
              <span>Style priority (comma-separated fallback order, e.g. "impact, short")</span>
              <input
                type="text"
                value={version.stylePriority.join(', ')}
                data-testid="version-styles"
                onChange={(e) =>
                  onChange(
                    versions.map((v) =>
                      v.id === version.id
                        ? {
                            ...v,
                            stylePriority: (e.currentTarget as HTMLInputElement).value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          }
                        : v,
                    ),
                  )
                }
              />
            </label>
            <p class="muted">
              Includes {version.include.workIds.length} work · {version.include.educationIds.length}{' '}
              education · {version.include.projectIds.length} projects
              {version.fileId ? ' · resume file attached' : ''}
            </p>
          </section>
        );
      })}
      <button type="button" onClick={addVersion}>
        + Add version
      </button>
    </div>
  );
}
