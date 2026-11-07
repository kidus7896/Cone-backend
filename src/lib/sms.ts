import { config } from "../config";

export interface SmsProvider {
  send(toE164: string, message: string): Promise<void>;
}

// Development only: prints the message instead of sending it.
class ConsoleSms implements SmsProvider {
  async send(to: string, message: string) {
    console.log(`[sms:console] to=${to} message=${message}`);
  }
}

// AfroMessage (Ethiopian SMS gateway). The endpoint and field names below come from
// a third-party client library's documentation and have NOT been tested against the
// live API or the official reference. Verify with a real account before launch.
class AfroMessageSms implements SmsProvider {
  async send(to: string, message: string) {
    const res = await fetch("https://api.afromessage.com/api/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.SMS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, message, from: config.SMS_SENDER_NAME }),
    });
    if (!res.ok) {
      throw new Error(`SMS provider returned HTTP ${res.status}`);
    }
  }
}

export function createSmsProvider(): SmsProvider {
  return config.SMS_PROVIDER === "afromessage" ? new AfroMessageSms() : new ConsoleSms();
}
