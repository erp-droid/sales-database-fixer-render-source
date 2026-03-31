declare module "nodemailer" {
  export type SendMailOptions = {
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    subject?: string;
    text?: string;
    html?: string;
  };

  export type SentMessageInfo = {
    messageId?: string;
  };

  export type Transporter = {
    sendMail(message: SendMailOptions): Promise<SentMessageInfo>;
  };

  const nodemailer: {
    createTransport(options: unknown): Transporter;
  };

  export default nodemailer;
}
