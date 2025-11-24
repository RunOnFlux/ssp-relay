import ticketService from '../services/ticketService';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';

// Track submission attempts per IP address to prevent spam
const alreadySubmittedIps = new Map<string, number>();
const MAX_IP_ENTRIES = 10000; // Prevent unbounded memory growth

// RFC 5322 compliant email regex (simplified)
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

async function postTicket(req, res) {
  try {
    const processedBody = req.body;
    if (
      !processedBody.description ||
      typeof processedBody.description !== 'string'
    ) {
      throw new Error('No description specified');
    }
    if (!processedBody.subject || typeof processedBody.subject !== 'string') {
      throw new Error('No subject specified');
    }
    if (!processedBody.type || typeof processedBody.type !== 'string') {
      throw new Error('No type specified');
    }
    if (!processedBody.email || typeof processedBody.email !== 'string') {
      throw new Error('No email specified');
    }

    // Validate challenge header
    const challenge = req.headers['x-challenge'];
    if (
      !challenge ||
      typeof challenge !== 'string' ||
      challenge.length < 10 ||
      challenge.length > 1000
    ) {
      throw new Error('Invalid challenge');
    }

    // validate data
    if (processedBody.description.length > 50000) {
      throw new Error('Description is too long');
    }
    if (processedBody.subject.length > 1000) {
      throw new Error('Subject is too long');
    }
    if (
      processedBody.email.length > 500 ||
      !EMAIL_REGEX.test(processedBody.email)
    ) {
      throw new Error('Email is invalid');
    }
    if (processedBody.type.length > 500) {
      throw new Error('Type is too long');
    }

    // Extract IP address with multiple fallbacks (Cloudflare, proxies, direct connection)
    const forwardedFor = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    const cfConnectingIp = req.headers['cf-connecting-ip'];

    let ip: string;
    if (cfConnectingIp && typeof cfConnectingIp === 'string') {
      ip = cfConnectingIp;
    } else if (forwardedFor && typeof forwardedFor === 'string') {
      ip = forwardedFor.split(',')[0].trim();
    } else if (realIp && typeof realIp === 'string') {
      ip = realIp;
    } else if (req.ip) {
      ip = req.ip;
    } else if (req.socket?.remoteAddress) {
      ip = req.socket.remoteAddress;
    } else {
      ip = 'unknown';
    }

    // Rate limit: max 10 submissions per IP per 24 hours (atomic increment)
    const currentCount = (alreadySubmittedIps.get(ip) || 0) + 1;
    if (currentCount > 10) {
      throw new Error('Ticket already submitted');
    }
    alreadySubmittedIps.set(ip, currentCount);

    const data = {
      description: processedBody.description,
      subject: processedBody.subject,
      type: processedBody.type,
      email: processedBody.email,
    };

    const info = await ticketService.postTicket(data);

    // Prevent unbounded memory growth by removing oldest entry when limit reached
    if (alreadySubmittedIps.size >= MAX_IP_ENTRIES) {
      const firstKey = alreadySubmittedIps.keys().next().value;
      if (firstKey && firstKey !== ip) {
        alreadySubmittedIps.delete(firstKey);
      }
    }

    const result = serviceHelper.createDataMessage(info);
    res.json(result);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

export default {
  postTicket,
};

// Reset IP tracking every 24 hours
setInterval(
  () => {
    alreadySubmittedIps.clear();
  },
  24 * 60 * 60 * 1000,
);
