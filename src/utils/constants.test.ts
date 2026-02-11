/**
 * constants.test.ts
 * Tests for message template functions in constants.ts
 */

import { MESSAGES } from './constants.js';

describe('MESSAGES.ERROR template functions', () => {
  it('INPUT_VALIDATION_FAILED includes details', () => {
    const msg = MESSAGES.ERROR.INPUT_VALIDATION_FAILED('field is required');
    expect(msg).toBe('Input validation failed: field is required');
  });

  it('UNKNOWN_TOOL includes tool name', () => {
    const msg = MESSAGES.ERROR.UNKNOWN_TOOL('nonexistent_tool');
    expect(msg).toBe('Unknown tool: nonexistent_tool');
  });

  it('UNKNOWN_ACTION includes tool and action', () => {
    const msg = MESSAGES.ERROR.UNKNOWN_ACTION('reminders_tasks', 'fly');
    expect(msg).toBe('Unknown reminders_tasks action: fly');
  });

  it('SYSTEM_ERROR includes operation name', () => {
    const msg = MESSAGES.ERROR.SYSTEM_ERROR('read reminders');
    expect(msg).toBe('Failed to read reminders: System error occurred');
  });
});
