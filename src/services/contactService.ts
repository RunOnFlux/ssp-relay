import nodemailer from 'nodemailer';
import config from 'config';
import log from '../lib/log';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function postContact(data) {
  try {
    // Create transporter using SMTP configuration
    const transporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: {
        user: config.email.smtp.user,
        pass: config.email.smtp.pass,
      },
    });

    // Parse form data from message if it contains structured data
    let subject = `Contact Form: Message from ${data.name}`;

    // Check if message contains structured form data
    if (data.message.includes('Subject:')) {
      const lines = data.message.split('\n');
      const subjectLine = lines.find((line) => line.startsWith('Subject:'));
      if (subjectLine) {
        const extractedSubject = subjectLine.replace('Subject:', '').trim();
        if (extractedSubject) {
          subject = `Contact Form: ${extractedSubject}`;
        }
      }
    }

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      replyTo: data.email,
      subject: subject,
      text: `
Contact Form Submission
=======================

Name: ${data.name}
Email: ${data.email}
Timestamp: ${new Date().toISOString()}

Message:
${data.message}

---
This message was sent via the SSP Wallet contact form.
      `.trim(),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
            New Contact Form Submission
          </h2>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 8px; background-color: #f8f9fa; font-weight: bold; width: 120px;">Name:</td>
              <td style="padding: 8px; border-bottom: 1px solid #dee2e6;">${escapeHtml(data.name)}</td>
            </tr>
            <tr>
              <td style="padding: 8px; background-color: #f8f9fa; font-weight: bold;">Email:</td>
              <td style="padding: 8px; border-bottom: 1px solid #dee2e6;">
                <a href="mailto:${escapeHtml(data.email)}" style="color: #007bff;">${escapeHtml(data.email)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px; background-color: #f8f9fa; font-weight: bold;">Timestamp:</td>
              <td style="padding: 8px; border-bottom: 1px solid #dee2e6;">${new Date().toISOString()}</td>
            </tr>
          </table>

          <div style="margin: 20px 0;">
            <h3 style="color: #333; margin-bottom: 10px;">Message:</h3>
            <div style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #007bff; white-space: pre-wrap;">${escapeHtml(data.message)}</div>
          </div>

          <hr style="margin: 30px 0; border: none; border-top: 1px solid #dee2e6;">
          <p style="color: #6c757d; font-size: 12px; text-align: center;">
            This message was sent via the SSP Wallet contact form.
          </p>
        </div>
      `,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    log.info(`Contact form email sent successfully: ${info.messageId}`);
    log.info(`Contact form submission from ${data.name} (${data.email})`);

    return 'Contact message sent successfully.';
  } catch (error) {
    log.error(`Failed to send contact email: ${error.message || error}`);

    // Fallback: still log the contact attempt even if email fails
    log.info(
      `Contact form submission from ${data.name} (${data.email}): ${data.message}`,
    );

    throw new Error('Failed to send contact message.');
  }
}

export default {
  postContact,
};
