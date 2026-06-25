export type DebtKind = '贷款余额' | '信用卡欠款' | '逾期欠款' | '担保代偿' | '其他欠款';

export type DebtItem = {
  id: string;
  kind: DebtKind;
  amount: number;
  source: string;
  confidence: 'high' | 'medium' | 'low';
};

export type DebtSummary = {
  total: number;
  items: DebtItem[];
  warnings: string[];
};

const fieldAmountPattern =
  /(已使用额度|已用额度|透支余额|当前欠款|未还本金|剩余本金|逾期金额|逾期本金|呆账余额|代偿金额|垫款金额|余额(?:为)?)(?:人民币|¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(万元|万|元)?/g;

function compactLine(line: string) {
  return line.replace(/\s+/g, ' ').trim();
}

function compactReportText(text: string) {
  return text
    .replace(/\r/g, '\n')
    .replace(/信用\s*额度/g, '信用额度')
    .replace(/已\s*使用\s*额度/g, '已使用额度')
    .replace(/已\s*用\s*额度/g, '已用额度')
    .replace(/余额\s*为/g, '余额为')
    .replace(/([截当无逾])\s+([至前期])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .replace(/第\s*\d+\s*页，共\s*\d+\s*页/g, ' ')
    .trim();
}

function parseAmount(value: string, unit?: string) {
  const amount = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return 0;
  if (unit === '万' || unit === '万元') return amount * 10000;
  return amount;
}

function classify(line: string, field: string): DebtKind {
  if (field.includes('逾期') || field.includes('呆账') || /(?<!无)逾期金额|逾期本金/.test(line)) return '逾期欠款';
  if (line.includes('代偿') || line.includes('垫款') || line.includes('担保')) return '担保代偿';
  if (field.includes('已使用额度') || field.includes('已用额度') || line.includes('信用卡') || line.includes('贷记卡') || line.includes('准贷记卡') || line.includes('透支')) {
    return '信用卡欠款';
  }
  if (
    field.includes('余额') ||
    line.includes('贷款') ||
    line.includes('借款') ||
    line.includes('房贷') ||
    line.includes('车贷') ||
    line.includes('本金') ||
    line.includes('当前无逾期')
  ) {
    return '贷款余额';
  }
  return '其他欠款';
}

function confidence(field: string): DebtItem['confidence'] {
  if (['余额', '余额为', '已使用额度', '已用额度', '透支余额', '未还本金', '剩余本金', '逾期金额', '逾期本金'].includes(field)) {
    return 'high';
  }
  return 'medium';
}

function isClosedRecord(record: string) {
  return /已结清|销户|已注销|已关闭|已转出/.test(record);
}

function isForeignCurrencyRecord(record: string) {
  return /美元账户|欧元账户|港币账户|日元账户|英镑账户/.test(record);
}

function splitRecords(text: string) {
  const normalized = text.replace(/\r/g, '\n');
  const records: string[] = [];
  let current = '';

  for (const rawLine of normalized.split('\n')) {
    const line = compactLine(rawLine);
    if (!line) continue;
    if (/^第\s*\d+\s*页/.test(line)) continue;

    if (/^\d+\.\s*/.test(line)) {
      if (current) records.push(current);
      current = line;
    } else if (current) {
      current = `${current} ${line}`;
    } else {
      records.push(line);
    }
  }

  if (current) records.push(current);
  return records
    .flatMap((record) => compactReportText(record).split(/(?=\d+\.\s*\d{4}年\d{2}月\d{2}日)/g))
    .map(compactReportText)
    .filter(Boolean);
}

function sourceExcerpt(line: string) {
  const clean = compactLine(line);
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

function makeId(kind: DebtKind, amount: number, source: string) {
  return `${kind}:${amount}:${source.slice(0, 32)}`;
}

export function parseDebtReport(text: string): DebtSummary {
  const records = splitRecords(text);

  const items: DebtItem[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    if (isClosedRecord(record) || isForeignCurrencyRecord(record)) continue;

    fieldAmountPattern.lastIndex = 0;
    const matches = [...record.matchAll(fieldAmountPattern)];
    for (const match of matches) {
      const field = match[1];
      const amount = parseAmount(match[2], match[3]);
      if (amount <= 0 || amount > 1000000000) continue;

      const kind = classify(record, field);
      const source = sourceExcerpt(record);
      const dedupeKey = `${kind}:${amount}:${source}`;
      if (seen.has(dedupeKey)) continue;

      seen.add(dedupeKey);
      items.push({
        id: makeId(kind, amount, source),
        kind,
        amount,
        source,
        confidence: confidence(field),
      });
    }
  }

  if (items.length === 0) {
    for (const line of text.split(/\r?\n|。|；|;/).map(compactReportText).filter(Boolean)) {
      if (isClosedRecord(line) || isForeignCurrencyRecord(line)) continue;

      fieldAmountPattern.lastIndex = 0;
      for (const match of line.matchAll(fieldAmountPattern)) {
        const amount = parseAmount(match[2], match[3]);
        if (amount <= 0 || amount > 1000000000) continue;

        const kind = classify(line, match[1]);
        const source = sourceExcerpt(line);
        const dedupeKey = `${kind}:${amount}:${source}`;
        if (seen.has(dedupeKey)) continue;

        seen.add(dedupeKey);
        items.push({
          id: makeId(kind, amount, source),
          kind,
          amount,
          source,
          confidence: confidence(match[1]),
        });
      }
    }
  }

  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const warnings: string[] = [];

  if (text.trim() && items.length === 0) {
    warnings.push('没有识别到欠款金额。请确认报告文字是否完整，或粘贴包含“余额、未还本金、透支余额、逾期金额”的段落。');
  }

  if (items.some((item) => item.confidence !== 'high')) {
    warnings.push('部分条目的可信度不是高，请人工复核后再用于正式结论。');
  }

  return {
    total,
    items: items.sort((a, b) => b.amount - a.amount),
    warnings,
  };
}
