import axios from 'axios';

/**
 * Service to handle automated WhatsApp messages.
 * Note: Since there is no completely free WhatsApp API without setup, 
 * this is structured for the Meta Cloud API. You can replace the URL 
 * and headers with another provider if needed (like Twilio or UltraMsg).
 */
export class WhatsAppService {
  private static readonly API_URL = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v17.0/YOUR_PHONE_NUMBER_ID/messages';
  private static readonly API_TOKEN = process.env.WHATSAPP_API_TOKEN || '';

  /**
   * Sends a WhatsApp message using a third-party API.
   * @param to Phone number with country code (e.g., "919876543210")
   * @param message Text message to send
   */
  static async sendMessage(to: string, message: string): Promise<boolean> {
    if (!this.API_TOKEN) {
      console.warn(`[WhatsAppService] No API Token configured. Message to ${to} would have been: \n${message}`);
      // Returning true to mock success in development when token is missing
      return true; 
    }

    try {
      // Structure for Meta WhatsApp Cloud API
      const response = await axios.post(
        this.API_URL,
        {
          messaging_product: 'whatsapp',
          to: to.replace(/\D/g, ''), // Ensure numbers only
          type: 'text',
          text: {
            body: message
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`[WhatsAppService] Message sent to ${to}. ID: ${response.data.messages?.[0]?.id}`);
      return true;
    } catch (error: any) {
      console.error(`[WhatsAppService] Failed to send message to ${to}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Generates and sends the bilingual welcome message for drivers.
   */
  static async sendDriverWelcome(phone: string, driverName: string, tempPassword?: string, loginEmail?: string) {
    const appLink = "https://margixindia.vercel.app/login"; // Driver app link
    
    const message = `*Welcome to Margix India, ${driverName}!* 🚚\n\n` +
      `Your vehicle has been registered on the Fleet Intelligence network.\n\n` +
      `*Action Required:* Please install the app and log in to start receiving trips.\n` +
      `📱 Install App & Login: ${appLink}\n` +
      (loginEmail ? `📧 Email: ${loginEmail}\n` : '') +
      (tempPassword ? `🔐 Temp Password: ${tempPassword}\n\n` : '\n') +
      `---\n\n` +
      `*मार्गीक्स इंडिया में आपका स्वागत है, ${driverName}!* 🚚\n\n` +
      `आपका वाहन फ्लीट इंटेलिजेंस नेटवर्क पर पंजीकृत हो गया है।\n\n` +
      `*आवश्यक कार्रवाई:* कृपया ऐप इंस्टॉल करें और ट्रिप प्राप्त करने के लिए लॉग इन करें।\n` +
      `📱 ऐप इंस्टॉल करें और लॉगिन करें: ${appLink}\n` +
      (loginEmail ? `📧 ईमेल: ${loginEmail}\n` : '') +
      (tempPassword ? `🔐 अस्थायी पासवर्ड: ${tempPassword}\n` : '');

    return this.sendMessage(phone, message);
  }
}
