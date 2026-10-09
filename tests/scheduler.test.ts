import { describe, expect, it } from 'vitest';
import { FailureCircuit, schedulerOptions } from '../src/scheduler/index.js';
import { calendarDay, dailyCron } from '../src/utils/time.js';

describe('daily scheduling', () => {
  it('builds one daily trigger and forbids overlapping executions', () => {
    expect(dailyCron('20:00')).toBe('0 20 * * *');
    expect(dailyCron('00:05')).toBe('5 0 * * *');
    expect(schedulerOptions({ timezone: 'Asia/Bangkok' })).toEqual({
      timezone: 'Asia/Bangkok',
      noOverlap: true,
    });
    expect(() => dailyCron('* *')).toThrow();
  });
  it('uses recipient-day timezone independently of machine timezone', () => {
    expect(calendarDay(new Date('2026-10-09T16:59:59Z'), 'Asia/Bangkok')).toBe('2026-10-09');
    expect(calendarDay(new Date('2026-10-09T17:00:00Z'), 'Asia/Bangkok')).toBe('2026-10-10');
    expect(calendarDay(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe('2026-11-01');
    expect(calendarDay(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe('2026-11-01');
  });
  it('opens after repeated failures and resets after success', () => {
    const circuit = new FailureCircuit(2);
    expect(circuit.record(true)).toBe(false);
    expect(circuit.record(false)).toBe(false);
    expect(circuit.record(true)).toBe(false);
    expect(circuit.record(true)).toBe(true);
  });
});
