import { describe, expect, it } from 'vitest';
import { runPipeline } from './dataCleaning';

describe('runPipeline missing-value handling', () => {
  it('keeps sparse columns and leaves their missing values null', async () => {
    const csv = [
      'score,category,notes,day,cabin,empty_column',
      '10,East,shared,2024-01-01,,',
      '20,East,,,,' ,
      '30,West,,,,' ,
      '40,,,,7,',
    ].join('\n');

    const result = await runPipeline(new File([csv], 'sparse.csv', { type: 'text/csv' }));

    expect(result.report.columnsDropped).toContain('empty_column');
    expect(result.report.columnsDropped).not.toContain('cabin');
    expect(result.report.sparseColumns).toContainEqual({ name: 'cabin', missingPercent: 75 });
    expect(result.report.warnings).toContain('Sparse column cabin: 75% missing, kept as is (nulls not filled).');
    expect(result.cleanedRows.map(row => row.cabin)).toEqual([null, null, null, '7']);
    expect(result.report.missingFilled).not.toHaveProperty('cabin');
  });

  it('fills numeric with the median and categorical/text with the mode, but leaves dates empty', async () => {
    const csv = [
      'score,category,notes,day',
      '10,East,shared,2024-01-01',
      ',East,,',
      '30,West,,2024-01-03',
      '40,,shared,2024-01-04',
    ].join('\n');

    const result = await runPipeline(new File([csv], 'regular-missing.csv', { type: 'text/csv' }));

    expect(result.cleanedRows.map(row => row.score)).toEqual([10, 30, 30, 40]);
    expect(result.cleanedRows.map(row => row.category)).toEqual(['East', 'East', 'West', 'East']);
    expect(result.cleanedRows.map(row => row.notes)).toEqual(['Shared', 'Shared', 'Shared', 'Shared']);
    expect(result.cleanedRows.map(row => row.day)).toEqual(['2024-01-01', '2024-01-03', null, '2024-01-04']);
    expect(result.report.missingFilled.score).toEqual({ count: 1, method: 'median', value: 30 });
    expect(result.report.missingFilled.category).toEqual({ count: 1, method: 'most common', value: 'East' });
    expect(result.report.missingFilled.notes).toEqual({ count: 2, method: 'most common', value: 'Shared' });
    expect(result.report.missingFilled).not.toHaveProperty('day');
  });
});