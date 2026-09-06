// @vitest-environment jsdom
/**
 * Attach-branch unit tests (SPEC §7.5). jsdom exercises environment DETECTION and the
 * hidden-input discovery; the actual `.files` set + drop delivery are e2e territory
 * (jsdom's DataTransfer is too partial), and the wrappedJSObject branch itself is
 * real-extension-only (manual QA).
 */
import { describe, expect, it } from 'vitest';
import { detectAttachEnvironment, findHiddenFileInput } from '../../src/content/attach.js';

describe('detectAttachEnvironment', () => {
  it('picks the plain branch when wrappedJSObject is absent (harness/e2e)', () => {
    expect(detectAttachEnvironment(window)).toBe('plain');
  });

  it('picks the page-compartment branch when wrappedJSObject.DataTransfer exists (Firefox)', () => {
    const fakeFirefoxWindow = Object.create(window) as Window & typeof globalThis;
    Object.defineProperty(fakeFirefoxWindow, 'wrappedJSObject', {
      value: { DataTransfer: class {} },
      configurable: true,
    });
    expect(detectAttachEnvironment(fakeFirefoxWindow)).toBe('page-compartment');
  });

  it('falls back to plain when wrappedJSObject exists without DataTransfer', () => {
    const partial = Object.create(window) as Window & typeof globalThis;
    Object.defineProperty(partial, 'wrappedJSObject', { value: {}, configurable: true });
    expect(detectAttachEnvironment(partial)).toBe('plain');
  });
});

describe('findHiddenFileInput', () => {
  it('finds an input inside the dropzone', () => {
    document.body.innerHTML = `
      <div id="zone" class="drop-zone">
        <p>Drop your resume here</p>
        <input type="file" id="hidden-input" style="display:none">
      </div>`;
    const found = findHiddenFileInput(document.getElementById('zone')!);
    expect(found?.id).toBe('hidden-input');
  });

  it('finds a sibling input near the dropzone (Lever pattern)', () => {
    document.body.innerHTML = `
      <div class="application-field">
        <div id="zone" class="resume-upload-card">ATTACH RESUME/CV</div>
        <input type="file" id="resume-upload-input" style="display:none">
      </div>`;
    const found = findHiddenFileInput(document.getElementById('zone')!);
    expect(found?.id).toBe('resume-upload-input');
  });

  it('returns null when no file input exists anywhere near', () => {
    document.body.innerHTML = `<div id="zone"><p>Pure JS uploader</p></div>`;
    expect(findHiddenFileInput(document.getElementById('zone')!)).toBeNull();
  });
});

describe('findHiddenFileInput — multiple upload zones on one page', () => {
  it('never steals the input of a DIFFERENT dropzone', () => {
    document.body.innerHTML = `
      <div class="drop-zone" id="resume-zone">
        <input type="file" id="resume-input" style="display:none">
      </div>
      <div class="drop-zone" id="cover-zone">
        <p>Drop cover letter (no input — pure JS uploader)</p>
      </div>`;
    // From the resume zone: its own input.
    expect(findHiddenFileInput(document.getElementById('resume-zone')!)?.id).toBe('resume-input');
    // From the input-less cover zone: NOT the resume zone's input.
    expect(findHiddenFileInput(document.getElementById('cover-zone')!)).toBeNull();
  });
});
