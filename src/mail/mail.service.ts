import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer from 'nodemailer';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendPasswordChangeOtp(
    recipient: string,
    name: string,
    otp: string,
  ): Promise<void> {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const portValue = process.env.SMTP_PORT ?? '465';
    const username = process.env.SMTP_USER?.trim();
    const smtpPassword = process.env.SMTP_PASSWORD?.replace(/\s/g, '');
    const from =
      process.env.SMTP_FROM?.trim() ||
      (username ? `"Tiako dia Tiako" <${username}>` : '');
    const port = Number(portValue);

    if (
      !from ||
      !username ||
      !smtpPassword ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new ServiceUnavailableException(
        'Le service e-mail n’est pas configuré pour envoyer le code de confirmation.',
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === 'true'
        : port === 465,
      auth: { user: username, pass: smtpPassword },
    });

    try {
      await transporter.sendMail({
        from,
        to: recipient,
        subject: 'Code de confirmation — modification du mot de passe',
        text: [
          `Bonjour ${name},`,
          '',
          'Voici votre code de confirmation pour modifier le mot de passe de votre compte :',
          otp,
          '',
          'Ce code expire dans 10 minutes et ne peut être utilisé qu’une seule fois.',
          'Si vous n’avez pas demandé cette modification, ignorez cet e-mail.',
          '',
          'L’équipe Tiako dia Tiako',
        ].join('\n'),
        html: `
          <div style="background:#f8f5f3;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#443536">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #eee5e2;border-radius:12px;overflow:hidden">
              <div style="background:#9e4b62;padding:24px 32px;color:#ffffff">
                <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase">Tiako dia Tiako</p>
                <h1 style="font-size:22px;margin:12px 0 0">Confirmez votre demande</h1>
              </div>
              <div style="padding:28px 32px">
                <p style="font-size:15px;line-height:1.6;margin:0 0 18px">Bonjour ${escapeHtml(name)}, saisissez ce code dans votre espace pour confirmer le changement de mot de passe.</p>
                <p style="background:#fbf7f6;border:1px solid #eee5e2;border-radius:8px;padding:18px;text-align:center;font-family:monospace;font-size:28px;letter-spacing:6px;margin:0">${escapeHtml(otp)}</p>
                <p style="font-size:13px;line-height:1.6;color:#76696a;margin:18px 0 0">Ce code expire dans 10 minutes et ne peut être utilisé qu’une seule fois. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>
              </div>
            </div>
          </div>`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Erreur SMTP inconnue';
      this.logger.error(
        `Échec d’envoi du code de sécurité vers ${recipient}: ${errorMessage}`,
      );
      throw new ServiceUnavailableException(
        'Le code de confirmation n’a pas pu être envoyé. Vérifiez la configuration e-mail du serveur.',
      );
    } finally {
      transporter.close();
    }
  }

  async sendInitialPassword(
    recipient: string,
    name: string,
    password: string,
    type: 'admin' | 'user',
  ): Promise<void> {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const portValue = process.env.SMTP_PORT ?? '465';
    const username = process.env.SMTP_USER?.trim();
    const smtpPassword = process.env.SMTP_PASSWORD?.replace(/\s/g, '');
    const from =
      process.env.SMTP_FROM?.trim() ||
      (username ? `"Tiako dia Tiako" <${username}>` : '');
    const port = Number(portValue);

    if (
      !host ||
      !from ||
      !username ||
      !smtpPassword ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new ServiceUnavailableException(
        'Le service e-mail Gmail n’est pas configuré. Renseignez SMTP_USER et le mot de passe d’application Google dans server/.env.',
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === 'true'
        : port === 465,
      auth: { user: username, pass: smtpPassword },
    });

    try {
      await transporter.sendMail({
        from,
        to: recipient,
        subject: 'Bienvenue chez Tiako dia Tiako — vos accès',
        text: [
          `Bonjour ${name},`,
          '',
          'Votre espace Tiako dia Tiako est prêt. Voici vos identifiants de première connexion :',
          `Adresse e-mail : ${recipient}`,
          `Type de compte : ${type === 'admin' ? 'Administrateur' : 'Utilisateur'}`,
          `Mot de passe provisoire : ${password}`,
          '',
          'Pour votre sécurité, connectez-vous dès que possible et remplacez ce mot de passe provisoire.',
          '',
          'Cordialement,',
          'L’équipe Tiako dia Tiako',
        ].join('\n'),
        html: `
          <div style="background:#f8f5f3;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#443536">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #eee5e2;border-radius:12px;overflow:hidden">
              <div style="background:#9e4b62;padding:24px 32px;color:#ffffff">
                <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase">Tiako dia Tiako</p>
                <h1 style="font-size:24px;margin:12px 0 0">Bienvenue, ${escapeHtml(name)}</h1>
              </div>
              <div style="padding:28px 32px">
                <p style="font-size:15px;line-height:1.6;margin:0 0 20px">Votre espace est prêt. Utilisez les informations ci-dessous pour votre première connexion.</p>
                <div style="background:#fbf7f6;border:1px solid #eee5e2;border-radius:8px;padding:18px 20px">
                  <p style="margin:0 0 12px;font-size:14px"><strong>Adresse e-mail</strong><br>${escapeHtml(recipient)}</p>
                  <p style="margin:0 0 12px;font-size:14px"><strong>Type de compte</strong><br>${type === 'admin' ? 'Administrateur' : 'Utilisateur'}</p>
                  <p style="margin:0;font-size:14px"><strong>Mot de passe provisoire</strong><br><span style="display:inline-block;margin-top:6px;padding:9px 12px;background:#ffffff;border:1px solid #e8dcda;border-radius:6px;font-family:monospace;font-size:16px">${escapeHtml(password)}</span></p>
                </div>
                <p style="font-size:13px;line-height:1.6;color:#76696a;margin:20px 0 0">Pour protéger votre compte, connectez-vous dès que possible et remplacez ce mot de passe provisoire. Ne le partagez avec personne.</p>
                <p style="font-size:14px;line-height:1.6;margin:24px 0 0">Cordialement,<br><strong>L’équipe Tiako dia Tiako</strong></p>
              </div>
              <div style="border-top:1px solid #f0e9e7;padding:14px 32px;color:#9b8e8d;font-size:11px">Cet e-mail automatique concerne la création de votre compte Tiako dia Tiako.</div>
            </div>
          </div>`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Erreur SMTP inconnue';
      this.logger.error(
        `Échec d’envoi Gmail vers ${recipient}: ${errorMessage}`,
      );
      throw new ServiceUnavailableException(
        'L’e-mail d’invitation n’a pas pu être envoyé. Vérifiez le compte Gmail, le mot de passe d’application et les paramètres SMTP du serveur.',
      );
    } finally {
      transporter.close();
    }
  }
}
