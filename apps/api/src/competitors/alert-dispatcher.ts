export interface AlertNotificationPayload {
  title: string;
  detail: string;
  kind: "price_drop" | "stock_out" | "winning_ad" | "seo_hijack";
  competitorName: string;
  productName?: string;
  url?: string;
  timestamp: string;
}

export interface AlertChannelConfig {
  telegramEnabled: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  whatsappEnabled: boolean;
  whatsappWebhookUrl?: string;
  notifyOnPriceDrop: boolean;
  notifyOnStockOut: boolean;
  notifyOnWinningAd: boolean;
}

export class AlertDispatcher {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /**
   * Dispatches formatted rich message to Telegram Bot
   */
  async sendToTelegram(
    botToken: string,
    chatId: string,
    payload: AlertNotificationPayload
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const icon = payload.kind === "stock_out" ? "🚨 STOCK OUT OPPORTUNITY" :
                 payload.kind === "price_drop" ? "📉 PRICE DROP ALERT" :
                 payload.kind === "winning_ad" ? "🔥 WINNING AD DETECTED" : "⚡ COMPETITOR ALERT";

    const text = `
<b>${icon}</b>
<b>প্রতিযোগী:</b> ${payload.competitorName}
<b>শিরোনাম:</b> ${payload.title}
<b>বিস্তারিত:</b> ${payload.detail}
${payload.url ? `\n🔗 <a href="${payload.url}">সরাসরি দেখুন</a>` : ""}
<i>Marketing Intelligence OS • ${new Date(payload.timestamp).toLocaleTimeString()}</i>
`.trim();

    try {
      const res = await this.fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      });

      const data = await res.json() as any;
      if (data.ok) {
        return { success: true, messageId: String(data.result?.message_id) };
      }
      return { success: false, error: data.description || "Telegram API error" };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Failed to connect to Telegram" };
    }
  }

  /**
   * Dispatches webhook payload to WhatsApp / custom webhook
   */
  async sendToWhatsapp(
    webhookUrl: string,
    payload: AlertNotificationPayload
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await this.fetchFn(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "whatsapp",
          event: "competitor_alert",
          data: payload,
        }),
      });
      return { success: res.ok };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Failed to dispatch WhatsApp webhook" };
    }
  }
}
