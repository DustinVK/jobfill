/** Profile editor: identity, contact, address, links, skills, summary snippet. */
import type { Profile, Snippet } from '../../shared/types.js';
import { newId } from '../../shared/vault.js';
import { SnippetEditor } from './SnippetEditor.js';

type Scalars = Record<string, string | undefined>;

function Field({
  label,
  value,
  onInput,
  type = 'text',
  autoComplete,
  name,
}: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  type?: string;
  autoComplete?: string;
  name?: string;
}) {
  return (
    <label class="field">
      <span>{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        autocomplete={autoComplete}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  );
}

export function ProfileEditor({
  profile,
  onChange,
}: {
  profile: Profile;
  onChange: (next: Profile) => void;
}) {
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    onChange({ ...profile, [key]: value });
  // Required scalars (firstName/lastName) keep '' when cleared — their types are `string`,
  // not `string | undefined`; optional ones drop to undefined so exports stay clean.
  const REQUIRED = new Set(['identity.firstName', 'identity.lastName']);
  const setIn = (section: 'identity' | 'address' | 'links', key: string, value: string) =>
    onChange({
      ...profile,
      [section]: {
        ...(profile[section] as Scalars),
        [key]: REQUIRED.has(`${section}.${key}`) ? value : value || undefined,
      },
    });

  const emptySummary = (): Snippet => {
    const id = newId();
    return {
      id: newId(),
      label: 'Professional summary',
      tags: [],
      variants: [{ id, style: 'impact', text: '' }],
      defaultVariantId: id,
    };
  };

  return (
    <div>
      <section class="panel">
        <h2>Identity</h2>
        <div class="grid-2">
          {/* SPEC Appendix B.1: emit correct autocomplete tokens in our own forms. */}
          <Field
            label="First name"
            name="firstName"
            autoComplete="given-name"
            value={profile.identity.firstName}
            onInput={(v) => setIn('identity', 'firstName', v)}
          />
          <Field
            label="Last name"
            name="lastName"
            autoComplete="family-name"
            value={profile.identity.lastName}
            onInput={(v) => setIn('identity', 'lastName', v)}
          />
          <Field
            label="Middle name"
            autoComplete="additional-name"
            value={profile.identity.middleName ?? ''}
            onInput={(v) => setIn('identity', 'middleName', v)}
          />
          <Field
            label="Preferred name"
            value={profile.identity.preferredName ?? ''}
            onInput={(v) => setIn('identity', 'preferredName', v)}
          />
        </div>
      </section>

      <section class="panel">
        <h2>Contact</h2>
        <div class="grid-2">
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={profile.contact.email}
            onInput={(v) => onChange({ ...profile, contact: { ...profile.contact, email: v } })}
          />
          <Field
            label="Secondary email"
            type="email"
            value={profile.contact.secondaryEmail ?? ''}
            onInput={(v) =>
              onChange({
                ...profile,
                contact: { ...profile.contact, secondaryEmail: v || undefined },
              })
            }
          />
          <Field
            label="Phone country code"
            autoComplete="tel-country-code"
            value={profile.contact.phone.countryCode}
            onInput={(v) =>
              onChange({
                ...profile,
                contact: {
                  ...profile.contact,
                  phone: { ...profile.contact.phone, countryCode: v },
                },
              })
            }
          />
          <Field
            label="Phone (national)"
            name="phone"
            type="tel"
            autoComplete="tel-national"
            value={profile.contact.phone.national}
            onInput={(v) =>
              onChange({
                ...profile,
                contact: { ...profile.contact, phone: { ...profile.contact.phone, national: v } },
              })
            }
          />
          <label class="field">
            <span>Phone type</span>
            <select
              value={profile.contact.phoneType ?? ''}
              onChange={(e) => {
                const value = (e.currentTarget as HTMLSelectElement).value;
                onChange({
                  ...profile,
                  contact: {
                    ...profile.contact,
                    phoneType: value === '' ? undefined : (value as 'mobile' | 'home' | 'work'),
                  },
                });
              }}
            >
              <option value="">—</option>
              <option value="mobile">mobile</option>
              <option value="home">home</option>
              <option value="work">work</option>
            </select>
          </label>
        </div>
      </section>

      <section class="panel">
        <h2>Address</h2>
        <div class="grid-2">
          <Field
            label="Line 1"
            autoComplete="address-line1"
            value={profile.address.line1 ?? ''}
            onInput={(v) => setIn('address', 'line1', v)}
          />
          <Field
            label="Line 2"
            autoComplete="address-line2"
            value={profile.address.line2 ?? ''}
            onInput={(v) => setIn('address', 'line2', v)}
          />
          <Field
            label="City"
            autoComplete="address-level2"
            value={profile.address.city ?? ''}
            onInput={(v) => setIn('address', 'city', v)}
          />
          <Field
            label="State / region"
            autoComplete="address-level1"
            value={profile.address.state ?? ''}
            onInput={(v) => setIn('address', 'state', v)}
          />
          <Field
            label="Postal code"
            autoComplete="postal-code"
            value={profile.address.postalCode ?? ''}
            onInput={(v) => setIn('address', 'postalCode', v)}
          />
          <Field
            label="Country"
            autoComplete="country-name"
            value={profile.address.country ?? ''}
            onInput={(v) => setIn('address', 'country', v)}
          />
        </div>
      </section>

      <section class="panel">
        <h2>Links</h2>
        <div class="grid-2">
          <Field
            label="LinkedIn"
            type="url"
            value={profile.links.linkedin ?? ''}
            onInput={(v) => setIn('links', 'linkedin', v)}
          />
          <Field
            label="GitHub"
            type="url"
            value={profile.links.github ?? ''}
            onInput={(v) => setIn('links', 'github', v)}
          />
          <Field
            label="Portfolio"
            type="url"
            value={profile.links.portfolio ?? ''}
            onInput={(v) => setIn('links', 'portfolio', v)}
          />
          <Field
            label="Website"
            type="url"
            value={profile.links.website ?? ''}
            onInput={(v) => setIn('links', 'website', v)}
          />
        </div>
      </section>

      <section class="panel">
        <h2>Skills</h2>
        <label class="field">
          <span>Comma-separated master list (versions can subset later)</span>
          <input
            type="text"
            value={profile.skills.join(', ')}
            data-testid="skills-input"
            onChange={(e) =>
              set(
                'skills',
                (e.currentTarget as HTMLInputElement).value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      </section>

      <section class="panel">
        <h2>Professional summary</h2>
        {profile.summary ? (
          <SnippetEditor
            snippet={profile.summary}
            onChange={(summary) => set('summary', summary)}
            placeholder="A 2–3 sentence professional summary…"
          />
        ) : (
          <button type="button" onClick={() => set('summary', emptySummary())}>
            + Add summary
          </button>
        )}
      </section>
    </div>
  );
}
