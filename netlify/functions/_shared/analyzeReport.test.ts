import { describe, expect, it } from 'vitest';
import { normalizeSummary } from './analyzeReport';

describe('normalizeSummary', () => {
  it('does not replace model amount with the first source amount when a source contains multiple debt amounts', () => {
    const summary = normalizeSummary({
      total: 356607,
      items: [
        {
          kind: '信用卡欠款',
          amount: 150964,
          source: '招商银行余额48,353; 广发银行已使用额度34,220; 上海银行余额25,866; 中信银行余额42,525',
          confidence: 'high',
        },
        {
          kind: '贷款余额',
          amount: 205643,
          source: '微众银行余额27,611; 南京银行余额150,391; 重庆蚂蚁消费金融余额27,641',
          confidence: 'high',
        },
      ],
      warnings: [],
    });

    expect(summary.total).toBe(356607);
    expect(summary.items.map((item) => item.amount).sort((a, b) => b - a)).toEqual([205643, 150964]);
  });
});
