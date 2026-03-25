// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — Simple JSON syntax highlighter
 *
 * Tokenizes JSON text and wraps tokens in <span> elements with CSS classes.
 * Colors are applied via CSS custom properties in globals.css — both themes work.
 *
 * CSS classes emitted:
 *   .hl-key     — object keys (e.g. "name")
 *   .hl-str     — string values (e.g. "engineering")
 *   .hl-num     — number values (e.g. 42, 3.14)
 *   .hl-bool    — boolean values (true / false)
 *   .hl-null    — null
 *   .hl-punc    — punctuation ({}[],:)
 */
export function highlightJson(json: string): string {
  // We use a state machine to distinguish keys from string values.
  let inString  = false;
  let isKey     = false;   // true when this string token is an object key
  let escaped   = false;
  let output    = '';
  let buf       = '';
  // Track context stack: 'obj' | 'arr'
  const stack: Array<'obj' | 'arr'> = [];
  // Whether the next value in the current object is at key position
  let expectKey = false;

  function flushBuf(): void {
    if (buf === '') return;
    output += buf;
    buf     = '';
  }

  function span(cls: string, content: string): string {
    return `<span class="${cls}">${escapeHtml(content)}</span>`;
  }

  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;

    if (escaped) {
      buf    += ch;
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        buf    += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        const cls = isKey ? 'hl-key' : 'hl-str';
        output += span(cls, `"${buf}"`);
        buf     = '';
        if (isKey) {
          // After a key, expect ':' then a value
          isKey = false;
        }
        continue;
      }
      buf += ch;
      continue;
    }

    // Not in string
    if (ch === '"') {
      flushBuf();
      inString = true;
      buf      = '';
      // Determine if key: only when top of stack is 'obj' and we expect a key
      isKey    = stack.length > 0 && stack[stack.length - 1] === 'obj' && expectKey;
      continue;
    }

    if (ch === '{') {
      flushBuf();
      stack.push('obj');
      expectKey = true;
      output += span('hl-punc', '{');
      continue;
    }

    if (ch === '}') {
      flushBuf();
      stack.pop();
      expectKey = stack.length > 0 && stack[stack.length - 1] === 'obj';
      output += span('hl-punc', '}');
      continue;
    }

    if (ch === '[') {
      flushBuf();
      stack.push('arr');
      expectKey = false;
      output += span('hl-punc', '[');
      continue;
    }

    if (ch === ']') {
      flushBuf();
      stack.pop();
      expectKey = stack.length > 0 && stack[stack.length - 1] === 'obj';
      output += span('hl-punc', ']');
      continue;
    }

    if (ch === ':') {
      flushBuf();
      // After colon, next token is a value (not a key)
      expectKey = false;
      output += span('hl-punc', ':');
      continue;
    }

    if (ch === ',') {
      flushBuf();
      // After comma in an object, next token is a key
      if (stack.length > 0 && stack[stack.length - 1] === 'obj') {
        expectKey = true;
      }
      output += span('hl-punc', ',');
      continue;
    }

    // Whitespace — pass through
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      flushBuf();
      output += ch === '\n' ? '\n' : ch;
      continue;
    }

    // Accumulate literal tokens (true, false, null, numbers)
    buf += ch;
    // Peek ahead: if the next char ends the token, flush as literal
    const next = json[i + 1];
    if (next === undefined || next === ',' || next === '}' || next === ']' || next === '\n' || next === '\r' || next === ' ') {
      const literal = buf.trim();
      if (literal === 'true' || literal === 'false') {
        output += span('hl-bool', literal);
      } else if (literal === 'null') {
        output += span('hl-null', literal);
      } else if (literal !== '') {
        output += span('hl-num', literal);
      }
      buf = '';
    }
  }

  flushBuf();
  return output;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
