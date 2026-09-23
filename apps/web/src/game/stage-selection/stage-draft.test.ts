import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { playerStateFixture } from '@/test/fixtures';
import {
  changesSelection,
  describeSelectionFailure,
  readStageDraft,
  stepStage,
} from './stage-draft';

describe('readStageDraft', () => {
  it.each(['1', '42', '100', ' 7 '])('accepts %j within 1 … 100', (text) => {
    expect(readStageDraft(text, '100')).toEqual({ kind: 'valid', stage: text.trim() });
  });

  it.each(['', '0', '-1', '01', '1.5', '1e2', 'abc', '9223372036854775808'])(
    'rejects %j as not a stage',
    (text) => {
      expect(readStageDraft(text, '100')).toEqual({
        kind: 'invalid',
        message: 'Enter a whole stage number, like 12.',
      });
    },
  );

  it('rejects a stage beyond the highest reached, naming the open range', () => {
    expect(readStageDraft('101', '100')).toEqual({
      kind: 'invalid',
      message: 'Your hero has not reached that stage yet. Stages 1 to 100 are open.',
    });
  });

  it('compares exactly beyond 2^53: 2^53 + 4 is not ≤ 2^53 + 3', () => {
    expect(readStageDraft('9007199254740996', '9007199254740995').kind).toBe('invalid');
    expect(readStageDraft('9007199254740995', '9007199254740995')).toEqual({
      kind: 'valid',
      stage: '9007199254740995',
    });
  });
});

describe('stepStage', () => {
  it('steps by one within the open range', () => {
    expect(stepStage('5', 1, '10', '5')).toBe('6');
    expect(stepStage('5', -1, '10', '5')).toBe('4');
  });

  it('stops at stage 1 and at the highest stage reached', () => {
    expect(stepStage('1', -1, '10', '5')).toBe('1');
    expect(stepStage('10', 1, '10', '5')).toBe('10');
  });

  it('restarts an unreadable draft from the current stage', () => {
    expect(stepStage('abc', 1, '10', '5')).toBe('6');
    expect(stepStage('999', -1, '10', '5')).toBe('4');
  });

  it('steps exactly beyond 2^53', () => {
    expect(stepStage('9007199254740993', 1, '9007199254740995', '1')).toBe('9007199254740994');
    expect(stepStage('9007199254740993', -1, '9007199254740995', '1')).toBe('9007199254740992');
  });
});

describe('changesSelection', () => {
  const progression = {
    ...playerStateFixture().progression,
    currentStage: '9',
    highestStageReached: '10',
    highestStageCleared: '9',
  };

  it('climbing resumes from the frontier after a boss defeat', () => {
    expect(changesSelection({ mode: 'PROGRESS' }, progression)).toBe(true);
    expect(changesSelection({ mode: 'PROGRESS' }, { ...progression, currentStage: '10' })).toBe(
      false,
    );
  });

  it('farming the stage already farmed changes nothing', () => {
    const farming = { ...progression, stageMode: 'FARM' as const };
    expect(changesSelection({ mode: 'FARM', stage: '9' }, farming)).toBe(false);
    expect(changesSelection({ mode: 'FARM', stage: '8' }, farming)).toBe(true);
    expect(changesSelection({ mode: 'FARM', stage: '9' }, progression)).toBe(true);
  });
});

describe('describeSelectionFailure', () => {
  it.each([
    [
      new ApiError('Stages 1 to 10 are open.', 409, { code: 'STAGE_LOCKED' }),
      'Stages 1 to 10 are open.',
    ],
    [
      new ApiError('Your hero was busy. Please try again.', 409, { code: 'CONCURRENT_UPDATE' }),
      'Your hero was busy. Please try again.',
    ],
    [new ApiError('offline'), 'Connection lost. Your choice was not saved — try again.'],
    [new ApiError('x', 401, { code: 'UNAUTHENTICATED' }), 'Your session has ended.'],
    [new ApiError('x', 404, { code: 'NOT_FOUND' }), 'Your hero could not be found.'],
    [new ApiError('x', 500), 'The forge is unreachable right now. Try again in a moment.'],
    [new Error('boom'), 'Something went wrong. Try again.'],
  ])('describes %s', (error, message) => {
    expect(describeSelectionFailure(error)).toBe(message);
  });
});
