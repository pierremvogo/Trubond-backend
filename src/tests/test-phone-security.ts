export abstract class TestPhoneSecurity {
  abstract normalize(phone: string): string;

  abstract hmac(phoneE164: string): string;

  abstract encrypt(phoneE164: string): string;
}
