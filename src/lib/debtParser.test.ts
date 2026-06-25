import { describe, expect, it } from 'vitest';
import { parseDebtReport } from './debtParser';

describe('parseDebtReport', () => {
  it('extracts loan and card debts', () => {
    const summary = parseDebtReport(`
      个人住房贷款 当前余额 320,000.00元
      贷记卡 透支余额 8,234.21元
      贷款合同金额 500,000元
      授信额度 50,000元
    `);

    expect(summary.total).toBe(328234.21);
    expect(summary.items).toHaveLength(2);
  });

  it('handles ten-thousand yuan units', () => {
    const summary = parseDebtReport('经营贷款 未还本金 12.5万元');

    expect(summary.total).toBe(125000);
    expect(summary.items[0].kind).toBe('贷款余额');
  });

  it('reports no debt for non-debt amounts', () => {
    const summary = parseDebtReport('最近查询次数 3 次，信用额度 20000 元，月还款额 1200元');

    expect(summary.total).toBe(0);
    expect(summary.items).toHaveLength(0);
    expect(summary.warnings.length).toBeGreaterThan(0);
  });

  it('extracts current credit report balances without counting credit limits or closed loans', () => {
    const summary = parseDebtReport(`
      1. 2017年10月27日某银行发放的贷记卡（人民币账户）。截至2026年05月，信用额度10,000，已使用额度10,127。
      2. 2017年12月03日某银行发放的贷记卡（美元账户）。截至2026年05月，信用额度12,000，已使用额度9,999。
      3. 2026年01月19日某银行发放的3,000元（人民币）其他个人消费贷款，2027年01月19日到期。截至2026年05月，余额2,022。
      4. 2025年02月19日某消费金融公司为其他个人消费贷款授信，额度有效期至2026年09月22日，可循环使用。截至2026年05月，信用额度17,500元（人民币），余额为2,196，当前无逾期。
      5. 2020年08月16日某消费金融公司发放的12,000元（人民币）其他个人消费贷款，2021年08月已结清。
      6. 2018年03月02日某银行发放的贷记卡（人民币账户），2020年12月销户。
    `);

    expect(summary.total).toBe(14345);
    expect(summary.items).toHaveLength(3);
  });
});
