import {
  MINI_URL,
  fetchApplePage,
  extractMacMiniProducts,
  formatPrice,
  parseSpecsString,
  parseChip,
  parseSpecsStructured,
  type Product,
} from "./lib/scrape";

function parseStorageGB(storage: string): number {
  const tb = storage.match(/(\d+)\s*TB/i);
  if (tb) return +tb[1] * 1024;
  const gb = storage.match(/(\d+)\s*GB/i);
  if (gb) return +gb[1];
  return 0;
}

function meetsAlertCriteria(product: Product): boolean {
  const { generation } = parseChip(product.name || "");
  if (generation < 4) return false;

  const specs = parseSpecsStructured(product.description);
  const ram = specs.ram.match(/(\d+)/);
  if (!ram || +ram[1] < 16) return false;

  return parseStorageGB(specs.storage) >= 512;
}

function buildSlackMessage(minis: Product[]): { text: string } {
  const lines = minis.map((p) => {
    const specs = parseSpecsString(p.description);
    const specLine = specs ? `\n    ${specs}` : "";
    return `• *${formatPrice(p)}* — ${p.name}${specLine}`;
  });
  const text = [
    `🖥️ *${minis.length} Mac Mini${minis.length > 1 ? "s" : ""} spotted on Apple Refurbished!*`,
    "",
    ...lines,
    "",
    `👉 ${MINI_URL}`,
  ].join("\n");

  return { text };
}

// ⬇️ 新增：构建专门给 Telegram 发送的 MarkdownV2 格式消息 ⬇️
function buildTelegramMessage(minis: Product[]): string {
  const lines = minis.map((p) => {
    const specs = parseSpecsString(p.description) || "";
    // Telegram 的 Markdown 对部分特殊字符要求严格，做简单的换行和加粗处理
    return `• *${formatPrice(p)}* — ${p.name}\n  _${specs}_`;
  });
  
  return [
    `🖥️ *发现 ${minis.length} 台符合条件的 Mac Mini 官翻机！*`,
    "",
    ...lines,
    "",
    `🔗 [点击前往 Apple 官网抢购](${MINI_URL})`,
  ].join("\n");
}

async function notifySlack(message: { text: string }): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("SLACK_WEBHOOK_URL not set — skipping Slack notification");
    return;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }

  console.log("Slack notification sent successfully");
}

// ⬇️ 新增：发送消息到 Telegram Bot 的异步函数 ⬇️
async function notifyTelegram(messageText: string): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_TO;

  if (!token || !chatId) {
    console.log("TELEGRAM_TOKEN or TELEGRAM_TO not set — skipping Telegram notification");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: messageText,
      parse_mode: "Markdown", // 启用 Markdown 样式（粗体和链接）
    }),
  });

  if (!res.ok) {
    throw new Error(`Telegram API failed: ${res.status} ${await res.text()}`);
  }

  console.log("Telegram notification sent successfully");
}

async function main() {
  console.log("Fetching Apple refurbished Mac Mini page...");
  const html = await fetchApplePage(MINI_URL);

  const allMinis = extractMacMiniProducts(html);
  console.log(`Found ${allMinis.length} Mac Mini(s)`);

  const minis = allMinis.filter(meetsAlertCriteria);
  const filtered = allMinis.length - minis.length;
  if (filtered > 0) {
    console.log(`Filtered out ${filtered} model(s) not meeting criteria (M4+, 16GB+, 512GB+)`);
  }

  if (minis.length === 0) {
    console.log("No qualifying Mac Minis found. Exiting.");
    return;
  }

  for (const mini of minis) {
    console.log(`  → ${mini.name} — ${formatPrice(mini)}`);
  }

  // 1. 发送 Slack（如果有配置的话）
  const slackMessage = buildSlackMessage(minis);
  await notifySlack(slackMessage);

  // 2. 发送 Telegram（⬇️ 新增调用 ⬇️）
  const tgMessage = buildTelegramMessage(minis);
  await notifyTelegram(tgMessage);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
