import type { DebtItem, DebtKind, DebtSummary } from '../../../src/lib/debtParser';

type EnvGetter = (name: string) => string | undefined;

type UploadedReportFile = {
  name: string;
  type: string;
  dataUrl: string;
};

type AnalyzeRequest = {
  mode?: 'accurate' | 'fast';
  text?: string;
  files?: UploadedReportFile[];
};

type AliyunMessage = {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | {
            type: 'text';
            text: string;
          }
        | {
            type: 'image_url';
            image_url: {
              url: string;
            };
          }
      >;
};

const validKinds: DebtKind[] = ['贷款余额', '信用卡欠款', '逾期欠款', '担保代偿', '其他欠款'];
const validConfidence: DebtItem['confidence'][] = ['high', 'medium', 'low'];
const debtFieldPattern = /余额|余额为|未还本金|剩余本金|已使用额度|已用额度|透支余额|当前逾期总额|逾期金额|逾期本金|呆账余额|代偿金额|垫款金额/;
const nonDebtFieldPattern = /信用额度|授信额度|合同金额|发放金额|借款金额|贷款金额|贷款额度|担保额度|月还款|还款额|单家机构最高授信额|最高授信额|最近6个月平均|最近六个月平均|已结清|销户|外币|美元账户/;
const moneyPattern = /([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/;
const maxImageFiles = 6;
const maxPdfFiles = 2;

const debtAnalysisRules = [
  '你是一名专业的中国个人征信报告解析助手。',
  '用户会上传中国人民银行征信中心的个人信用报告 PDF、图片或扫描件。',
  '你的任务是计算“当前总欠款”，不是计算授信额度，也不是计算历史借款总额。',
  '',
  '一、优先级规则',
  '1. 如果报告中存在“信息概要 / 信息汇总 / 信贷交易授信及负债信息概要”表格，并且其中明确列出了各类账户的当前余额、已用额度、透支余额，则优先使用该汇总表计算。',
  '2. 如果 PDF 中没有清晰的汇总表，或者报告是文字版账户明细，则从“信用卡”和“贷款”的账户明细中逐条提取当前未结清金额。',
  '3. 账户明细和信息概要不能重复计算。若已使用信息概要汇总表，就不要再把明细里的单笔账户重复加进去。',
  '',
  '二、信用卡计算规则',
  '信用卡部分只计入当前仍未销户、仍有使用金额的账户。',
  '需要计入的字段包括：“余额”“已使用额度”“已用额度”“透支余额”。',
  '“含未出单的大额专项分期余额”的金额已经包含在余额里，不要额外重复加。',
  '不要计入：“信用额度”“授信额度”、已销户账户、已使用额度为 0 的账户、已换算成人民币为 0 的美元账户。',
  '',
  '三、贷款计算规则',
  '贷款部分只计入当前未结清、当前有余额的贷款账户。',
  '需要计入的字段包括：“余额为 x”“余额 x”“当前余额”“未结清余额”“未还本金”“剩余本金”。',
  '不要计入：“发放的 x 元贷款”中的原始借款金额、“信用额度”“授信额度”“额度有效期”“已结清”的贷款、“已销户”的账户、历史贷款金额、查询记录中的金额。',
  '',
  '四、去重规则',
  '1. 同一账户如果同时出现“信用额度”和“余额”，只取“余额”。',
  '2. 同一账户如果出现“余额”和“含未出单分期余额”，只取总余额，不要再加分期余额。',
  '3. 已结清、已销户、余额为 0 的账户不计入当前总欠款。',
  '4. 不要把“借款金额 / 授信额度 / 信用额度”误认为欠款。',
  '5. 不要把“账户明细”与“信息概要”重复相加。',
  '6. “当前逾期总额/逾期金额”通常是余额中逾期的部分；如果同一账户或同一汇总已计入余额，不要再重复加逾期金额。',
  '',
  '五、信息概要表格列规则',
  '读取“非循环贷账户信息汇总/循环贷账户一信息汇总/循环贷账户二信息汇总”时，表头顺序通常是“管理机构数、账户数、授信总额、余额、最近6个月平均应还款”。只能取“余额”列。',
  '读取“贷记卡账户信息汇总”时，通常包含“授信总额、单家机构最高授信额、单家机构最低授信额、已用额度、最近6个月平均使用额度”。只能取“已用额度”列。',
  '示例：非循环贷账户信息汇总 授信总额100,000 余额99,820 最近6个月平均应还款252，应计入99,820，不计入100,000或252。',
  '示例：循环贷账户一信息汇总 授信总额143,000 余额143,000 最近6个月平均应还款779，应计入143,000，不计入779。',
  '示例：循环贷账户二信息汇总 授信总额87,550 余额29,450 最近6个月平均应还款6,560，应计入29,450，不计入87,550或6,560。',
  '示例：贷记卡账户信息汇总 授信总额428,500 已用额度396,418 最近6个月平均使用额度338,081，应计入396,418，不计入428,500、196,500、3,000或338,081。',
  '如果你在 warnings 中提到某个概要表存在明确“余额/已用额度/透支余额”，且该金额不是 0、未结清、未销户，则这个金额必须同时出现在 items 中。',
  'warnings 只能列出不计入项目或真实不确定项目，不能把已经明确需要计入的欠款只写在 warnings 里。',
  '',
  '六、输出规则',
  '只输出 JSON，不要使用 Markdown，不要输出 OCR 全文，不要解释过程。',
  '返回格式：{"total":数字,"items":[{"kind":"贷款余额|信用卡欠款|逾期欠款|担保代偿|其他欠款","amount":数字,"source":"短依据","confidence":"high|medium|low"}],"warnings":["不计入项目或需要人工复核的点"]}',
  'items 必须逐账户或逐汇总表行列出，禁止把多个银行、多个账户或多个余额合并成一个 item。',
  '每个 item.source 只能包含一个计入金额。如果同类账户有多个金额，必须拆成多个 item。',
  '如果账户很多、逐条输出会很长，可以按“信用卡当前欠款合计”“贷款当前余额合计”等类别输出合计 item；合计 item.source 只能包含一个合计金额，不能包含多个明细金额。',
  'total 必须等于 items 中 amount 的加总。',
  '每个 item.source 必须包含表名或账户位置、字段名和值，例如“非循环贷账户信息汇总 余额99,820”。',
  '如果字段模糊、金额识别不确定、账户可能重复，请写入 warnings，不要编造数字。',
].join('\n');

class ModelJsonParseError extends Error {
  constructor(
    message: string,
    readonly rawText: string,
  ) {
    super(message);
    this.name = 'ModelJsonParseError';
  }
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  });
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ModelJsonParseError('Reasoning model did not return JSON.', text);
  }
  const jsonText = candidate.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new ModelJsonParseError(error instanceof Error ? error.message : 'Reasoning model returned invalid JSON.', jsonText);
  }
}

function parseMoney(value: string) {
  const amount = Number(value.replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function extractDebtAmountsFromSource(source: string) {
  const matches = source.matchAll(
    new RegExp(
      `(?:余额为|余额|当前余额|未结清余额|未还本金|剩余本金|已使用额度|已用额度|透支余额|当前逾期总额|逾期金额|逾期本金|呆账余额|代偿金额|垫款金额)\\s*${moneyPattern.source}`,
      'g',
    ),
  );
  return [...matches].map((match) => parseMoney(match[1])).filter((amount) => amount > 0);
}

function extractSummaryItems(raw: Partial<DebtSummary>) {
  const texts = [
    ...(Array.isArray(raw.items)
      ? raw.items
          .map((item) => (item as Partial<DebtItem>).source)
          .filter((source): source is string => typeof source === 'string')
      : []),
    ...(Array.isArray(raw.warnings) ? raw.warnings.filter((warning): warning is string => typeof warning === 'string') : []),
  ];

  const specs: Array<{ table: string; field: string; kind: DebtKind }> = [
    { table: '非循环贷账户信息汇总', field: '余额', kind: '贷款余额' },
    { table: '循环贷账户一信息汇总', field: '余额', kind: '贷款余额' },
    { table: '循环贷账户二信息汇总', field: '余额', kind: '贷款余额' },
    { table: '贷记卡账户信息汇总', field: '已用额度', kind: '信用卡欠款' },
    { table: '准贷记卡账户信息汇总', field: '透支余额', kind: '信用卡欠款' },
  ];

  const items: DebtItem[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    for (const spec of specs) {
      const match = text.match(new RegExp(`${spec.table}[\\s\\S]{0,80}${spec.field}\\s*(?:为)?\\s*${moneyPattern.source}`));
      const amount = match ? parseMoney(match[1]) : 0;
      if (amount <= 0) continue;

      const key = `${spec.table}:${spec.field}:${amount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `${spec.kind}:${amount}:${spec.table}`,
        kind: spec.kind,
        amount,
        source: `${spec.table} ${spec.field}${amount.toLocaleString('en-US')}`,
        confidence: 'high',
      });
    }
  }

  return items;
}

export function normalizeSummary(value: unknown): DebtSummary {
  const raw = value as Partial<DebtSummary>;
  const items = Array.isArray(raw.items) ? raw.items : [];

  const normalizedItems: DebtItem[] = items
    .map((item, index) => {
      const candidate = item as Partial<DebtItem>;
      const kind = validKinds.includes(candidate.kind as DebtKind) ? (candidate.kind as DebtKind) : '其他欠款';
      const source = typeof candidate.source === 'string' ? candidate.source.trim() : '';
      const confidence = validConfidence.includes(candidate.confidence as DebtItem['confidence'])
        ? (candidate.confidence as DebtItem['confidence'])
        : 'medium';
      const modelAmount = Number(candidate.amount);
      const sourceAmounts = extractDebtAmountsFromSource(source);
      const sourceAmount = sourceAmounts.length === 1 ? sourceAmounts[0] : 0;
      const amount =
        sourceAmount > 0 && (!Number.isFinite(modelAmount) || Math.abs(sourceAmount - modelAmount) >= 1)
          ? sourceAmount
          : modelAmount;

      if (!Number.isFinite(amount) || amount <= 0) return null;
      if (nonDebtFieldPattern.test(source) && !debtFieldPattern.test(source)) return null;
      return {
        id: candidate.id || `${kind}:${amount}:${index}`,
        kind,
        amount: Math.round(amount * 100) / 100,
        source: source.slice(0, 120),
        confidence,
      };
    })
    .filter((item): item is DebtItem => Boolean(item));

  const mergedItems = [...normalizedItems];
  const existingSummaryKeys = new Set(
    mergedItems.map((item) => `${item.source.replace(/\s+/g, '')}:${item.amount}`),
  );
  for (const item of extractSummaryItems(raw)) {
    const key = `${item.source.replace(/\s+/g, '')}:${item.amount}`;
    if (!existingSummaryKeys.has(key)) {
      existingSummaryKeys.add(key);
      mergedItems.push(item);
    }
  }

  const debtAmounts = new Set(mergedItems.filter((item) => item.kind !== '逾期欠款').map((item) => item.amount));
  const dedupedItems = mergedItems.filter((item) => item.kind !== '逾期欠款' || !debtAmounts.has(item.amount));
  const dedupedTotal = dedupedItems.reduce((sum, item) => sum + item.amount, 0);
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((warning): warning is string => typeof warning === 'string') : [];
  const duplicateOverdueCount = mergedItems.length - dedupedItems.length;
  if (duplicateOverdueCount > 0) {
    warnings.push('已剔除与余额完全相同的逾期金额，避免重复统计。');
  }

  return {
    total: Math.round(dedupedTotal * 100) / 100,
    items: dedupedItems.sort((a, b) => b.amount - a.amount),
    warnings,
  };
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || '';
  if (!base64) return new Uint8Array();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function extractTextFromPdf(file: UploadedReportFile) {
  const bytes = dataUrlToBytes(file.dataUrl);
  if (bytes.length === 0) return '';

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .trim();
    if (pageText) pages.push(`--- PDF ${file.name} 第 ${pageNumber} 页 ---\n${pageText}`);
  }

  return pages.join('\n\n');
}

async function extractTextFromPdfs(files: UploadedReportFile[]) {
  const texts = await Promise.all(files.slice(0, maxPdfFiles).map((file) => extractTextFromPdf(file)));
  return texts.filter(Boolean).join('\n\n');
}

export function createAnalyzeReportHandler(getEnv: EnvGetter) {
  const getBaseUrl = () => (getEnv('DASHSCOPE_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const getApiKey = () => getEnv('DASHSCOPE_API_KEY') || getEnv('BAILIAN_API_KEY') || '';
  const getVisionModel = () => getEnv('QWEN_VISION_MODEL') || 'qwen3.7-plus';
  const getFastVisionModel = () => getEnv('QWEN_FAST_VISION_MODEL') || 'qwen3.7-plus';
  const getReasoningModel = () => getEnv('QWEN_REASONING_MODEL') || 'qwen3.7-plus';

  async function callChatCompletion(
    model: string,
    messages: AliyunMessage[],
    options?: { maxTokens?: number; temperature?: number; responseFormat?: 'json_object' },
  ) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        enable_thinking: false,
        max_tokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0,
        ...(options?.responseFormat ? { response_format: { type: options.responseFormat } } : {}),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `Qwen API request failed with ${response.status}`;
      throw new Error(message);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Qwen API returned an empty response.');
    }
    return content;
  }

  async function extractSummaryFromModelJson(response: string, repairModel: string) {
    try {
      return normalizeSummary(extractJsonObject(response));
    } catch (error) {
      if (!(error instanceof ModelJsonParseError)) throw error;

      const repaired = await callChatCompletion(
        repairModel,
        [
          {
            role: 'system',
            content:
              '你是严格的 JSON 修复器。只修复用户提供的坏 JSON，使其成为合法 JSON 对象。不要新增事实，不要重新计算，不要解释。输出必须是 {"total":数字,"items":[...],"warnings":[...]}。',
          },
          {
            role: 'user',
            content: [
              '下面是模型返回的坏 JSON。请只修复语法错误：缺逗号、截断的字符串、尾随逗号、缺右括号等。',
              '如果内容明显被截断，只保留已经完整出现的 item，并让 total 等于保留 items 的 amount 加总，在 warnings 里说明“模型 JSON 被截断，已按可恢复部分统计”。',
              error.rawText.slice(0, 12000),
            ].join('\n\n'),
          },
        ],
        { maxTokens: 4096, temperature: 0, responseFormat: 'json_object' },
      );

      try {
        return normalizeSummary(extractJsonObject(repaired));
      } catch {
        throw new Error('模型返回格式异常，已自动重试修复但仍失败。请重新点击分析，或切换精准模式后重试。');
      }
    }
  }

  async function summarizeImageDebts(files: UploadedReportFile[], text?: string) {
    const content: AliyunMessage['content'] = [
      {
        type: 'text',
        text: [
          debtAnalysisRules,
          '当前是快速模式：请直接阅读上传图片并完成欠款统计，不能先要求用户提供 OCR 文本。',
          '用户可能上传多张图片，它们可能是同一份征信报告的不同页面或同一页的分开拍摄。请综合全部图片统计一次总欠款。',
          '如果同一张图片同时包含概要表和账户明细，优先采用概要表，不要重复加右侧明细账户。',
          '请先定位“二 信息概要”下方的各个汇总表，再决定是否需要看右侧“三 信贷交易信息明细”。',
          '如果多张图片中同一账户、同一汇总表或同一金额重复出现，只统计一次。',
          text ? `补充文本：${text.slice(0, 2000)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      ...files.slice(0, maxImageFiles).map((file) => ({
        type: 'image_url' as const,
        image_url: {
          url: file.dataUrl,
        },
      })),
    ];

    const response = await callChatCompletion(
      getFastVisionModel(),
      [
        {
          role: 'user',
          content,
        },
      ],
      { maxTokens: 4096, temperature: 0, responseFormat: 'json_object' },
    );

    return extractSummaryFromModelJson(response, getFastVisionModel());
  }

  async function extractTextWithVision(files: UploadedReportFile[]) {
    if (files.length === 0) return '';

    const pageTexts: string[] = [];

    for (const [index, file] of files.slice(0, maxImageFiles).entries()) {
      const content: AliyunMessage['content'] = [
        {
          type: 'text',
          text:
            '请对这张征信报告图片做 OCR。图片可能旋转、倾斜或包含表格。请尽力识别表格和数字，重点保留：信息概要、信用卡、贷款、其他信贷记录中的账户状态、币种、信用额度、已使用额度、余额、未还本金、逾期金额、结清/销户信息。不要总结，不要编造，不要统计，只输出可核对的原文片段。',
        },
        {
          type: 'image_url',
          image_url: {
            url: file.dataUrl,
          },
        },
      ];

      const pageText = await callChatCompletion(
        getVisionModel(),
        [
          {
            role: 'user',
            content,
          },
        ],
        { maxTokens: 2800, temperature: 0 },
      );
      pageTexts.push(`--- 图片 ${index + 1}：${file.name} ---\n${pageText}`);
    }

    return pageTexts.join('\n\n');
  }

  async function summarizeDebts(text: string) {
    const system = [
      debtAnalysisRules,
      '当前是精准模式：输入可能包含 PDF 文字和视觉 OCR 文字。请综合判断，但仍优先使用清晰的信息概要汇总表。',
    ].join('\n');

    const content = `请统计以下征信报告文字中的当前欠款。\n\n${text.slice(0, 120000)}`;

    const response = await callChatCompletion(
      getReasoningModel(),
      [
        {
          role: 'system',
          content: system,
        },
        {
          role: 'user',
          content,
        },
      ],
      { temperature: 0, responseFormat: 'json_object' },
    );

    return extractSummaryFromModelJson(response, getReasoningModel());
  }

  return async function analyzeReport(req: Request) {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, { status: 405 });
    }

    try {
      const body = (await req.json()) as AnalyzeRequest;
      const files = body.files || [];
      const mode = body.mode || 'accurate';
      const providedText = body.text?.trim() || '';
      const imageFiles = files.filter((file) => file.dataUrl.startsWith('data:image/'));
      const pdfFiles = files.filter((file) => file.dataUrl.startsWith('data:application/pdf'));
      const unsupportedFiles = files.filter(
        (file) => !file.dataUrl.startsWith('data:image/') && !file.dataUrl.startsWith('data:application/pdf'),
      );

      if (!providedText && files.length === 0) {
        return json({ error: 'Missing report text or images.' }, { status: 400 });
      }

      if (unsupportedFiles.length > 0) {
        return json({ error: 'Only image or PDF files are supported.' }, { status: 400 });
      }

      const pdfText = pdfFiles.length > 0 ? await extractTextFromPdfs(pdfFiles) : '';
      const combinedText = [providedText, pdfText].filter(Boolean).join('\n\n--- PDF TEXT ---\n\n');

      if (!combinedText.trim() && imageFiles.length === 0) {
        return json(
          {
            error: '这个 PDF 没有可提取的文字层。请改用拍照或图片上传，或上传清晰扫描图片。',
          },
          { status: 400 },
        );
      }

      const summary =
        imageFiles.length > 0 && mode === 'fast'
          ? await summarizeImageDebts(imageFiles, combinedText)
          : imageFiles.length > 0
            ? await summarizeDebts([combinedText, await extractTextWithVision(imageFiles)].filter(Boolean).join('\n\n--- OCR ---\n\n'))
            : await summarizeDebts(combinedText);

      return json({
        summary,
        modelTrace: {
          visionModel: imageFiles.length > 0 ? (mode === 'fast' ? getFastVisionModel() : getVisionModel()) : null,
          reasoningModel: imageFiles.length > 0 && mode === 'fast' ? getFastVisionModel() : getReasoningModel(),
          mode,
          usedOcr: imageFiles.length > 0,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? '模型调用超时。快速模式请尝试旋转到正向、裁掉无关背景后重试；如果仍超时，建议把视觉模型切回 qwen3-vl-plus 或使用精准模式。'
          : error instanceof ModelJsonParseError
            ? '模型返回格式异常。请重新点击分析，或切换精准模式后重试。'
          : error instanceof Error
            ? error.message
            : 'AI analysis failed.';

      return json(
        {
          error: message,
        },
        { status: 500 },
      );
    }
  };
}
